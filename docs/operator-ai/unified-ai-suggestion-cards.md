# Unified AI Suggestion Cards

## Goals

- use one suggestion-card model across operator AI surfaces
- support metadata-only results without pretending they are live-ready assets
- keep action policy explicit per suggestion type

## Supported Suggestion Types

- scripture
- song title
- lyric fragment
- command
- sermon slide
- internet metadata result

## Core Card Model

### Fields

- `id`
  - stable unique suggestion id
- `type`
  - `scripture | song_title | lyric_fragment | command | sermon_slide | internet_metadata_result`
- `detected_phrase`
  - raw text or phrase the model heard or inferred
- `normalized_query`
  - cleaned lookup string used for matching
- `matched_entity_id`
  - local DB id or provider id if available
- `matched_title`
  - best display label for the result
- `source`
  - `local_library | current_service | public_domain | internet_metadata | licensed_provider | operator_manual`
- `confidence`
  - `0.00 - 1.00`
- `availability`
  - `ready | metadata_only | license_required | unavailable | invalid`
- `can_preview`
  - whether the user can open a safe preview
- `can_send_live`
  - whether the suggestion can be staged or sent live
- `reason`
  - short explanation for why this candidate was selected
- `warning`
  - rights, ambiguity, or validation warning if needed
- `status`
  - `pending | approved | rejected | edited | sent_live | dismissed`
- `actions`
  - available action set for the current type and rights state

## Per-Type Expectations

## Scripture

- source usually local translation or public-domain fallback
- `can_preview = true` when verse text is available
- `can_send_live = true` only when text is rights-safe for projection

## Song Title

- source may be local library, current service, public-domain, or internet metadata
- `can_send_live = true` only when a real local/provider-backed song asset exists

## Lyric Fragment

- treat as more fragile than title detection
- if matched only through internet metadata, keep `metadata_only`
- if matched to local licensed-safe content, allow preview

## Command

- examples:
  - blank screen
  - show logo
  - next slide
- no licensing concerns, but very high confidence should be required for destructive/live actions

## Sermon Slide

- source should be local sermon deck or local slide assets
- `can_send_live = true` only when the referenced slide exists locally

## Internet Metadata Result

- explicitly non-projectable by default
- used to inform the operator, not to bypass rights rules

## Action Matrix

### Common actions

- `Preview`
- `Stage`
- `Send Live`
- `Approve`
- `Reject`
- `Edit`
- `Search Library`
- `Connect Provider`
- `Dismiss`

### Safe defaults

- `metadata_only`
  - allow `Search Library`, `Dismiss`
  - do not allow `Send Live`
- `license_required`
  - allow `Connect Provider`, `Dismiss`
  - do not allow `Preview` if no rights-safe text exists
- `invalid`
  - allow `Edit`, `Dismiss`

## Display Rules

- always show type icon
- always show source badge
- show confidence label in plain language:
  - `High`
  - `Medium`
  - `Low`
- show warning inline, not hidden in a tooltip only
- primary CTA should reflect the safest next action

## Suggested JSON Shape

```json
{
  "id": "sug_01J...",
  "type": "song_title",
  "detected_phrase": "Amazing Grace",
  "normalized_query": "amazing grace",
  "matched_entity_id": "song_123",
  "matched_title": "Amazing Grace",
  "source": "public_domain",
  "confidence": 0.93,
  "availability": "ready",
  "can_preview": true,
  "can_send_live": true,
  "reason": "Exact title match in church library and current service plan.",
  "warning": null,
  "status": "pending",
  "actions": ["preview", "approve", "send_live", "reject"]
}
```

## Test Cases

- same card schema supports scripture, song, and command suggestions without custom one-off fields
- metadata-only internet result renders with disabled live action
- rights-blocked scripture card shows translation warning and no text
- local slide suggestion has preview/send-live enabled only when a local asset exists
- edited suggestion preserves original detected phrase and updated normalized query
