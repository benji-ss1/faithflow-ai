# Future n8n Integration

## Position

FaithFlow should not require `n8n` for core product operation. The platform should keep its essential workflows native and deterministic, especially anything related to live services, archive generation, invites, billing state, and AI approval.

That said, `n8n` can become useful later as an optional automation layer for customers with broader operational needs.

## When FaithFlow Might Eventually Use n8n

### 1. Large church custom automations

Some churches will eventually want custom routing that goes beyond FaithFlow’s product defaults:

- create a sermon archive then email the communications team
- push approved sermon notes into a shared drive
- notify campus leads when a service export is ready
- route import failures into their internal ticketing system

These are valid `n8n` use cases because they are church-specific and often connector-heavy.

### 2. Denomination-level automation

Multi-campus or denomination-level customers may need cross-church workflows such as:

- weekly compliance reporting
- archive synchronization across many churches
- central billing or support escalation
- templated onboarding across regions

This is where an external workflow engine starts making sense, because the logic becomes organization-specific rather than product-core.

### 3. Advanced Google Drive / Dropbox / Slack workflows

If a customer wants:

- two-way Drive sync
- folder watchers
- Slack fan-out with custom rules
- Dropbox export pipelines
- admin-configurable document routing

then `n8n` is a reasonable optional connector layer. These workflows are integration-heavy and often vary customer by customer.

### 4. Custom admin workflows

Later enterprise customers may want:

- approval chains for content publishing
- custom audit notifications
- workflow-based account provisioning
- church-specific escalation policies

That should be optional and additive, not baked into the base product path.

### 5. Optional self-hosted automation layer

Some advanced customers will prefer self-hosting their automations for governance or IT control. `n8n` could fit here as:

- a customer-managed sidecar
- an enterprise-only connector target
- an automation endpoint FaithFlow can publish events to

This keeps FaithFlow focused on product workflows while allowing power users to extend the platform.

## Why n8n Should Not Be Required For Sunday Live Operation

Sunday live operation has a stricter reliability bar than back-office automation.

Reasons `n8n` should stay out of the critical live path:

- live operation must not depend on a separate workflow runtime
- external connector failures must not affect operator or live output behavior
- no-code workflow edits are harder to lock down than product code paths
- secrets, credentials, and retries add another operational surface right where FaithFlow needs simplicity
- support becomes much harder if a church’s live reliability depends on custom workflow state outside the app

FaithFlow’s Sunday path should remain:

- app-native
- minimal-dependency
- deterministic
- testable end to end in one stack

## Recommended Boundary

### Keep native inside FaithFlow

- service completion processing
- sermon archive generation
- migration/import jobs
- invite lifecycle
- Stripe subscription state updates
- transcript retention
- AI suggestion review and approval
- audio diagnostics alerts

### Allow optional n8n later for extension

- Drive / Dropbox / Slack automations
- denomination-wide admin workflows
- enterprise routing and approvals outside the core app
- custom church-specific automation recipes

## Suggested Integration Model If Added Later

If FaithFlow supports `n8n` later, it should be event-outbound first.

Preferred model:

1. FaithFlow emits signed webhook events for approved domains.
2. `n8n` consumes those webhooks and runs optional customer logic.
3. FaithFlow only accepts narrow, authenticated callback actions back in.
4. Core state transitions remain validated by FaithFlow, not by `n8n`.

That keeps the source of truth inside the product while still enabling powerful extension.

## Decision

Near-term: do not add `n8n` as core infrastructure.

Later: support it only as an optional integration layer for advanced customers, external automations, and non-critical workflows.
