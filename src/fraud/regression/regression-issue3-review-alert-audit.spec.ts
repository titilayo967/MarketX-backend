/**
 * REGRESSION TEST — Issue 3: Missing Audit Event in reviewAlert() (MODERATE)
 * ---------------------------------------------------------------------------
 * Fix: fraud.service.ts — reviewAlert() previously returned the saved alert
 * without emitting a `fraud.alert_reviewed` event, creating a gap in the
 * audit trail.  The fix adds eventEmitter.emit('fraud.alert_reviewed', …)
 * with correct payload including previousStatus / newStatus diff.
 *
 * Also covers the edge cases flagged as ⚠️ Tests Missing in DEBUG_REPORT.md:
 *   • null userId / missing metadata
 *   • error handling paths
 *   • audit listener end-to-end for fraud.alert_reviewed
 */

/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { FraudService } from '../fraud.service';
import { AuditActionType, AuditStatus } from '../../audit/entities/audit-log.entity';

// ── Shared helpers ──────────────────────────────────────────────────────────

const makeFakeAlert = (overrides = {}) => ({
  id: 'alert-1',
  userId: 'user-1',
  riskScore: 85,
  status: 'pending',
  metadata: {},
  ...overrides,
});

const buildService = (alertOverrides = {}, repoOverrides = {}) => {
  const alert = makeFakeAlert(alertOverrides);

  const fakeRepo: any = {
    create: (o: any) => ({ ...o }),
    save: jest.fn(async (o: any) => ({ ...o, id: alert.id })),
    findAndCount: jest.fn(async () => [[], 0]),
    findOneBy: jest.fn(async () => alert),
    findOne: jest.fn(async () => null),
    ...repoOverrides,
  };

  const fakeOrderRepo: any = {
    findOne: jest.fn(async () => null),
    save: jest.fn(async (o: any) => o),
  };

  const fakeUserRepo: any = {
    findOne: jest.fn(async () => null),
    save: jest.fn(async (o: any) => o),
  };

  const fakeGeo: any = {
    getLocationFromIp: jest.fn(async () => null),
    geocodeAddress: jest.fn(async () => null),
    distanceMiles: jest.fn(() => 0),
  };

  const fakeCache: any = { increment: jest.fn(async () => 0) };

  const fakeEmail: any = {
    sendAccountLocked: jest.fn(async () => ({})),
  };

  const fakeWebhook: any = { notifyAdmin: jest.fn(async () => ({})) };

  const fakeLogger: any = {
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };

  const fakeAudit: any = {
    logStateChange: jest.fn(async () => ({ id: 'audit-1' })),
  };

  const emitSpy = jest.fn();
  const fakeEmitter: any = { emit: emitSpy };

// fraud.service.ts has a duplicate `logger` param (known TS2300 bug in source)
  // cast to any to bypass the type error and match the JS constructor at runtime
  const service = new (FraudService as any)(
    fakeRepo,
    fakeOrderRepo,
    fakeUserRepo,
    fakeGeo,
    fakeCache,
    fakeEmail,
    fakeWebhook,
    fakeLogger,
    fakeAudit,
    fakeEmitter,
  );

  return { service, fakeRepo, emitSpy, fakeAudit, alert };
};

// ── Test suite ──────────────────────────────────────────────────────────────

