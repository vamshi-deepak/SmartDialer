import { describe, it, expect } from 'vitest';
import { Call } from '../../src/domain/call/call.types.js';
import { CallStateMachine } from '../../src/domain/call/call.state-machine.js';

describe('CallStateMachine', () => {
  const createMockCall = (overrides?: Partial<Call>): Call => ({
    id: 'call-100',
    campaignId: 'camp-1',
    borrowerId: 'bor-1',
    agentId: 'agent-1',
    providerId: 'reliable-provider',
    providerCallId: 'prov-call-1',
    state: 'QUEUED',
    version: 1,
    queuedAt: new Date(Date.now() - 5000),
    reservedAt: null,
    initiatedAt: null,
    ringingAt: null,
    answeredAt: null,
    connectedAt: null,
    endedAt: null,
    durationSeconds: 0,
    failureReason: null,
    eventHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it('progresses smoothly through full happy path: QUEUED -> RESERVED -> INITIATED -> RINGING -> ANSWERED -> CONNECTED -> COMPLETED', () => {
    let call = createMockCall();

    let res = CallStateMachine.transition(call, 'RESERVED', 'Matched with agent', 'evt-1');
    expect(res.applied).toBe(true);
    call = res.call;
    expect(call.state).toBe('RESERVED');

    res = CallStateMachine.transition(call, 'INITIATED', 'Sent to provider', 'evt-2');
    expect(res.applied).toBe(true);
    call = res.call;
    expect(call.state).toBe('INITIATED');

    res = CallStateMachine.transition(call, 'RINGING', 'Carrier 180 Ringing', 'evt-3');
    expect(res.applied).toBe(true);
    call = res.call;
    expect(call.state).toBe('RINGING');

    res = CallStateMachine.transition(call, 'ANSWERED', '200 OK Borrower picked up', 'evt-4');
    expect(res.applied).toBe(true);
    call = res.call;
    expect(call.state).toBe('ANSWERED');

    res = CallStateMachine.transition(call, 'CONNECTED', 'Audio bridge online', 'evt-5');
    expect(res.applied).toBe(true);
    call = res.call;
    expect(call.state).toBe('CONNECTED');

    res = CallStateMachine.transition(call, 'COMPLETED', 'Hangup', 'evt-6');
    expect(res.applied).toBe(true);
    call = res.call;
    expect(call.state).toBe('COMPLETED');
    expect(CallStateMachine.isTerminal(call.state)).toBe(true);
  });

  it('guarantees terminal state immutability: late ANSWERED event after COMPLETED is blocked', () => {
    const completedCall = createMockCall({ state: 'COMPLETED', endedAt: new Date() });
    const res = CallStateMachine.transition(
      completedCall,
      'ANSWERED',
      'Late provider webhook',
      'evt-late'
    );

    expect(res.applied).toBe(false);
    expect(res.isTerminalBlocked).toBe(true);
    expect(res.call.state).toBe('COMPLETED');
  });

  it('tolerates duplicate events idempotently without throwing', () => {
    const answeredCall = createMockCall({ state: 'ANSWERED' });
    const res = CallStateMachine.transition(
      answeredCall,
      'ANSWERED',
      'Duplicate provider webhook',
      'evt-dup'
    );

    expect(res.applied).toBe(false);
    expect(res.isDuplicate).toBe(true);
    expect(res.call.state).toBe('ANSWERED');
  });

  it('tolerates out-of-order stale events (e.g. RINGING received after ANSWERED)', () => {
    const answeredCall = createMockCall({ state: 'ANSWERED' });
    const res = CallStateMachine.transition(
      answeredCall,
      'RINGING',
      'Out of order network packet',
      'evt-stale'
    );

    expect(res.applied).toBe(false);
    expect(res.call.state).toBe('ANSWERED');
    expect(res.reason).toContain('out-of-order');
  });
});

