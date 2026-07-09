# Native Workflow Roadmap

This roadmap defines workflow behavior that should live inside FaithFlow AI rather than in `n8n`.

Principles:

- Sunday operation must not depend on external workflow infrastructure.
- Workflow state should be attached to FaithFlow entities and audit logs.
- Human approval is required anywhere AI output or billing/admin actions can create user-facing impact.
- External systems should be optional connectors, not core dependencies.

## 1. After-Service Sermon Archive Workflow

**Trigger**

- `service.completed`

**Steps**

1. Mark service as closed.
2. Finalize transcript segments for that service.
3. Generate sermon metadata summary.
4. Build archive package with transcript, scripture references, selected slides, and downloadable assets.
5. Store archive artifact and publish searchable archive record.
6. Notify admins that archive is ready.

**Required app events**

- `service.completed`
- `transcript.finalized`
- `sermon_archive.requested`
- `sermon_archive.generated`
- `sermon_archive.failed`

**Required database entities**

- `service_plans`
- `transcript_segments`
- `detected_references`
- `ai_suggestions`
- future `sermon_archives`
- future `workflow_runs`

**Failure handling**

- retry packaging on transient storage failure
- mark archive generation failed with retry button
- allow partial archive with transcript-only fallback

**User-facing UI state**

- service detail shows `Generating archive`, `Ready`, or `Failed`
- archive page exposes download and regenerate actions

**Security risks**

- transcript leakage
- incorrect church-to-archive access control
- stale signed URLs

**Test cases**

- service with transcript and slides succeeds
- service without transcript still archives usable assets
- storage failure produces failed state and no broken download links
- repeated trigger remains idempotent

**Phase**

- MVP

## 2. Church Onboarding Workflow

**Trigger**

- `church.created` or first authenticated setup entry

**Steps**

1. create church record
2. attach initial admin user
3. verify email state
4. collect church profile
5. create default settings and preferences
6. seed starter content and checklist
7. optionally branch into migration/import flow
8. mark onboarding complete

**Required app events**

- `church.created`
- `user.email_verified`
- `onboarding.started`
- `onboarding.step.completed`
- `onboarding.completed`

**Required database entities**

- `churches`
- `users`
- `settings`
- `church_preferences`
- `subscriptions`
- future `onboarding_events`

**Failure handling**

- resume from last completed step
- allow verification retry
- surface actionable error when seeding or church creation fails

**User-facing UI state**

- step-based onboarding progress
- incomplete checklist
- explicit complete state with dashboard handoff

**Security risks**

- orphan users without church ownership rules
- invite hijack during initial setup
- over-broad default permissions

**Test cases**

- fresh user completes onboarding end to end
- partially completed onboarding resumes correctly
- duplicate church creation is blocked
- email unverified path still preserves progress

**Phase**

- MVP refinement

## 3. Migration / Import Workflow

**Trigger**

- `import.started`

**Steps**

1. create migration job
2. upload source file
3. detect source format
4. parse records
5. validate and deduplicate
6. import songs/media/slides in chunks
7. record summary and errors
8. notify user when ready or failed

**Required app events**

- `import.started`
- `import.file_uploaded`
- `import.parsed`
- `import.chunk_processed`
- `import.completed`
- `import.failed`

**Required database entities**

- `migration_jobs`
- `songs`
- `song_slides`
- `media_assets`
- `pptx_imports`
- future `import_errors`

**Failure handling**

- chunk retries
- recoverable row-level error collection
- resumable processing for large imports
- explicit cancellation support

**User-facing UI state**

- queued
- processing
- ready
- failed with error summary

**Security risks**

- malformed file uploads
- oversized imports causing resource exhaustion
- imported data crossing church boundaries

**Test cases**

- valid CSV import succeeds
- partial invalid rows still complete with warnings
- duplicate song imports do not create uncontrolled duplication
- canceled import stops safely

**Phase**

- MVP

## 4. Audio Failure Alert Workflow