describe('[REGRESSION] Issue 3 — reviewAlert() must emit fraud.alert_reviewed', () => {
  afterEach(() => jest.clearAllMocks());

  // ── Core regression guard ────────────────────────────────────────────────

  it('emits fraud.alert_reviewed when an alert is reviewed (regression guard)', async () => {
    const { service, emitSpy } = buildService({ status: 'pending' });

    await service.reviewAlert('alert-1', { mark: 'safe', reviewer: 'admin-1' });

    expect(emitSpy).toHaveBeenCalledWith(
      'fraud.alert_reviewed',
      expect.any(Object),
    );
  });

  it('does NOT silently swallow the event when reviewer is omitted', async () => {
    const { service, emitSpy } = buildService({ status: 'pending' });

    await service.reviewAlert('alert-1', { mark: 'reviewed' });

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy.mock.calls[0][0]).toBe('fraud.alert_reviewed');
  });

  // ── Payload correctness ──────────────────────────────────────────────────

  it('event payload contains correct userId (reviewer)', async () => {
    const { service, emitSpy } = buildService({ status: 'pending' });

    await service.reviewAlert('alert-1', { mark: 'safe', reviewer: 'admin-99' });

    const payload = emitSpy.mock.calls[0][1];
    expect(payload.userId).toBe('admin-99');
  });

  it('falls back to "system" userId when reviewer is absent', async () => {
    const { service, emitSpy } = buildService({ status: 'pending' });

    await service.reviewAlert('alert-1', { mark: 'safe' });

    const payload = emitSpy.mock.calls[0][1];
    expect(payload.userId).toBe('system');
  });

  it('event payload contains statePreviousValue and stateNewValue diff', async () => {
    const { service, emitSpy } = buildService({ status: 'pending' });

    await service.reviewAlert('alert-1', { mark: 'reviewed', reviewer: 'admin-1' });

    const payload = emitSpy.mock.calls[0][1];
    expect(payload.statePreviousValue).toEqual({ status: 'pending' });
    expect(payload.stateNewValue).toEqual({ status: 'reviewed' });
  });

  it('event payload includes resourceType: "fraud_alert" and resourceId', async () => {
    const { service, emitSpy } = buildService({ status: 'pending' });

    await service.reviewAlert('alert-1', { mark: 'suspended', reviewer: 'admin-1' });

    const payload = emitSpy.mock.calls[0][1];
    expect(payload.resourceType).toBe('fraud_alert');
    expect(payload.resourceId).toBe('alert-1');
  });

  it('event payload includes actionType FRAUD_REVIEW', async () => {
    const { service, emitSpy } = buildService({ status: 'pending' });

    await service.reviewAlert('alert-1', { mark: 'safe', reviewer: 'admin-1' });

    const payload = emitSpy.mock.calls[0][1];
    expect(payload.actionType).toBe(AuditActionType.FRAUD_REVIEW);
  });

  it('event payload status is SUCCESS', async () => {
    const { service, emitSpy } = buildService({ status: 'pending' });

    await service.reviewAlert('alert-1', { mark: 'safe', reviewer: 'admin-1' });

    const payload = emitSpy.mock.calls[0][1];
    expect(payload.status).toBe(AuditStatus.SUCCESS);
  });

  it('metadata includes previousStatus, newStatus, riskScore and reviewer', async () => {
    const { service, emitSpy } = buildService({ status: 'pending', riskScore: 90 });

    await service.reviewAlert('alert-1', { mark: 'reviewed', reviewer: 'admin-7' });

    const { metadata } = emitSpy.mock.calls[0][1];
    expect(metadata.previousStatus).toBe('pending');
    expect(metadata.newStatus).toBe('reviewed');
    expect(metadata.riskScore).toBe(90);
    expect(metadata.reviewer).toBe('admin-7');
  });

  // ── Edge cases: null userId / missing metadata ────────────────────────────

  it('handles alert with null userId without throwing', async () => {
    const { service, emitSpy } = buildService({ status: 'pending', userId: null });

    await expect(
      service.reviewAlert('alert-1', { mark: 'safe', reviewer: 'admin-1' }),
    ).resolves.not.toThrow();

    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('handles alert with missing metadata without throwing', async () => {
    const { service, emitSpy } = buildService({ status: 'pending', metadata: undefined });

    await expect(
      service.reviewAlert('alert-1', { mark: 'safe', reviewer: 'admin-1' }),
    ).resolves.not.toThrow();

    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('handles reviewer as empty string — falls back to "system"', async () => {
    const { service, emitSpy } = buildService({ status: 'pending' });

    await service.reviewAlert('alert-1', { mark: 'safe', reviewer: '' });

    const payload = emitSpy.mock.calls[0][1];
    // empty string is falsy, so should fall back to 'system'
    expect(payload.userId).toBe('system');
  });

  // ── Return value ─────────────────────────────────────────────────────────

  it('returns null when alert is not found', async () => {
    const { service } = buildService(
      {},
      { findOneBy: jest.fn(async () => null) },
    );

    const result = await service.reviewAlert('non-existent', { mark: 'safe' });
    expect(result).toBeNull();
  });

  it('does NOT emit the event when alert is not found', async () => {
    const { service, emitSpy } = buildService(
      {},
      { findOneBy: jest.fn(async () => null) },
    );

    await service.reviewAlert('non-existent', { mark: 'safe' });
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('returns the updated alert after review', async () => {
    const { service } = buildService({ status: 'pending' });

    const result = await service.reviewAlert('alert-1', {
      mark: 'reviewed',
      reviewer: 'admin-1',
    });

    expect(result).not.toBeNull();
    expect((result as any).status).toBe('reviewed');
  });

  it('persists the new status to the repository', async () => {
    const { service, fakeRepo } = buildService({ status: 'pending' });

    await service.reviewAlert('alert-1', { mark: 'suspended', reviewer: 'admin-1' });

    expect(fakeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suspended' }),
    );
  });
});

// ── Audit listener regression: fraud.alert_reviewed ─────────────────────────

describe('[REGRESSION] Issue 3 — AuditEventListener handles fraud.alert_reviewed', () => {
  // Dynamic import to avoid circular DI in unit test context
  let AuditEventListener: any;

  beforeAll(async () => {
    ({ AuditEventListener } = await import('../../audit/audit.listener'));
  });

  afterEach(() => jest.clearAllMocks());

  const buildListener = () => {
    const auditService: any = {
      logStateChange: jest.fn(async () => ({ id: 'audit-ok' })),
    };
    const logger: any = {
      debug: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    // AuditEventListener constructor typically receives (AuditService, Logger)
    const listener = new AuditEventListener(auditService, logger);
    return { listener, auditService };
  };

  it('handleFraudAlertReviewed() calls auditService.logStateChange', async () => {
    const { listener, auditService } = buildListener();

    await listener.handleFraudAlertReviewed({
      userId: 'admin-1',
      actionType: 'FRAUD_REVIEW',
      resourceType: 'fraud_alert',
      resourceId: 'alert-1',
      status: 'SUCCESS',
      statePreviousValue: { status: 'pending' },
      stateNewValue: { status: 'safe' },
    });

    expect(auditService.logStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'FRAUD_REVIEW',
        resourceType: 'fraud_alert',
        resourceId: 'alert-1',
      }),
    );
  });

  it('handleFraudAlertReviewed() does not throw when auditService fails', async () => {
    const { listener, auditService } = buildListener();
    auditService.logStateChange.mockRejectedValueOnce(new Error('DB down'));

    await expect(
      listener.handleFraudAlertReviewed({
        userId: 'admin-1',
        actionType: 'FRAUD_REVIEW',
        resourceId: 'alert-1',
        status: 'SUCCESS',
      }),
    ).resolves.not.toThrow();
  });

  it('handleFraudAlertCreated() calls auditService with FRAUD_ALERT actionType', async () => {
    const { listener, auditService } = buildListener();

    await listener.handleFraudAlertCreated({
      userId: 'user-1',
      actionType: 'FRAUD_ALERT',
      resourceType: 'fraud_alert',
      resourceId: 'alert-2',
      status: 'WARNING',
      metadata: { riskScore: 85 },
    });

    expect(auditService.logStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'FRAUD_ALERT',
        resourceType: 'fraud_alert',
      }),
    );
  });

  it('handleFraudAccountLocked() calls auditService with FRAUD_LOCKOUT actionType', async () => {
    const { listener, auditService } = buildListener();

    await listener.handleFraudAccountLocked({
      userId: 'user-1',
      actionType: 'FRAUD_LOCKOUT',
      resourceId: 'user-1',
      status: 'WARNING',
      metadata: { riskScore: 95, flagCount: 3 },
    });

    expect(auditService.logStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'FRAUD_LOCKOUT',
        resourceType: 'user',
      }),
    );
  });

  it('handleFraudAlertCreated() does not throw when auditService fails', async () => {
    const { listener, auditService } = buildListener();
    auditService.logStateChange.mockRejectedValueOnce(new Error('Timeout'));

    await expect(
      listener.handleFraudAlertCreated({
        userId: 'user-1',
        actionType: 'FRAUD_ALERT',
        resourceId: 'alert-3',
        status: 'WARNING',
      }),
    ).resolves.not.toThrow();
  });
});