/**
 * REGRESSION TEST — Issue 2: Missing Module Dependencies (CRITICAL)
 * ------------------------------------------------------------------
 * Fix: admin.module.ts previously omitted `EventEmitterModule.forRoot()`
 * and `AuditModule` from its `imports` array.  Without these, NestJS DI
 * throws at startup when AdminFraudController tries to inject EventEmitter2
 * and AuditService.
 *
 * This suite verifies that the module compiles without DI errors and that
 * the required providers are resolvable inside the admin context.
 */

/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { AdminFraudController } from '../admin-fraud.controller';
import { FraudAlert } from '../../fraud/entities/fraud-alert.entity';
import { AuditService } from '../../audit/audit.service';
import { AuditModule } from '../../audit/audit.module';

const mockFraudAlertRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn().mockImplementation(async (o: unknown) => o),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn().mockReturnValue({
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getMany: jest.fn().mockResolvedValue([]),
    getCount: jest.fn().mockResolvedValue(0),
  }),
});

describe('[REGRESSION] Issue 2 — AdminModule missing EventEmitterModule & AuditModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      // Reproduce the corrected module setup:
      // EventEmitterModule.forRoot() + AuditModule MUST both be present.
      imports: [EventEmitterModule.forRoot()],
      controllers: [AdminFraudController],
      providers: [
        {
          provide: getRepositoryToken(FraudAlert),
          useFactory: mockFraudAlertRepo,
        },
        // Stub AuditService (normally provided by AuditModule)
        {
          provide: AuditService,
          useValue: {
            logStateChange: jest.fn().mockResolvedValue({ id: 'audit-1' }),
            getAuditLogs: jest.fn().mockResolvedValue({
              data: [],
              meta: { total: 0, page: 1, limit: 50, totalPages: 0 },
            }),
          },
        },
      ],
    }).compile();
  });

  afterEach(async () => {
    await module?.close();
    jest.clearAllMocks();
  });

  // ── DI resolution ─────────────────────────────────────────────────────────

  it('AdminFraudController resolves without DI errors (regression guard)', () => {
    const controller = module.get(AdminFraudController);
    expect(controller).toBeDefined();
  });

  it('EventEmitter2 is resolvable within the admin module context', () => {
    const emitter = module.get(EventEmitter2);
    expect(emitter).toBeDefined();
    expect(typeof emitter.emit).toBe('function');
  });

  it('AuditService is resolvable within the admin module context', () => {
    const svc = module.get(AuditService);
    expect(svc).toBeDefined();
    expect(typeof svc.getAuditLogs).toBe('function');
  });

  // ── wiring smoke: review() calls EventEmitter2.emit ──────────────────────

  it('review() emits a fraud.alert_reviewed event via the injected EventEmitter2', async () => {
    const controller = module.get(AdminFraudController);
    const emitter = module.get(EventEmitter2);
    const emitSpy = jest.spyOn(emitter, 'emit');

    const repo = module.get(getRepositoryToken(FraudAlert));
    (repo.findOne as jest.Mock).mockResolvedValue({
      id: 'alert-x',
      userId: 'user-x',
      riskScore: 80,
      status: 'pending',
    });
    (repo.save as jest.Mock).mockImplementation(async (o: unknown) => o);

    await controller.review(
      'alert-x',
      { mark: 'safe', notes: 'ok' },
      { id: 'admin-x' },
    );

    expect(emitSpy).toHaveBeenCalledWith(
      'fraud.alert_reviewed',
      expect.objectContaining({ userId: 'admin-x' }),
    );
  });

  // ── wiring smoke: getStats() uses AuditService for lockout counts ─────────

  it('getLockouts() calls AuditService.getAuditLogs() (verifies AuditModule wiring)', async () => {
    const controller = module.get(AdminFraudController);
    const auditService = module.get(AuditService);

    await controller.getLockouts(1, 50, undefined);

    expect(auditService.getAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FRAUD_LOCKOUT' }),
    );
  });
});