**Trigger**

- `audio.pipeline.disconnected`
- `audio.input.silent`
- `transcript.stream.stalled`

**Steps**

1. detect fault from diagnostics stream
2. debounce transient blips
3. classify severity
4. raise in-app alert immediately
5. send optional email/webhook/Slack alert for admins
6. record resolution when stream recovers

**Required app events**

- `audio.pipeline.disconnected`
- `audio.pipeline.recovered`
- `audio.input.silent`
- `diagnostic.alert.opened`
- `diagnostic.alert.resolved`

**Required database entities**

- `service_plans`
- `church_preferences`
- future `diagnostic_alerts`
- future `workflow_runs`

**Failure handling**

- suppress duplicate alerts during the same incident
- escalate only after debounce threshold
- fallback to in-app-only alert if outbound notifications fail

**User-facing UI state**

- active alert banner
- alert history row
- resolved incident timestamp

**Security risks**

- leaking internal diagnostics externally
- notification storms
- spoofed webhook listeners

**Test cases**

- short disconnect does not fan out alert
- long disconnect creates alert and external notification
- recovery closes incident cleanly
- duplicate fault events remain idempotent

**Phase**

- MVP after audio stack stabilizes

## 5. AI Suggestion Approval Workflow

**Trigger**

- `ai.suggestion.created`

**Steps**

1. persist suggestion with confidence and source context
2. evaluate against church thresholds
3. if low confidence, hold for manual review
4. if medium confidence, show operator/admin review UI
5. if high confidence and auto-approve is enabled, still run final policy gate
6. approved suggestion becomes actionable
7. rejected suggestion is retained for audit

**Required app events**

- `ai.suggestion.created`
- `ai.suggestion.flagged`
- `ai.suggestion.approved`
- `ai.suggestion.rejected`
- `ai.suggestion.executed`

**Required database entities**

- `ai_suggestions`
- `church_preferences`
- `detected_references`
- `service_plans`
- future `ai_approval_logs`

**Failure handling**

- never auto-execute on missing policy evaluation
- expired review items move to stale state
- allow admin override with audit note

**User-facing UI state**

- pending review
- approved
- rejected
- stale

**Security risks**

- unsafe AI output being surfaced as authoritative
- approval spoofing
- inadequate audit trail for auto-approval

**Test cases**

- low-confidence suggestion stays pending
- manual approval changes state and logs actor
- rejection prevents downstream action
- auto-approve never bypasses final policy checks

**Phase**

- MVP

## 6. Team Invite Workflow

**Trigger**

- `user.invited`

**Steps**

1. admin submits invite
2. create invitation token and expiry
3. send invite email
4. track delivery and reminder eligibility
5. accept invite through signed link
6. attach user to church and role
7. close invitation

**Required app events**

- `user.invited`
- `invite.sent`
- `invite.reminder_sent`
- `invite.accepted`
- `invite.expired`

**Required database entities**

- `invitations`
- `users`
- `churches`
- future `invite_delivery_logs`

**Failure handling**

- resend support
- expiry regeneration
- duplicate invite prevention for existing members

**User-facing UI state**

- pending invite
- sent
- accepted
- expired

**Security risks**

- stolen invite links
- privilege escalation through role tampering
- accepting invite for wrong email identity

**Test cases**

- invite creates token and sends email
- expired token cannot be accepted
- accepted invite cannot be reused
- existing member email is rejected cleanly

**Phase**

- MVP refinement

## 7. Sermon Export Workflow

**Trigger**

- `sermon_export.requested`

**Steps**

1. gather service transcript, references, slides, and metadata
2. generate export format
3. optionally render PDF or DOC packet
4. store artifact
5. notify requester

**Required app events**

- `sermon_export.requested`
- `sermon_export.started`
- `sermon_export.generated`
- `sermon_export.failed`

**Required database entities**

- `service_plans`
- `transcript_segments`
- `detected_references`
- future `sermon_exports`

**Failure handling**

