import { z } from 'zod';

export const CreateCampaignSchema = z.object({
  name: z.string().min(2).max(100),
  dialingMode: z.enum(['PROGRESSIVE', 'PREDICTIVE']).default('PROGRESSIVE'),
  maxConcurrentCalls: z.number().int().min(1).max(1000).default(50),
  targetAbandonmentRate: z.number().min(0).max(0.2).default(0.03),
  providerId: z.enum(['reliable', 'unreliable']).default('reliable'),
});

export const UpdateDialingModeSchema = z.object({
  mode: z.enum(['PROGRESSIVE', 'PREDICTIVE']),
});

export const SeedCampaignSchema = z.object({
  agentCount: z.number().int().min(1).max(500).default(20),
  borrowerCount: z.number().int().min(1).max(2000).default(100),
});

export const InjectEventSchema = z.object({
  eventId: z.string().optional(),
  callId: z.string().min(1),
  providerCallId: z.string().optional(),
  campaignId: z.string().min(1),
  eventType: z.enum([
    'RINGING',
    'ANSWERED',
    'CONNECTED',
    'COMPLETED',
    'CANCELLED',
    'FAILED',
    'BUSY',
    'NO_ANSWER',
  ]),
});

export const FailureScenarioSchema = z.object({
  scenario: z.enum([
    'WORKER_CRASH_RESERVATION',
    'PROVIDER_OUTAGE',
    'AGENT_DROP',
    'DUPLICATE_EVENTS',
    'OUT_OF_ORDER_EVENTS',
  ]),
  campaignId: z.string(),
});

