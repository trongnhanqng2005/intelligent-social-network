import { activityCaptureEnabled, activityEventTypes, newActivityEvent, recordActivityEvent } from './activity-event.js';

describe('activity events', () => {
  const original = { env: process.env.NODE_ENV, database: process.env.NEO4J_DATABASE, enabled: process.env.ACTIVITY_CAPTURE_ENABLED,
    uri: process.env.NEO4J_URI, writeWindow: process.env.ISN_TEST_WRITE_WINDOW };
  afterEach(() => {
    if (original.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.env;
    if (original.database === undefined) delete process.env.NEO4J_DATABASE; else process.env.NEO4J_DATABASE = original.database;
    if (original.enabled === undefined) delete process.env.ACTIVITY_CAPTURE_ENABLED; else process.env.ACTIVITY_CAPTURE_ENABLED = original.enabled;
    if (original.uri === undefined) delete process.env.NEO4J_URI; else process.env.NEO4J_URI = original.uri;
    if (original.writeWindow === undefined) delete process.env.ISN_TEST_WRITE_WINDOW; else process.env.ISN_TEST_WRITE_WINDOW = original.writeWindow;
  });

  function enableCapture() {
    process.env.NODE_ENV = 'test';
    process.env.NEO4J_DATABASE = 'isn-test';
    process.env.NEO4J_URI = 'neo4j://127.0.0.1:7687';
    process.env.ISN_TEST_WRITE_WINDOW = 'owner-approved';
    process.env.ACTIVITY_CAPTURE_ENABLED = 'true';
  }

  it('is disabled unless explicitly enabled in the test database', () => {
    enableCapture();
    delete process.env.ACTIVITY_CAPTURE_ENABLED;
    expect(activityCaptureEnabled()).toBe(false);
    process.env.ACTIVITY_CAPTURE_ENABLED = 'true';
    expect(activityCaptureEnabled()).toBe(true);
    process.env.NEO4J_DATABASE = 'isn-dev';
    expect(() => activityCaptureEnabled()).toThrow('guarded local isn-test write window');
  });

  it('uses the flat allowlisted contract and writes no content fields', async () => {
    const event = newActivityEvent({ eventType: 'POST_CREATED', occurredAt: '2026-11-04T00:00:00.000Z', actorId: 'actor', objectType: 'POST', objectId: 'post' });
    expect(event).toMatchObject({ schemaVersion: 1, source: 'APPLICATION', eventType: 'POST_CREATED' });
    expect(activityEventTypes).toContain(event.eventType);
    enableCapture();
    const tx = { run: jest.fn().mockResolvedValue(undefined) };
    await recordActivityEvent(tx as never, event);
    expect(tx.run.mock.calls[0]?.[0]).toContain('CREATE (:ActivityEvent');
    expect(tx.run.mock.calls[0]?.[1]).not.toHaveProperty('content');
  });

  it('does nothing when capture is disabled', async () => {
    process.env.ACTIVITY_CAPTURE_ENABLED = 'false';
    const tx = { run: jest.fn() };
    await recordActivityEvent(tx as never, newActivityEvent({ eventType: 'POST_CREATED', occurredAt: '2026-11-04T00:00:00.000Z', actorId: 'actor', objectType: 'POST', objectId: 'post' }));
    expect(tx.run).not.toHaveBeenCalled();
  });

  it('propagates event write failures so the enclosing transaction can roll back', async () => {
    enableCapture();
    const failure = new Error('write failed');
    const tx = { run: jest.fn().mockRejectedValue(failure) };
    await expect(recordActivityEvent(tx as never, newActivityEvent({ eventType: 'POST_CREATED', occurredAt: '2026-11-04T00:00:00.000Z', actorId: 'actor', objectType: 'POST', objectId: 'post' }))).rejects.toBe(failure);
  });

  it.each(['test/remote', 'development/local', 'production/local'])('fails closed for an invalid enabled capture target (%s)', (target) => {
    enableCapture();
    const [nodeEnv, database] = target.split('/');
    process.env.NODE_ENV = nodeEnv!;
    process.env.NEO4J_DATABASE = database!;
    expect(() => activityCaptureEnabled()).toThrow('guarded local isn-test write window');
  });
});