- retry renderer failures
- fall back to ZIP/JSON export if rich document generation fails

**User-facing UI state**

- preparing export
- ready to download
- failed with retry action

**Security risks**

- unauthorized access to sermon materials
- PII leakage in downloadable files
- unbounded export size

**Test cases**

- transcript-only export succeeds
- PDF generation failure falls back cleanly
- permissions are enforced per church

**Phase**

- MVP for basic export, future for polished PDF/DOC

## 8. Backup / Retention Workflow

**Trigger**

- schedule via cron

**Steps**

1. select records eligible for retention cleanup
2. archive or purge according to church settings
3. verify backup artifacts or storage snapshots exist
4. write retention audit record
5. notify admins on failure only

**Required app events**

- `retention.run.started`
- `transcript.retention.applied`
- `backup.verification.completed`
- `backup.verification.failed`

**Required database entities**

- `church_preferences`
- `transcript_segments`
- `migration_jobs`
- future `retention_runs`
- future `backup_audits`

**Failure handling**

- dry-run validation mode
- partial-failure reporting
- hard stop if backup verification is missing

**User-facing UI state**

- retention settings page
- last successful run
- warning banner on failed verification

**Security risks**

- deleting data before backup confirmation
- retaining data longer than policy allows
- cross-church purge bugs

**Test cases**

- retention days are honored
- zero-day forever retention never deletes
- failed backup verification blocks destructive cleanup

**Phase**

- MVP for transcript pruning, future for fuller backup verification

## 9. Stripe Billing Workflow

**Trigger**

- `billing.webhook.received`

**Steps**

1. verify Stripe signature
2. normalize event
3. map to church subscription
4. update subscription status and billing fields
5. notify admins on payment failure or cancellation
6. write audit trail

**Required app events**

- `billing.webhook.received`
- `billing.subscription.updated`
- `billing.payment_failed`
- `billing.payment_recovered`
- `billing.subscription.canceled`

**Required database entities**

- `subscriptions`
- `churches`
- future `billing_events`

**Failure handling**

- idempotency by Stripe event id
- retry on temporary DB failure
- dead-letter unknown subscription mappings

**User-facing UI state**

- current subscription status
- payment failed warning
- grace-period messaging

**Security risks**

- forged webhooks
- duplicate event processing
- incorrect church mapping

**Test cases**

- verified event updates subscription
- duplicate webhook is ignored safely
- payment failure triggers notification and status change
- unknown customer id is logged but not applied

**Phase**

- MVP

## 10. Future Google Drive Sync Workflow

**Trigger**

- manual sync request, scheduled sync, or watched folder event

**Steps**

1. connect church-owned Drive account
2. select import/export folder rules
3. detect new or changed files
4. classify file type
5. import into library or export generated artifacts
6. write sync result and conflict state

**Required app events**

- `drive.sync.started`
- `drive.file.detected`
- `drive.import.completed`
- `drive.export.completed`
- `drive.sync.failed`

**Required database entities**

- `churches`
- `migration_jobs`
- `media_assets`
- `pptx_imports`
- future `external_sync_connections`
- future `external_sync_runs`

**Failure handling**

- token refresh retry
- per-file failure isolation
- conflict resolution state instead of overwrite by default

**User-facing UI state**

- connected
- last synced
- sync in progress
- conflict needs review

**Security risks**

- over-broad Drive scopes
- importing unsafe files
- exporting sensitive content to wrong folders

**Test cases**

- valid connected folder imports supported file types
- token expiration is surfaced and recoverable
- duplicate files do not create duplicate library rows without policy

**Phase**

- Future

## Recommended Build Order

Build natively first:

1. migration / import workflow
2. team invite workflow
3. AI suggestion approval workflow
4. Stripe billing workflow
5. after-service sermon archive workflow
6. backup / retention workflow

Defer until later:

- Google Drive sync
- rich document generation beyond basic exports
- multi-destination external alert fan-out
- customer-customizable automation builder
