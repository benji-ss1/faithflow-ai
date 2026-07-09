# n8n Workflow Research Summary

## Scope

This review treats [`Zie619/n8n-workflows`](https://github.com/Zie619/n8n-workflows) as a pattern library, not as infrastructure to adopt directly inside FaithFlow AI.

The repository is a large public collection of reusable `n8n` workflow JSONs. Its README describes it as a searchable collection of more than 4,300 workflows across hundreds of integrations, with categories covering triggers, scheduled jobs, webhooks, file processing, cloud storage, notifications, AI, and business process automation.

## What The Repository Contains

- A broad library of `n8n` workflow exports grouped by integration or trigger type.
- Pattern-heavy examples for:
  - scheduled jobs
  - webhook-triggered flows
  - Slack and email notifications
  - Google Drive and Dropbox automation
  - Google Docs and file conversion/extraction flows
  - AI-triggered and form-triggered automations
- Supporting docs, a search interface, and a browser-based catalog for discovering workflows.

Relevant repo references reviewed:

- Main repository overview and statistics:
  - <https://github.com/Zie619/n8n-workflows>
- Scheduled and webhook pattern folders:
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Cron>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Webhook>
- Notification and storage pattern folders:
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Emailsend>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Slack>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Dropbox>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Googledrive>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Googledocs>
- Document and AI-oriented pattern folders:
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Converttofile>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Extractfromfile>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Openai>

## Categories Reviewed

Only these categories were considered for FaithFlow:

1. scheduled / cron jobs
2. email notifications
3. webhook alerts
4. file / folder ingestion
5. Google Drive / Dropbox sync
6. PDF / document generation
7. Stripe billing webhooks
8. team invite flows
9. backup / retention jobs
10. human approval workflows
11. AI agent workflows with safety gates

## Representative Patterns Found

The repo is useful less because of domain fit and more because it repeatedly shows the same automation primitives in different combinations:

- Trigger styles:
  - scheduled
  - manual
  - webhook
  - app-specific event trigger
- Common workflow structure:
  - receive event
  - normalize payload
  - enrich with lookup
  - branch by condition
  - call downstream service
  - notify human
  - write audit result
  - retry or dead-letter on failure
- Storage/document patterns:
  - monitor a drive or folder
  - import files into a sheet or doc flow
  - extract content from uploaded files
  - convert file formats before dispatch
- Alerting patterns:
  - cron or webhook triggers
  - Slack/email fan-out
  - explicit success/failure branches
- AI patterns:
  - form or sheet input
  - LLM generation
  - downstream publish/send action

Examples visible from the repo structure and filenames:

- `0822_Cron_Postgres_Automation_Scheduled.json`
- `0066_Webhook_Cron_Automate_Scheduled.json`
- `0113_Emailsend_GoogleDrive_Send_Triggered.json`
- `1628_Emailsend_Code_Automation_Webhook.json`
- `0969_Dropbox_Manual_Automate_Webhook.json`
- `0839_GoogleDrive_GoogleSheets_Create_Triggered.json`
- `1806_GoogleDrive_GoogleSheets_Import_Triggered.json`
- `1287_Googledocs_Googledrivetool_Monitor_Triggered.json`
- `0508_Converttofile_Manual_Process_Triggered.json`
- `1444_Extractfromfile_Converttofile_Automation_Webhook.json`
- `0008_Slack_Stripe_Create_Triggered.json`
- `0248_Openai_Telegram_Automate_Triggered.json`

## What Is Relevant To FaithFlow

### Strongly relevant

- Scheduled maintenance and retention jobs
  - transcript pruning
  - backup verification
  - archive generation
  - stalled job detection
- Notification fan-out
  - email alerts to admins
  - webhook alerts to church ops endpoints
  - future Slack alerts for large teams
- File ingestion
  - migration imports
  - drive-based import queues
  - post-service sermon archive packaging
- Document generation
  - sermon export packets
  - onboarding summary documents
  - migration reports
- Approval flows
  - AI suggestion review before stage/live use
  - high-risk admin actions needing explicit approval
- Billing event handling
  - Stripe webhook normalization
  - payment failure notifications
  - subscription state changes
- Safety-gated AI orchestration
  - create suggestion
  - score confidence
  - require approval
  - log audit trail

### Moderately relevant

- Google Drive / Dropbox sync as optional export and import targets
- Manual-triggered administrative workflows for support, onboarding, and migrations
- Team invite flows that chain email, token issuance, reminders, and acceptance tracking

## What Is Irrelevant To FaithFlow

The repo also contains a large amount of automation that does not map to FaithFlow’s product surface or operating risk model:

- sales CRM workflows
- lead routing
- e-commerce order flows
- marketing campaign automations
- generic social media posting
- scraping pipelines
- unrelated business ops workflows
- publish-direct AI workflows without human review

These patterns may be well-built for `n8n`, but they do not help with Sunday operations, sermon archival, church onboarding, or safe AI assistance.

## Why This Repo Is Useful As A Pattern Library

FaithFlow can reuse the workflow shapes without importing the runtime:

- event-driven processing
- retries and idempotency
- split between trigger, worker, notifier, and audit stages
- explicit success and failure branches
- manual approval checkpoints
- connector-style sync boundaries for external systems

This is valuable because FaithFlow already has native concepts that map cleanly to workflow state:

- `churches`
- `users`
- `invitations`
- `subscriptions`
- `migration_jobs`
- `service_plans`
- `transcript_segments`
- `ai_suggestions`
- `church_preferences`

## Why We Should Not Add n8n As Core Infrastructure Yet

FaithFlow should not depend on `n8n` for core product behavior yet.

Reasons:

- Sunday live operation must stay simple.
  - Live service reliability should not depend on a separate workflow engine, editor, queue surface, and credential-management layer.
- The core workflows we need are product-native.
  - sermon archive
  - imports
  - invites
  - billing state sync
  - retention jobs
  - AI approvals
- `n8n` adds operational overhead.
  - another runtime
  - another auth surface
  - another secrets store
  - versioning and migration burden for workflow JSONs
- Workflow ownership would fragment.
  - product logic would be split between Next.js server actions / API routes and external no-code automation state
- Safety and auditability are stronger when native.
  - approval, transcript, and billing workflows should be tied directly to FaithFlow entities and audit logs
- Current needs are bounded.
  - FaithFlow does not yet need a general-purpose customer automation platform
  - it needs a small number of deterministic product workflows

## Recommendation

Use `Zie619/n8n-workflows` as a reference library for workflow anatomy, especially around:

- trigger normalization
- retries
- notification fan-out
- storage sync patterns
- approval checkpoints
- AI-to-human handoff

Do not make `n8n` a required runtime for FaithFlow’s product or Sunday operations in the near term.

Instead:

- rebuild the highest-value workflows natively
- keep external integrations behind explicit optional connectors
- revisit optional `n8n` support later for advanced church or denomination-level custom automation
