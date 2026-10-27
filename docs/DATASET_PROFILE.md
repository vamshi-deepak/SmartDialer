# Collections Dataset Profile

## Scope and Method

The extracted source is `collections_30k_dataset/`; no ZIP archive is present in the workspace. Its README says it was generated with seed 42 and intentionally contains duplicates, missing values, conflicting timestamps, UTC/Asia-Kolkata/Asia-Dubai timestamps, inconsistent identifiers, late-arriving events, schema versions, legacy dispositions, duplicate payment events, multiple agent identifiers, and inconsistent campaign definitions. The original CSVs were inspected read-only and have not been changed. Counts below are file row counts; `data_dictionary.csv` supplies the declared column types.

## Inventory

| CSV | Rows | Relevance to dialing |
|---|---:|---|
| `agents.csv` | 30,000 | Core identity snapshots; collapse/validate by `agent_id`, never import employment status as live availability. |
| `borrowers.csv` | 30,600 | Core borrower identity/contact snapshots; repeated `borrower_id`; `state` is geographic region, not lifecycle state. |
| `campaigns.csv` | 120 | Core campaign identity/metadata; duplicate campaign names, unique observed IDs; channel and target definitions require explicit normalization. |
| `calls.csv` | 91,350 | Historical call outcome snapshots; 90,000 unique `call_id` values and 1,350 extra repeated-ID rows. Not a current call-state source. |
| `call_attempts.csv` | 120,000 | Best historical event/retry test source; stable `attempt_id`, status and attempt number; late/out-of-order records must be audit-only. |
| `accounts.csv` | 30,000 | Useful eligibility and amount context; can have missing borrower keys and multiple accounts per borrower. |
| `daily_targeting.csv` | 45,000 | Useful historical queue/priority evidence; campaign/account links need validation and date scoping. |
| `agent_sessions.csv` | 15,000 | Historical login/logout evidence, not proof of an agent's current availability. |
| `vendor_telephony.csv` | 15 | Historical vendor attribution/config metadata; must not configure or call an actual carrier. |
| `call_dispositions.csv` | 35,000 | Useful historical outcome labels; includes legacy/versioned codes and should remain separate from live call FSM transitions. |
| `account_status_history.csv` | 60,000 | Useful late/out-of-order audit fixtures (`event_at` versus `recorded_at`); not call state. |
| `payments.csv` | 25,500 | Not needed for dialing; useful only for future reconciliation/outcome analytics. |
| `promises_to_pay.csv` | 18,000 | Not required for dialing; could support future prioritization after domain/policy review. |
| `complaints.csv` | 8,000 | Potential future suppression/compliance input, but no current suppression model; do not infer consent or contactability. |
| `field_visits.csv` | 25,000 | Not needed for voice dialing; channel/workflow-specific. |
| `sms_events.csv` | 45,000 | Not required for voice dialer; separate channel history. |
| `whatsapp_events.csv` | 60,600 | Not required for voice dialer; separate channel history. |

## Declared Data Types

`data_dictionary.csv` has 143 dataset/column entries. Identifiers, names, phone/email, categories, schema versions, and statuses are declared `object` and must remain strings (IDs include leading zeroes). Event and lifecycle timestamps are declared `datetime64[ns]`; numeric amounts/coordinates are `float64`, and counts, DPD, priority, durations, and attempt numbers are `int64`. The timestamp columns are naive local wall-clock values accompanied by separate timezone fields in several tables. Parsing must use the row's timezone and preserve the original string; never silently treat a naive timestamp as UTC.

Representative core headers:

- agents: `agent_id, employee_code, agent_name, vendor_id, team, status, joined_at, updated_at`
- borrowers: `borrower_id, name, phone, email, city, created_at, updated_at, state`
- campaigns: `campaign_id, campaign_name, channel, strategy_version, start_at, target_definition, end_at`
- calls: `call_id, account_id, borrower_id, event_at, agent_id, campaign_id, direction, vendor_id, call_status, duration_sec, timezone`
- call attempts: `attempt_id, account_id, borrower_id, event_at, call_id, agent_id, attempt_no, vendor_id, attempt_status`

Observed examples include agent statuses `ACTIVE`, `INACTIVE`, `SUSPENDED`; call outcomes `NO_ANSWER`, `ANSWERED`, `FAILED`, `VOICEMAIL`, `BUSY`; and attempt outcomes `FAILED`, `CONNECTED`, `RINGING`, `NO_ANSWER`, `BUSY`. A borrower row's `state` sample is `Odisha`; it is not an application state.

