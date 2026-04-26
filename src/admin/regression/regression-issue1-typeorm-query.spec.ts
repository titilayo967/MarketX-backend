/**
 * REGRESSION TEST — Issue 1: TypeORM Query Syntax Error (CRITICAL)
 * ----------------------------------------------------------------
 * Fix: admin-fraud.controller.ts — getStats() previously used MongoDB
 * syntax `{ $gte: last24Hours }` which causes runtime errors with TypeORM.
 * Corrected to `new Date(Date.now() - N)` (plain Date value for TypeORM).
 *
 * This suite guards against any re-introduction of Mongo-style operators
 * inside TypeORM `.count()` calls and verifies the stats endpoint returns
 * correctly-typed numeric values for every time bucket.
 */

/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminFraudController } from '../admin-fraud.controller';
import { FraudAlert } from '../../fraud/entities/fraud-alert.entity';
import { AuditService } from '../../audit/audit.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('[REGRESSION] Issue 1 — TypeORM date query syntax in getStats()', () => {
  let controller: AdminFraudController;
  let countSpy: jest.Mock;

  const buildModule = (countImpl: () => Promise<number>) =>
    Test.createTestingModule({
      controllers: [AdminFraudController],
      providers: [
        {
          provide: getRepositoryToken(FraudAlert),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            createQueryBuilder: jest.fn().mockReturnValue({
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
              getMany: jest.fn().mockResolvedValue([]),
              getCount: jest.fn().mockResolvedValue(0),
            }),
            save: jest.fn().mockImplementation(async (o: unknown) => o),
            count: countImpl,
          },
        },
        {
          provide: AuditService,
          useValue: {
            getAuditLogs: jest.fn().mockResolvedValue({
              data: [],
              meta: { total: 0, page: 1, limit: 50, totalPages: 0 },
            }),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    })
      .compile()
      .then((m) => m.get<AdminFraudController>(AdminFraudController));

  beforeEach(async () => {
    countSpy = jest.fn().mockResolvedValue(3);
    controller = await buildModule(countSpy);
  });

  afterEach(() => jest.clearAllMocks());

  // ── core regression: stats must return without throwing ──────────────────

  it('getStats() resolves without throwing (regression guard)', async () => {
    await expect(controller.getStats()).resolves.not.toThrow();
  });

  it('getStats() passes a plain Date (not a Mongo $gte object) to repo.count()', async () => {
    await controller.getStats();

    // Each call to count() must receive a `where.createdAt` that is a Date,
    // never a plain object with a `$gte` key (the old broken syntax).
    for (const call of countSpy.mock.calls) {
      const whereValue = call[0]?.where?.createdAt;
      expect(whereValue).toBeInstanceOf(Date);
      expect(typeof whereValue).not.toBe('object'); // catches Date, but not plain {}
      expect(whereValue).not.toMatchObject(
        expect.objectContaining({ $gte: expect.anything() }),
      );
    }
  });

  // ── shape / type assertions ───────────────────────────────────────────────

  it('getStats() returns numeric counts for all three alert buckets', async () => {
    const result = await controller.getStats();

    expect(typeof result.alerts.last24Hours).toBe('number');
    expect(typeof result.alerts.last7Days).toBe('number');
    expect(typeof result.alerts.last30Days).toBe('number');
  });

  it('getStats() returns numeric counts for lockout buckets', async () => {
    const result = await controller.getStats();

    expect(typeof result.lockouts.last24Hours).toBe('number');
    expect(typeof result.lockouts.last7Days).toBe('number');
  });

  it('getStats() reflects the count returned by the repository', async () => {
    countSpy.mockResolvedValue(7);
    const result = await controller.getStats();

    // alerts.last24Hours uses repo.count, so must equal 7
    expect(result.alerts.last24Hours).toBe(7);
    expect(result.alerts.last7Days).toBe(7);
    expect(result.alerts.last30Days).toBe(7);
  });

  // ── edge cases ────────────────────────────────────────────────────────────

  it('getStats() handles repo.count() returning 0 gracefully', async () => {
    countSpy.mockResolvedValue(0);
    const result = await controller.getStats();

    expect(result.alerts.last24Hours).toBe(0);
    expect(result.alerts.last7Days).toBe(0);
    expect(result.alerts.last30Days).toBe(0);
  });

  it('getStats() propagates a repository error', async () => {
    countSpy.mockRejectedValue(new Error('DB connection lost'));

    await expect(controller.getStats()).rejects.toThrow('DB connection lost');
  });
});