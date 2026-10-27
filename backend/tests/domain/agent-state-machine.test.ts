import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/domain/agent/agent.types.js';
import { AgentStateMachine, InvalidAgentTransitionError } from '../../src/domain/agent/agent.state-machine.js';

describe('AgentStateMachine', () => {
  const createMockAgent = (overrides?: Partial<Agent>): Agent => ({
    id: 'agent-101',
    campaignId: 'camp-1',
    name: 'Alice Johnson',
    state: 'OFFLINE',
    currentCallId: null,
    version: 1,
    reservationLeaseExpiresAt: null,
    lastStateChangeAt: new Date(),
    stateChangeReason: 'Initialized',
    stats: { callsHandled: 0, totalTalkTimeSeconds: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it('allows valid progression: OFFLINE -> AVAILABLE -> RESERVED -> DIALING -> CONNECTED -> WRAP_UP -> AVAILABLE', () => {
    let agent = createMockAgent({ state: 'OFFLINE' });

    agent = AgentStateMachine.transition(agent, 'AVAILABLE', 'Agent logged in');
    expect(agent.state).toBe('AVAILABLE');
    expect(agent.version).toBe(2);

    agent = AgentStateMachine.transition(agent, 'RESERVED', 'Matched call', 'call-99');
    expect(agent.state).toBe('RESERVED');
    expect(agent.currentCallId).toBe('call-99');

    agent = AgentStateMachine.transition(agent, 'DIALING', 'Initiating trunk');
    expect(agent.state).toBe('DIALING');

    agent = AgentStateMachine.transition(agent, 'CONNECTED', 'Bridge established');
    expect(agent.state).toBe('CONNECTED');

    agent = AgentStateMachine.transition(agent, 'WRAP_UP', 'Call ended');
    expect(agent.state).toBe('WRAP_UP');

    agent = AgentStateMachine.transition(agent, 'AVAILABLE', 'Wrap-up finished');
    expect(agent.state).toBe('AVAILABLE');
    expect(agent.currentCallId).toBeNull();
  });

  it('rejects reserving an agent who is not in AVAILABLE state', () => {
    const offlineAgent = createMockAgent({ state: 'OFFLINE' });
    expect(() => {
      AgentStateMachine.transition(offlineAgent, 'RESERVED', 'Illegal reserve');
    }).toThrow(InvalidAgentTransitionError);

    const pausedAgent = createMockAgent({ state: 'PAUSED' });
    expect(() => {
      AgentStateMachine.transition(pausedAgent, 'RESERVED', 'Illegal reserve');
    }).toThrow(InvalidAgentTransitionError);

    const connectedAgent = createMockAgent({ state: 'CONNECTED' });
    expect(() => {
      AgentStateMachine.transition(connectedAgent, 'RESERVED', 'Illegal reserve');
    }).toThrow(InvalidAgentTransitionError);
  });

  it('allows reservation rollback to AVAILABLE if setup is aborted', () => {
    const reservedAgent = createMockAgent({ state: 'RESERVED', currentCallId: 'call-1' });
    const rolledBack = AgentStateMachine.transition(reservedAgent, 'AVAILABLE', 'Call setup aborted');
    expect(rolledBack.state).toBe('AVAILABLE');
    expect(rolledBack.currentCallId).toBeNull();
  });

  it('enforces single call ownership invariant on return to AVAILABLE', () => {
    const agentInDial = createMockAgent({ state: 'DIALING', currentCallId: 'call-2' });
    const released = AgentStateMachine.transition(agentInDial, 'AVAILABLE', 'Carrier rejected');
    expect(released.currentCallId).toBeNull();
  });
});

