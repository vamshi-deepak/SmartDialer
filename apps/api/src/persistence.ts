import mongoose, { Schema } from "mongoose";
import type { MemoryStore } from "@smartdialer/core";

const recordSchema = new Schema({
  recordId: { type: String, required: true, unique: true },
  kind: { type: String, required: true, index: true },
  campaignId: { type: String, index: true },
  state: { type: String, index: true },
  snapshot: { type: Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, required: true }
}, { versionKey: false });

const eventSchema = new Schema({
  eventId: { type: String, required: true, unique: true },
  callId: { type: String, required: true, index: true },
  outcome: { type: Schema.Types.Mixed, required: true },
  receivedAt: { type: Date, required: true }
}, { versionKey: false });

const AuditRecord = mongoose.models.AuditRecord ?? mongoose.model("AuditRecord", recordSchema);
const EventRecord = mongoose.models.ProviderEvent ?? mongoose.model("ProviderEvent", eventSchema);

export async function connectMongo(uri: string): Promise<void> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
  await Promise.all([AuditRecord.init(), EventRecord.init()]);
}

export async function persistSnapshot(store: MemoryStore): Promise<void> {
  const records = [
    ...[...store.campaigns.values()].map((value) => ({ kind: "campaign", recordId: value.id, campaignId: value.id, state: value.state, snapshot: value })),
    ...[...store.agents.values()].map((value) => ({ kind: "agent", recordId: value.id, campaignId: value.campaignId, state: value.state, snapshot: value })),
    ...[...store.borrowers.values()].map((value) => ({ kind: "borrower", recordId: value.id, campaignId: value.campaignId, state: value.state, snapshot: value })),
    ...[...store.calls.values()].map((value) => ({ kind: "call", recordId: value.id, campaignId: value.campaignId, state: value.state, snapshot: value }))
  ];
  if (records.length) {
    await AuditRecord.bulkWrite(records.map((record) => ({
      updateOne: { filter: { recordId: record.recordId }, update: { $set: { ...record, updatedAt: new Date() } }, upsert: true }
    })), { ordered: false });
  }
  const outcomes = [...store.events.values()];
  if (outcomes.length) {
    await EventRecord.bulkWrite(outcomes.map((outcome) => ({
      updateOne: { filter: { eventId: outcome.eventId }, update: { $setOnInsert: { eventId: outcome.eventId, callId: outcome.callId, outcome, receivedAt: new Date(outcome.receivedAt) } }, upsert: true }
    })), { ordered: false });
  }
}