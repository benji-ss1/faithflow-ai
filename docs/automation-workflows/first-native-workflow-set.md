# First Native Workflow Set

This document defines the first workflow set that should be implemented natively inside FaithFlow AI using SimplifyOSV2 patterns:

- server-first
- RSC for reads, Server Actions / route handlers for mutations
- authenticated cron and verified webhooks
- explicit audit logging
- security by default

The goal here is not to copy `n8n` JSON. The goal is to rebuild the useful workflow shapes inside FaithFlow’s own domain model.

## Shared Implementation Standard

### Phase 0 prerequisite

Before the first native workflow set is turned on, FaithFlow needs a minimal workflow substrate:

- persisted service lifecycle state
- append-only domain events
- workflow run tracking
- audit logging
- idempotency ledger

Without that base, archive, AI approval, and audio alert workflows will be difficult to secure, replay, or debug.

### Runtime shape

- user-triggered workflows start from Server Actions
- scheduled workflows start from `/api/cron/...` routes protected by `CRON_SECRET`
- external-provider workflows start from verified `/api/webhooks/...` routes
- every workflow run writes:
  - workflow run row
  - event log row
  - operator/admin-visible status

### Shared tables to add later

The existing schema covers much of the business domain already, but native workflow execution needs explicit operational tables:

- `domain_events`
  - `id`, `church_id`, `event_name`, `entity_type`, `entity_id`, `payload_json`, `source`, `correlation_id`, `payload_hash`, `created_at`
- `workflow_runs`
  - `id`, `church_id`, `workflow_key`, `trigger_event`, `status`, `started_at`, `completed_at`, `error_message`, `metadata_json`
- `workflow_attempts`
  - `id`, `workflow_run_id`, `step_key`, `attempt_number`, `status`, `error_code`, `error_message`, `started_at`, `completed_at`
- `workflow_events`
  - append-only event/audit stream for non-security workflow transitions
- `audit_logs`
  - security-sensitive actions only: approvals, access grants, billing state changes, retention deletes
- `idempotency_keys`
  - `id`, `church_id`, `scope`, `idempotency_key`, `entity_type`, `entity_id`, `created_at`

### Mandatory controls before shipping

These controls are required for the first native workflow set to be production-safe:

- add durable workflow and audit tables before enabling approvals, retries, or background execution
- denormalize or otherwise enforce `church_id` ownership on transcript-, AI-, archive-, and alert-derived records used by async workflows
- use idempotency keys for:
  - `service.completed`
  - import chunk execution
  - billing webhook events
  - archive generation
  - alert incident opening
- record actor and policy metadata for every approval or override action
- protect cron routes with `CRON_SECRET`
- verify all third-party webhooks cryptographically
- issue short-TTL signed artifact/download URLs and log issuance
- store delivery attempts for external notifications
- extend retention beyond raw transcripts to include:
  - sermon archives
  - sermon summaries
  - AI suggestions
  - import source files
  - alert payloads

### Current schema gaps to account for

The current FaithFlow schema is a good domain base, but it is not yet sufficient to run these workflows safely:

- there is no durable workflow run or audit table yet
- there is no persisted service lifecycle model for `service.completed`
- `ai_suggestions` does not yet capture reviewer identity, approval mode, policy result, or override reason
- transcript- and suggestion-derived records rely heavily on `servicePlanId`, so church scoping in async jobs must be explicit
- imports and archive artifacts need stronger artifact metadata
  - checksums
  - size ceilings
  - scan status
  - signed URL issuance history
- audio alerts need first-class incident and delivery models, not just transient events

Additional workflow-specific tables are called out below.

## 1. After-Service Sermon Archive Workflow

**Decision**

- rebuild natively

**Trigger**

- `service.completed`

**Primary steps**

1. verify service belongs to current church
2. lock service into post-service state
3. finalize transcript and detected references snapshot
4. build archive manifest
5. generate archive package
6. persist archive row and artifact locations
7. emit `sermon_archive.generated`
8. notify admins or pastors that archive is ready

**Database tables / events needed**

Existing:

