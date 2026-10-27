import mongoose from 'mongoose';
import { IAgentRepository } from './domain/agent/agent.repository.interface.js';
import { IBorrowerRepository } from './domain/borrower/borrower.repository.interface.js';
import { ICallRepository } from './domain/call/call.repository.interface.js';
import { InMemoryAgentRepository } from './storage/in-memory/in-memory-agent.repository.js';
import { InMemoryBorrowerRepository } from './storage/in-memory/in-memory-borrower.repository.js';
import { InMemoryCallRepository } from './storage/in-memory/in-memory-call.repository.js';
import { MongooseAgentRepository } from './storage/mongoose/mongoose-agent.repository.js';
import { MongooseBorrowerRepository } from './storage/mongoose/mongoose-borrower.repository.js';
import { MongooseCallRepository } from './storage/mongoose/mongoose-call.repository.js';
import { CircuitBreaker } from './safety/circuit-breaker.js';
import { SafetyController } from './safety/safety-controller.js';
import { ReliableMockProvider } from './providers/reliable-mock-provider.js';
import { UnreliableMockProvider } from './providers/unreliable-mock-provider.js';
import { ITelecomProvider } from './providers/telecom-provider.interface.js';
import { ProviderEventProcessor } from './providers/provider-event-processor.js';
import { CallAllocator } from './allocator/call-allocator.js';
import { ProgressiveDialer } from './allocator/progressive-dialer.js';
import { PredictivePacingEngine } from './pacing/predictive-engine.js';
import { ReconciliationService } from './recovery/reconciliation-service.js';
import { CampaignManager } from './campaign/campaign-manager.js';
import { MetricsCollector } from './metrics/metrics-collector.js';

export interface ServiceContainer {
  agentRepo: IAgentRepository;
  borrowerRepo: IBorrowerRepository;
  callRepo: ICallRepository;
  circuitBreaker: CircuitBreaker;
  safetyController: SafetyController;
  reliableProvider: ReliableMockProvider;
  unreliableProvider: UnreliableMockProvider;
  currentProvider: ITelecomProvider;
  eventProcessor: ProviderEventProcessor;
  callAllocator: CallAllocator;
  progressiveDialer: ProgressiveDialer;
  pacingEngine: PredictivePacingEngine;
  reconciliationService: ReconciliationService;
  campaignManager: CampaignManager;
  metricsCollector: MetricsCollector;
  setProvider(type: 'reliable' | 'unreliable'): void;
}

export async function createContainer(
  storageMode: 'in-memory' | 'mongodb' = 'in-memory',
  mongoUri?: string,
  isSimulated = false
): Promise<ServiceContainer> {
  let agentRepo: IAgentRepository;
  let borrowerRepo: IBorrowerRepository;
  let callRepo: ICallRepository;

  if (storageMode === 'mongodb' && mongoUri) {
    await mongoose.connect(mongoUri);
    agentRepo = new MongooseAgentRepository();
    borrowerRepo = new MongooseBorrowerRepository();
    callRepo = new MongooseCallRepository();
  } else {
    agentRepo = new InMemoryAgentRepository();
    borrowerRepo = new InMemoryBorrowerRepository();
    callRepo = new InMemoryCallRepository();
  }

  const circuitBreaker = new CircuitBreaker({
    failureThreshold: 5,
    cooldownPeriodMs: 15000,
    halfOpenSuccessThreshold: 2,
  });

  const safetyController = new SafetyController(agentRepo, callRepo, circuitBreaker, {
    globalMaxConcurrentCalls: 100,
    maxOverdialRatio: 2.0,
    minHealthForPredictive: 0.7,
    minAgentsForPredictive: 3,
  });

  const reliableProvider = new ReliableMockProvider({
    latencyMs: isSimulated ? 0 : 30,
    failureRate: isSimulated ? 0 : 0.01,
    ringingDelayMs: Number(process.env.MOCK_RINGING_DELAY_MS) || 100,
    answeredDelayMs: Number(process.env.MOCK_ANSWERED_DELAY_MS) || 500,
    connectedDelayMs: Number(process.env.MOCK_CONNECTED_DELAY_MS) || 750,
    simulatedTalkDurationMs: Number(process.env.MOCK_TALK_DURATION_MS) || 15000,
    isSimulated,
  });
  const unreliableProvider = new UnreliableMockProvider({
    latencyMs: isSimulated ? 0 : 150,
    failureRate: 0.15,
    timeoutRate: 0.08,
    duplicateEventRate: 0.15,
    outOfOrderRate: 0.15,
    ringingDelayMs: Number(process.env.MOCK_RINGING_DELAY_MS) || 150,
    answeredDelayMs: Number(process.env.MOCK_ANSWERED_DELAY_MS) || 350,
    connectedDelayMs: Number(process.env.MOCK_CONNECTED_DELAY_MS) || 700,
    simulatedTalkDurationMs: Number(process.env.MOCK_TALK_DURATION_MS) || 15000,
    seed: 42,
    isSimulated,
  });

  let selectedProvider: ITelecomProvider = reliableProvider;
  const currentProvider: ITelecomProvider = {
    get id() { return selectedProvider.id; },
    get name() { return selectedProvider.name; },
    onEvent(handler) {
      reliableProvider.onEvent(handler);
      unreliableProvider.onEvent(handler);
    },
    initiateCall(request) {
      return selectedProvider.initiateCall(request);
    },
    terminateCall(providerCallId, reason) {
      return selectedProvider.terminateCall(providerCallId, reason);
    },
    getHealth() {
      return selectedProvider.getHealth();
    },
    injectEvent(event) {
      return selectedProvider.injectEvent(event);
    },
  };

  const eventProcessor = new ProviderEventProcessor(agentRepo, borrowerRepo, callRepo);

  // Wire provider webhooks to eventProcessor for both mock adapters.
  const processProviderEvent = async (evt: Parameters<ITelecomProvider['injectEvent']>[0]) => {
    await eventProcessor.processEvent(evt);
  };
  reliableProvider.onEvent(processProviderEvent);
  unreliableProvider.onEvent(processProviderEvent);

  let callAllocator = new CallAllocator(
    agentRepo,
    borrowerRepo,
    callRepo,
    safetyController,
    currentProvider,
    15000
  );

  let progressiveDialer = new ProgressiveDialer(
    agentRepo,
    borrowerRepo,
    safetyController,
    callAllocator
  );

  const pacingEngine = new PredictivePacingEngine();

  const reconciliationService = new ReconciliationService(
    agentRepo,
    borrowerRepo,
    callRepo,
    currentProvider
  );

  const metricsCollector = new MetricsCollector(
    agentRepo,
    callRepo,
    safetyController,
    eventProcessor,
    currentProvider
  );

  const campaignManager = new CampaignManager(
    agentRepo,
    borrowerRepo,
    callRepo,
    safetyController,
    progressiveDialer,
    callAllocator,
    pacingEngine,
    reconciliationService,
    currentProvider
  );

  const container: ServiceContainer = {
    agentRepo,
    borrowerRepo,
    callRepo,
    circuitBreaker,
    safetyController,
    reliableProvider,
    unreliableProvider,
    currentProvider,
    eventProcessor,
    callAllocator,
    progressiveDialer,
    pacingEngine,
    reconciliationService,
    campaignManager,
    metricsCollector,
    setProvider(type: 'reliable' | 'unreliable') {
      selectedProvider = type === 'reliable' ? reliableProvider : unreliableProvider;
    },
  };

  return container;
}
