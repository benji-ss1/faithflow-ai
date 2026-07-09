# Workflow Event Map

## service.completed

**triggered_by**

- operator or system closes a service

**consumed_by**

- after-service sermon archive workflow
- backup and retention workflow
- service analytics recompute

**payload**

- `servicePlanId`
- `churchId`
- `completedAt`
- `operatorUserId`

**failure_mode**

- duplicate completion events
- missing final service metadata

**audit_log_required**

- yes

## transcript.finalized

**triggered_by**

- transcript stream reaches finalization state for a service

**consumed_by**

- sermon archive workflow
- sermon export workflow
- AI post-service analysis

**payload**

- `servicePlanId`
- `churchId`
- `segmentCount`
- `finalizedAt`

**failure_mode**

- partial transcript finalized
- late-arriving segments after finalization

**audit_log_required**

- yes

## sermon_archive.generated

**triggered_by**

- archive worker finishes package generation

**consumed_by**

- archive UI
- notification workflow
- optional future Drive export

**payload**

- `archiveId`
- `servicePlanId`
- `churchId`
- `artifactKey`
- `generatedAt`

**failure_mode**

- archive artifact missing or expired
- stale metadata after regenerate

**audit_log_required**

- yes

## audio.pipeline.disconnected

**triggered_by**

- audio diagnostics detect disconnected or unreachable input pipeline

**consumed_by**

- audio failure alert workflow
- operator diagnostics UI

**payload**

- `churchId`
- `servicePlanId`
- `detectedAt`
- `deviceLabel`
- `severity`

**failure_mode**

- false positives from brief reconnects
- duplicate incidents

**audit_log_required**

- yes

## ai.suggestion.created

**triggered_by**

- AI detection or recommendation engine creates a new suggestion

**consumed_by**

- AI suggestion approval workflow
- review queue UI

**payload**

- `suggestionId`
- `servicePlanId`
- `churchId`
- `type`
- `confidence`
- `payload`

**failure_mode**

- malformed payload
- suggestion created without review context

**audit_log_required**

- yes

## ai.suggestion.approved

**triggered_by**

- operator, admin, or safety gate approves a suggestion

**consumed_by**

- downstream execution workflow
- audit history UI

**payload**

- `suggestionId`
- `servicePlanId`
- `churchId`
- `approvedByUserId`
- `approvedAt`

**failure_mode**

- approval race between multiple reviewers
- approval of stale suggestion

**audit_log_required**

- yes

## import.started

**triggered_by**

- user begins a migration or library import

**consumed_by**

- migration / import workflow
- import progress UI

**payload**

- `migrationJobId`
- `churchId`
- `userId`
- `source`
- `sourceFileName`

**failure_mode**

- source file missing after job creation
- unsupported format

**audit_log_required**

- yes

## import.completed

**triggered_by**

- migration worker finishes successfully

**consumed_by**

- onboarding UI
- admin notifications
- import summary page

**payload**

- `migrationJobId`
- `churchId`
- `completedAt`
- `summary`

**failure_mode**

- summary mismatch with actual writes
- late duplicate completion event

**audit_log_required**

- yes

## import.failed

**triggered_by**

- migration worker reaches terminal error state

**consumed_by**

- onboarding UI
- support alerts
- retry controls

**payload**

- `migrationJobId`
- `churchId`
- `failedAt`
- `errorCode`
- `errorMessage`

**failure_mode**

- failure event without root error details
- repeated retries after terminal corruption

**audit_log_required**

- yes

## church.created

**triggered_by**

- onboarding creates a new church

**consumed_by**

- onboarding workflow
- default settings bootstrap
- optional starter content seeding

**payload**

- `churchId`
- `createdByUserId`
- `name`
- `timezone`

**failure_mode**

- church created without dependent defaults
- duplicate org creation

**audit_log_required**

- yes

## user.invited

**triggered_by**

- admin creates a team invitation

**consumed_by**

- invite email workflow
- invite reminder workflow
- invite management UI

**payload**

- `invitationId`
- `churchId`
- `email`
- `role`
- `invitedByUserId`
- `expiresAt`

**failure_mode**

- invite email not sent
- duplicate pending invite for same email

**audit_log_required**

- yes

## billing.payment_failed

**triggered_by**

- Stripe webhook normalization marks a failed payment event

**consumed_by**

- billing workflow
- admin notification workflow
- subscription status UI

**payload**

- `churchId`
- `subscriptionId`
- `stripeCustomerId`
- `invoiceId`
- `failedAt`

**failure_mode**

- failed payment mapped to wrong subscription
- duplicate webhook processing

**audit_log_required**

- yes

## billing.webhook.received

**triggered_by**

- authenticated webhook request from Stripe

**consumed_by**

- Stripe billing workflow

**payload**

- `provider`
- `eventId`
- `eventType`
- `receivedAt`
- `rawBodyHash`

**failure_mode**

- invalid signature
- unsupported event type

**audit_log_required**

- yes

## invite.accepted

**triggered_by**

- invited user successfully completes invite acceptance

**consumed_by**

- team invite workflow
- onboarding shortcut flow

**payload**

- `invitationId`
- `churchId`
- `userId`
- `acceptedAt`

**failure_mode**

- already-accepted invite
- mismatched email identity

**audit_log_required**

- yes

## retention.run.started

**triggered_by**

- scheduled retention worker start

**consumed_by**

- backup / retention workflow

**payload**

- `runId`
- `startedAt`
- `scope`

**failure_mode**

- overlapping retention runs
- invalid church retention configuration

**audit_log_required**

- yes

## drive.sync.started

**triggered_by**

- manual sync request or scheduled connector run

**consumed_by**

- future Google Drive / Dropbox sync workflow

**payload**

- `syncRunId`
- `churchId`
- `connectionId`
- `direction`
- `startedAt`

**failure_mode**

- missing credentials
- connector disabled mid-run

**audit_log_required**

- yes