- `service_plans`
- `transcript_segments`
- `detected_references`
- `ai_suggestions`

Add:

- `sermon_archives`
  - `service_plan_id`, `church_id`, `status`, `manifest_json`, `transcript_s3_key`, `package_s3_key`, `generated_by`, `generated_at`
- service lifecycle support on `service_plans` or a new `service_sessions`
  - `status`, `completed_at`, `completed_by_user_id`, `finalized_at`

Events:

- `service.completed`
- `transcript.finalized`
- `sermon_archive.requested`
- `sermon_archive.generated`
- `sermon_archive.failed`

**Failure handling**

- idempotency by `service_plan_id`
- retry packaging on transient S3/storage errors
- transcript-only fallback if rich package generation fails
- failed state must preserve actionable retry metadata
- signed URLs generated at read time only, never stored in domain events

**Operator / admin UI states**

- `Not generated`
- `Generating archive`
- `Archive ready`
- `Archive partially ready`
- `Archive failed`

**Logs**

- workflow run started/completed/failed
- artifact generation path
- notification delivery result
- actor if manually retriggered

**Security risks**

- transcript exposure through weak URL access
- cross-church archive access
- including sensitive diagnostic or internal notes in export

**Test cases**

- service with transcript and references generates archive
- repeated completion event does not duplicate archive
- partial failure still yields transcript-only archive
- unauthorized user cannot download another church archive

## 2. Import / Migration Workflow Skeleton

**Decision**

- rebuild natively

**Trigger**

- `import.started`

**Primary steps**

1. create migration job
2. create upload target for source file
3. validate file metadata and file type
4. parse source into normalized records
5. detect duplicates and invalid rows
6. import in chunks
7. write summary and row-level errors
8. emit `import.completed` or `import.failed`

**Database tables / events needed**

Existing:

- `migration_jobs`
- `songs`
- `song_slides`
- `media_assets`
- `pptx_imports`

Add:

- `import_errors`
  - `migration_job_id`, `row_number`, `error_code`, `message`, `raw_payload_json`

Events:

- `import.started`
- `import.file_uploaded`
- `import.parsed`
- `import.chunk_processed`
- `import.completed`
- `import.failed`

**Failure handling**

- resumable chunk processing
- row-level nonfatal errors
- hard stop on unsupported or dangerous file types
- cancel support with safe checkpointing

**Operator / admin UI states**

- `Queued`
- `Uploading`
- `Processing`
- `Completed with warnings`
- `Completed`
- `Failed`
- `Canceled`

**Logs**

- file metadata
- parser and importer stage timings
- imported counts vs skipped counts
- per-chunk checkpoint

**Security risks**

- malicious uploads
- oversized imports exhausting storage or memory
- importing data into the wrong church
- formula or payload injection if CSV-derived content is exported later

**Test cases**

- valid CSV import creates expected songs/slides
- invalid rows are logged without crashing entire import
- duplicate import remains idempotent under chosen dedupe policy
- unauthorized user cannot operate on another church’s import job

## 3. Audio Failure Alert Workflow

**Decision**

- rebuild natively

**Trigger**

- `audio.pipeline.disconnected`
- `audio.input.silent`
- `transcript.stream.stalled`

**Primary steps**

1. receive diagnostic event
2. debounce short-lived noise
3. classify severity and incident key
4. open or update incident record
5. show in-app alert immediately
6. optionally fan out email/webhook alert
7. resolve incident on recovery event

**Database tables / events needed**

Existing:

- `service_plans`
- `church_preferences`

Add:

- `diagnostic_alerts`
  - `church_id`, `service_plan_id`, `incident_key`, `severity`, `status`, `opened_at`, `resolved_at`, `last_seen_at`, `details_json`

Events:

- `audio.pipeline.disconnected`
- `audio.pipeline.recovered`
- `audio.input.silent`
- `transcript.stream.stalled`
- `diagnostic.alert.opened`
- `diagnostic.alert.resolved`

**Failure handling**

- suppress duplicate incidents while active
- fail open to in-app alert if outbound email/webhook fails
- record alert even if notification transport is down

**Operator / admin UI states**

