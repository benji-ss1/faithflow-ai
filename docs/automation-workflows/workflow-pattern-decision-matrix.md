# Workflow Pattern Decision Matrix

This matrix applies the default bias for FaithFlow AI:

- rebuild natively unless the workflow depends on many third-party connectors
- keep Sunday-critical flows out of `n8n`
- reserve `n8n` for optional, connector-heavy, customer-specific automation later

References reviewed:

- Main repo: <https://github.com/Zie619/n8n-workflows>
- Category folders:
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Cron>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Webhook>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Emailsend>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Dropbox>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Googledrive>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Googledocs>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Converttofile>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Extractfromfile>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Slack>
  - <https://github.com/Zie619/n8n-workflows/tree/main/workflows/Openai>

## Reviewed Categories

### 1. Scheduled / Cron Jobs

**Pattern found**

- scheduled trigger
- worker job
- success/failure notification
- recurring cleanup or sync

**Decision**

- rebuild natively

**Why**

- transcript pruning, archive generation, backup verification, and stalled-job checks are core product workflows
- SimplifyOSV2 already assumes Vercel Cron and authenticated cron routes

### 2. Email Notifications

**Pattern found**

- event trigger
- template render
- delivery + failure branch

**Decision**

- rebuild natively for transactional product emails
- future `n8n` for church-specific fan-out chains

**Why**

- invites, archive ready notices, onboarding, and billing failures should stay in FaithFlow
- custom multi-channel notification trees can wait

### 3. Webhook Alerts

**Pattern found**

- webhook-triggered workflows
- payload filtering
- alert fan-out
- respond-to-webhook patterns

**Decision**

- rebuild natively for Stripe and internal system alerts
- future `n8n` for optional external admin automations

**Why**

- Stripe verification and internal diagnostic alerting belong in product code
- customer-specific webhook consumers are optional later

### 4. File / Folder Ingestion

**Pattern found**

- upload or watched folder
- extract / convert
- validate
- import

**Decision**

- rebuild natively

**Why**

- migration imports and sermon artifacts map directly to FaithFlow entities and storage rules

### 5. Google Drive / Dropbox Sync

**Pattern found**

- watched folder
- sheet/doc sync
- import/export branching

**Decision**

- future optional `n8n` or optional native connector layer

**Why**

- useful for larger churches
- not required for MVP or Sunday operation
- connector surface and token lifecycle are integration-heavy

### 6. PDF / Document Generation

**Pattern found**

- generate doc
- transform file
- store and send

**Decision**

- rebuild natively for sermon export and archive packets
- future `n8n` for downstream routing to third-party systems

**Why**

- document creation is product behavior
- cross-system routing is optional automation

### 7. Stripe Billing Webhooks

**Pattern found**

- verified external webhook
- normalize event
- notify ops

**Decision**

- rebuild natively

**Why**

- subscriptions already exist in schema
- billing state is too sensitive to outsource to an optional workflow runtime

### 8. User / Team Invite Flows

**Pattern found**

- invite token
- send email
- accept / expire / remind

**Decision**

- rebuild natively

**Why**

- invitations already exist in schema
- access control is a core app concern

### 9. Backup / Retention Jobs

**Pattern found**

- scheduled cleanup
- verify storage
- notify on failure

**Decision**

- rebuild natively

**Why**

- retention settings already exist in `church_preferences`
- destructive cleanup must be controlled by product rules and audit logs

### 10. Human Approval Workflows

**Pattern found**

- pending review queue
- approve / reject branch
- downstream action after approval

**Decision**

- rebuild natively

**Why**

- AI and operational approvals should use FaithFlow roles, audit logs, and UI state directly

### 11. AI Agent Workflows With Safety Gates

**Pattern found**

- AI generation
- confidence check
- manual gate
- downstream execution

**Decision**

- rebuild natively

**Why**

- FaithFlow already has `ai_suggestions`, `detected_references`, thresholds, and auto-approve settings
- this is a product-defining workflow, not a generic automation

## Useful Patterns

Useful to copy conceptually:

- trigger normalization
- retry + dead-letter thinking
- explicit approval states
- notification fan-out
- file extract / convert / import sequencing
- signed webhook boundary
- connector-specific sync isolation

## Rejected Categories

Rejected as irrelevant to FaithFlow’s current product path:

- sales CRM workflows
- e-commerce workflows
- generic marketing automation
- scraping flows
- social media posting
- unrelated business back-office automation

## First Native Workflow Set

These should be built natively first:

1. after-service sermon archive workflow
2. import / migration workflow skeleton
3. audio failure alert workflow
4. AI suggestion approval workflow
5. church onboarding workflow skeleton

## Future Optional n8n Integration

These can remain future integration candidates:

- large church custom notification trees
- denomination-level orchestration
- Google Drive / Dropbox / Slack heavy routing
- customer-built admin workflows
- optional self-hosted automation layer