## Mapping Proposal (Not Yet Ingested)

| Source field | SmartDialer field | Rule before any future import |
|---|---|---|
| `agents.agent_id` | `Agent.id` | Treat as source identity, preserve exact string. Collapse duplicate snapshots only after examining identity and timestamp conflicts. |
| `agents.employee_code` | external metadata | Do not use as primary key; check uniqueness and conflicts first. |
| `agents.agent_name` | `Agent.name` | Use only from a validated agent profile. |
| `agents.status` | eligibility input, not `Agent.state` | `ACTIVE` does not mean logged-in/AVAILABLE. Only explicit operator/session reconciliation may grant AVAILABLE; otherwise seed OFFLINE. `INACTIVE`/`SUSPENDED` must never be dial-eligible. |
| `agent_sessions.agent_id/login_at/logout_at/channel` | historical session audit | A session is time-bounded history, not present availability; `logout_at` can be absent or inconsistent. |
| `borrowers.borrower_id/name/phone` | `Borrower.id/name/phoneNumber` | Keep identifiers and phones as strings; normalize phone only in a separate validated field and retain source value. Reject missing/invalid identity or contact data. |
| `borrowers.state` | no direct mapping | This is region/province text, not the SmartDialer borrower/call FSM. |
| `accounts.account_id/borrower_id/outstanding_amount/dpd/status` | future account-target extension | `Borrower` currently has no account identity; multiple accounts per borrower require a distinct account-target model or explicit account ID before queueing. Do not silently aggregate debt or merge obligations. Require valid borrower/account links, positive outstanding balance, and an approved status/DPD policy. |
| `campaigns.campaign_id/campaign_name` | `Campaign.id/name` | Preserve ID; names are not unique. Do not infer ACTIVE from date windows. |
| `campaigns.channel/strategy_version/target_definition` | campaign metadata only | Map only explicit supported VOICE campaigns; `MIXED` and free-form targets need a reviewed configuration mapping. Keep strategy version and raw definition for audit. |
| `calls.call_id/campaign_id/borrower_id/agent_id/event_at/call_status/duration_sec` | historical call audit | Historical outcome rows cannot become live `Call` records. Repeated call IDs and snapshots require deterministic dedupe/conflict handling; do not attach them to a live agent or count them toward live capacity. |
| `call_attempts.attempt_id/call_id/event_at/attempt_no/attempt_status` | isolated event replay fixture | `attempt_id` is a candidate dedupe key. Resolve call references and timezone first. Replay into a test-only event processor/audit sink; malformed or out-of-order events must be rejected/audited and cannot mutate live repositories. `CONNECTED` without a valid preceding state is a useful invalid-transition fixture. |
| `calls.vendor_id` / `call_attempts.vendor_id` | historical vendor attribution | Preserve as source metadata only; never resolve dataset vendor data to an actual provider adapter. |
| `call_dispositions.disposition_code/version` | historical outcome label | Versioned legacy codes need a reviewed lookup; do not use them to rewrite call lifecycle states. |
| `account_status_history.event_at/recorded_at` | late-event validation fixture | Preserve both business-event time and arrival/recorded time. Do not derive live campaign or call status from account history. |

## Import Decision and Safety Boundary

No CSV importer is enabled in the application. This is deliberate: duplicate identity snapshots, ambiguous account-level targets, status semantic mismatches, and timezone uncertainty make blind ingestion more harmful than useful for the assignment. Existing backend startup seeding creates clean synthetic demo records independent of these files. The dashboard's seed endpoint also creates only synthetic agents/borrowers.

If adding a future optional importer, implement it as a dry-run validator first: explicit header allowlist, row-level Zod parsing, schema-version-aware mappings, string IDs, timezone-aware parsing, deterministic source row IDs, duplicate/conflict report, referential checks, and quarantine output. Historical rows must be written to a separate audit collection/sink. They must never write `Agent.state`, active `Call` state, or bypass the Safety Controller. Use `attempt_id` and source event time for replay idempotency; test duplicate IDs, conflicting call snapshots, impossible transitions, late arrival, missing references, and raw timezone differences before enabling any import mode.

The source files remain unchanged under `collections_30k_dataset/`.
