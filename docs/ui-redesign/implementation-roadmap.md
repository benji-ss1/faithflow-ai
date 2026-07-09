# Implementation Roadmap

All phases below are intentionally scoped to avoid Claude’s operator/audio Phase 4 work.

## Phase A

- dashboard shell
- sidebar
- topbar
- theme tokens

Safe scope:

- `src/components/layout`
- dashboard/account shell work only
- no operator/audio/live route changes

## Phase B

- overview dashboard cards
- empty states
- readiness summaries

Safe scope:

- `(app)/dashboard`
- generic status cards
- no operator runtime logic changes

## Phase C

- organization
- profile
- team
- settings account surfaces

Safe scope:

- church profile pages
- account/admin forms
- no auth logic changes

## Phase D

- applications
- devices
- Bible licenses

Safe scope:

- account-level applications UI
- licensing cards
- device summary surfaces only

## Phase E

- subscriptions scaffold
- billing scaffold

Safe scope:

- UI/state scaffolding only
- no billing enforcement on Sunday live operation

## Phase F

- imports / migration dashboard entry points
- review cards and queue UI

Safe scope:

- admin review surfaces
- no importer backend rewrite required in the first pass

## Phase G

- polish pass
- motion refinement
- command search
- responsive behavior

Safe scope:

- visual and interaction polish only
- keep motion restrained and accessibility-safe

## Rollout Rule

Do not touch:

- operator page internals
- audio setup internals
- projector routes
- live output components
- transcription
- websocket flows
- AI listening pipeline

The redesign should land through shell/account/dashboard slices first, with clear component ownership and no overlap with Claude’s Phase 4 work.
