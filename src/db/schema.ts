import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { Graph, Proposal } from "@/domain/types";
import type { ReplayClock } from "@/replay/clock";
import type { ReplayEvent } from "@/replay/events";
import type { AgentState } from "@/agent/protocol";
import type { Action } from "@/domain/types";

export const patients = sqliteTable("patients", {
  id: text("id").primaryKey(), syntheticLabel: text("synthetic_label").notNull(),
});
// The encounter is the consistency boundary. Projects/tasks/dependencies/sources/
// drafts form one typed aggregate, committed together rather than partially updated.
export const encounters = sqliteTable("encounters", {
  id: text("id").primaryKey(), patientId: text("patient_id").notNull().references(() => patients.id),
  unitId: text("unit_id").notNull(), version: integer("version").notNull(),
  snapshot: text("snapshot", { mode: "json" }).$type<Graph>().notNull(),
});
export const proposals = sqliteTable("proposals", {
  id: text("id").primaryKey(), encounterId: text("encounter_id").notNull().references(() => encounters.id),
  baseVersion: integer("base_version").notNull(),
  status: text("status", { enum: ["staged", "accepted", "rejected", "stale"] }).notNull().default("staged"),
  body: text("body", { mode: "json" }).$type<Proposal>().notNull(),
  acceptedBy: text("accepted_by"), acceptedVersion: integer("accepted_version"),
}, (table) => [index("proposals_encounter_idx").on(table.encounterId)]);
export const auditEntries = sqliteTable("audit_entries", {
  id: text("id").primaryKey(), encounterId: text("encounter_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  proposalId: text("proposal_id"), actorId: text("actor_id").notNull(),
  action: text("action").notNull(), version: integer("version").notNull(),
  createdAt: text("created_at").notNull(), previousHash: text("previous_hash").notNull(), hash: text("hash").notNull(),
});
export const ledgerEntries = sqliteTable("ledger_entries", {
  id: text("id").primaryKey(), bucket: text("bucket").notNull(),
  reservedMicrousd: integer("reserved_microusd").notNull(), actualMicrousd: integer("actual_microusd"),
  state: text("state", { enum: ["reserved", "settled", "uncertain", "released"] }).notNull(),
  createdAt: text("created_at").notNull(),
});
export const replaySessions = sqliteTable("replay_sessions", {
  id: text("id").primaryKey(), epoch: integer("epoch").notNull(),
  clock: text("clock", { mode: "json" }).$type<ReplayClock>().notNull(),
});
export const replayEvents = sqliteTable("replay_events", {
  id: text("id").primaryKey(), epoch: integer("epoch").notNull(),
  encounterId: text("encounter_id").notNull(),
  body: text("body", { mode: "json" }).$type<ReplayEvent>().notNull(),
});
export const fundingRecords = sqliteTable("funding_records", {
  id: text("id").primaryKey(), evidence: text("evidence", { mode: "json" }).$type<unknown>().notNull(),
});
export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(), encounterId: text("encounter_id").notNull(), actorId: text("actor_id").notNull(),
  unitId: text("unit_id").notNull().default("UNIT-A"),
  baseVersion: integer("base_version").notNull(),
  mode: text("mode").notNull(), status: text("status").notNull(),
  state: text("state", { mode: "json" }).$type<AgentState>().notNull(),
  actions: text("actions", { mode: "json" }).$type<Action[]>().notNull(),
  proposalId: text("proposal_id"), errorCode: text("error_code"), promptHash: text("prompt_hash"),
  createdAt: integer("created_at").notNull(), costMicrousd: integer("cost_microusd").notNull().default(0),
  resumeAfter: integer("resume_after", { mode: "boolean" }).notNull().default(false),
}, (table) => [uniqueIndex("one_active_run_per_unit").on(table.unitId).where(sql`${table.status} in ('ready', 'calling')`)]);
