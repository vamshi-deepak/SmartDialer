import { Schema, model } from 'mongoose';
import { Agent, AgentState } from '../../domain/agent/agent.types.js';
import { Borrower, BorrowerState } from '../../domain/borrower/borrower.types.js';
import { Call, CallState } from '../../domain/call/call.types.js';
import { Campaign, CampaignStatus, DialingMode } from '../../campaign/types.js';

// 1. Campaign Schema
export interface CampaignDoc extends Omit<Campaign, 'id'> {
  _id: string;
}

export const CampaignSchema = new Schema<CampaignDoc>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'PAUSED', 'STOPPED'] as CampaignStatus[],
      default: 'STOPPED',
      index: true,
    },
    config: {
      dialingMode: {
        type: String,
        enum: ['PROGRESSIVE', 'PREDICTIVE'] as DialingMode[],
        default: 'PROGRESSIVE',
      },
      maxConcurrentCalls: { type: Number, default: 50 },
      targetAbandonmentRate: { type: Number, default: 0.03 },
      reservationLeaseDurationSeconds: { type: Number, default: 15 },
      providerId: { type: String, default: 'reliable' },
    },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const CampaignModel = model<CampaignDoc>('Campaign', CampaignSchema);

// 2. Agent Schema
export interface AgentDoc extends Omit<Agent, 'id'> {
  _id: string;
}

export const AgentSchema = new Schema<AgentDoc>(
  {
    _id: { type: String, required: true },
    campaignId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    state: {
      type: String,
      enum: ['OFFLINE', 'AVAILABLE', 'RESERVED', 'DIALING', 'CONNECTED', 'WRAP_UP', 'PAUSED'] as AgentState[],
      default: 'OFFLINE',
      index: true,
    },
    currentCallId: { type: String, default: null, index: true },
    version: { type: Number, default: 1, index: true },
    reservationLeaseExpiresAt: { type: Date, default: null, index: true },
    lastStateChangeAt: { type: Date, default: Date.now },
    stateChangeReason: { type: String, default: 'Created' },
    stats: {
      callsHandled: { type: Number, default: 0 },
      totalTalkTimeSeconds: { type: Number, default: 0 },
      lastConnectedAt: { type: Date },
    },
  },
  { timestamps: true }
);

// Compound index for fast atomic reservation queries: find available agent with specific version
AgentSchema.index({ campaignId: 1, state: 1, version: 1 });
AgentSchema.index({ campaignId: 1, reservationLeaseExpiresAt: 1 });

export const AgentModel = model<AgentDoc>('Agent', AgentSchema);

// 3. Borrower Schema
export interface BorrowerDoc extends Omit<Borrower, 'id'> {
  _id: string;
}

export const BorrowerSchema = new Schema<BorrowerDoc>(
  {
    _id: { type: String, required: true },
    campaignId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    debtAmount: { type: Number, required: true },
    priority: { type: Number, default: 1, index: true },
    state: {
      type: String,
      enum: ['QUEUED', 'RESERVED', 'DIALING', 'CONNECTED', 'COMPLETED', 'UNREACHABLE'] as BorrowerState[],
      default: 'QUEUED',
      index: true,
    },
    attemptsCount: { type: Number, default: 0 },
    version: { type: Number, default: 1, index: true },
    lastAttemptAt: { type: Date, default: null },
    reservationLeaseExpiresAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

BorrowerSchema.index({ campaignId: 1, state: 1, priority: -1, createdAt: 1 });

export const BorrowerModel = model<BorrowerDoc>('Borrower', BorrowerSchema);

// 4. Call Schema
export interface CallDoc extends Omit<Call, 'id'> {
  _id: string;
}

export const CallSchema = new Schema<CallDoc>(
  {
    _id: { type: String, required: true },
    campaignId: { type: String, required: true, index: true },
    borrowerId: { type: String, required: true, index: true },
    agentId: { type: String, default: null, index: true },
    providerId: { type: String, default: null },
    providerCallId: { type: String, default: null, index: true },
    state: {
      type: String,
      enum: [
        'QUEUED',
        'RESERVED',
        'INITIATED',
        'RINGING',
        'ANSWERED',
        'CONNECTED',
        'COMPLETED',
        'FAILED',
        'CANCELLED',
      ] as CallState[],
      default: 'QUEUED',
      index: true,
    },
    version: { type: Number, default: 1 },
    queuedAt: { type: Date, default: Date.now },
    reservedAt: { type: Date, default: null },
    initiatedAt: { type: Date, default: null },
    ringingAt: { type: Date, default: null },
    answeredAt: { type: Date, default: null },
    connectedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
    failureReason: { type: String, default: null },
    eventHistory: [
      {
        eventId: String,
        eventType: String,
        fromState: String,
        toState: String,
        timestamp: Date,
        reason: String,
        payload: Schema.Types.Mixed,
      },
    ],
  },
  { timestamps: true }
);

CallSchema.index({ campaignId: 1, state: 1 });
CallSchema.index({ campaignId: 1, updatedAt: 1 });

export const CallModel = model<CallDoc>('Call', CallSchema);