- `Healthy`
- `Warning`
- `Critical`
- `Resolved`

**Logs**

- incident open/update/resolve
- debounce reason
- outbound notification result
- actor note if incident is acknowledged manually

**Security risks**

- leaking internal host/device details in notifications
- notification floods from unstable audio edges
- attacker-generated spoofed diagnostic events if the event source is not trusted

**Test cases**

- transient disconnect below threshold does not alert
- sustained disconnect opens one incident only
- recovery resolves the same incident
- notification retry failure does not lose the incident record

## 4. AI Suggestion Approval Workflow

**Decision**

- rebuild natively

**Trigger**

- `ai.suggestion.created`

**Primary steps**

1. store suggestion with confidence and context
2. evaluate church thresholds and policy rules
3. place suggestion in review queue
4. permit approve / reject / expire actions
5. if auto-approve is enabled, still run explicit safety gate
6. write audit outcome
7. emit downstream execution event only after approval

**Database tables / events needed**

Existing:

- `ai_suggestions`
- `detected_references`
- `church_preferences`
- `service_plans`

Add:

- `ai_approval_logs`
  - `suggestion_id`, `church_id`, `action`, `actor_user_id`, `reason`, `created_at`, `metadata_json`

Events:

- `ai.suggestion.created`
- `ai.suggestion.flagged`
- `ai.suggestion.approved`
- `ai.suggestion.rejected`
- `ai.suggestion.expired`

**Failure handling**

- no execution if policy evaluation fails
- stale items expire visibly instead of silently disappearing
- admin override requires explicit audit note

**Operator / admin UI states**

- `Pending review`
- `Approved`
- `Rejected`
- `Expired`
- `Blocked by policy`

**Logs**

- creation context
- confidence threshold result
- reviewer identity and action
- auto-approve policy path

**Security risks**

- unsafe AI output shown as authoritative content
- privilege bypass on approval endpoints
- missing audit trail for auto-approval decisions

**Test cases**

- low-confidence suggestion remains pending
- approval changes status and creates approval log
- rejection prevents downstream execution event
- auto-approve still records safety-gate decision

## 5. Church Onboarding Workflow Skeleton

**Decision**

- rebuild natively

**Trigger**

- authenticated first-run setup
- `church.created`

**Primary steps**

1. create church and attach first admin user
2. verify email state
3. collect church profile
4. seed defaults for settings, preferences, subscription scaffold
5. create onboarding checklist state
6. optionally branch to migration flow
7. mark onboarding complete

**Database tables / events needed**

Existing:

- `churches`
- `users`
- `settings`
- `church_preferences`
- `subscriptions`
- `migration_jobs`

Add:

- `onboarding_events`
  - `church_id`, `user_id`, `step_key`, `status`, `metadata_json`, `created_at`

Events:

- `church.created`
- `user.email_verified`
- `onboarding.started`
- `onboarding.step.completed`
- `onboarding.completed`

**Failure handling**

- checkpoint after every step
- safe resume from last incomplete step
- nonfatal failure for optional migration branch

**Operator / admin UI states**

- `Verify email`
- `Add church details`
- `Seed defaults`
- `Import library`
- `Ready to go`
- `Completed`

**Logs**

- step start/complete/fail
- default-seed result
- migration branch selected or skipped

**Security risks**

- orphaned user or church rows
- duplicate onboarding by refresh/race condition
- role escalation during initial attach

**Test cases**

- fresh signup completes onboarding cleanly
- interrupted onboarding resumes correctly
- duplicate church creation is rejected or coalesced
- skipped migration still completes onboarding safely

## What Stays Out Of The First Native Set

These remain future work or future optional `n8n` integration:

- Google Drive / Dropbox sync
- complex multi-destination notification trees
- denomination-level orchestration
- custom customer automation builder

## SimplifyOSV2 Alignment

This first native set follows the local SimplifyOSV2 standard by:

- keeping data mutations server-side
- using the schema as the source of truth
- requiring audit logging for sensitive actions
- protecting cron and webhook boundaries
- biasing toward human review for AI actions
- treating reliability and security as product requirements, not optional polish
