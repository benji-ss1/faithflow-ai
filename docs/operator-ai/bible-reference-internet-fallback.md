# Bible Reference Internet Fallback

## Goals

- detect Bible references reliably from local data first
- keep public-domain and licensed translation handling separate
- avoid embedding or serving copyrighted Bible text without rights
- allow graceful fallback when a requested translation is unavailable

## Resolution Order

### 1. Local reference detection first

- parse detected references locally from transcript, commands, or pasted text
- normalize:
  - book aliases
  - chapter and verse punctuation
  - verse ranges
  - single-verse shorthand
- validate that the reference is structurally possible before any content lookup

### 2. Local translations first

- attempt lookup against:
  - church default local translation
  - other enabled local public-domain translations
- if a translation exists locally, treat it as the primary response path

### 3. Public-domain fallback

- if the requested translation is unavailable, fall back to a local public-domain translation
- mark the fallback clearly in UI
- public-domain fallback should prioritize:
  - church default public-domain translation
  - then other available public-domain translations

### 4. Licensed Bible API placeholder

- future provider layer may fetch verses on demand for licensed translations
- no licensed verse text should be cached as if it were public-domain content
- provider responses should respect:
  - church connection state
  - enabled translation list
  - usage rights for projection/export

## Reference Validation

### Validate before lookup

- known book name or alias
- chapter exists for the selected book
- verse start is positive
- verse end is not before verse start
- reference length is within reasonable preview bounds

### Invalid-reference behavior

- do not invent nearby verses silently
- return a warning state
- offer corrected suggestions only if confidence is high

## Translation Availability Rules

### Requested translation available locally

- show local verse text
- allow preview/send-live according to normal projection rules

### Requested translation unavailable, public-domain fallback available

- show fallback verse text
- show warning:
  - `Requested translation unavailable. Showing WEB instead.`
- allow preview/send-live for the fallback only

### Requested licensed translation not connected

- validate the reference, but do not show copyrighted verse text
- show:
  - detected reference
  - requested translation code
  - unavailability warning
- future CTA:
  - `Connect provider`

## Hard Guardrails

- do not embed copyrighted Bible text into the app database without a license path
- do not scrape Bible websites for full verse text
- do not present search snippets as a rights-safe verse source
- do not export or project licensed translation text unless the provider/license rules allow it

## UI States

### Local ready

- show reference
- show translation badge
- show text preview
- allow send live

### Public-domain fallback

- show requested translation
- show actual translation served
- show fallback badge
- allow send live for the fallback only

### Licensed translation unavailable

- show reference only
- show `License required` or `Provider not connected`
- disable text preview and live projection

### Invalid or ambiguous reference

- show detected phrase
- show validation error
- offer likely corrected references if confidence is high

## Recommended Logs

- `ai.scripture.detected`
- `ai.scripture.validated`
- `ai.scripture.resolved_local`
- `ai.scripture.resolved_public_domain_fallback`
- `ai.scripture.blocked_licensed_unavailable`
- `ai.scripture.invalid_reference`

## Test Cases

- local default translation resolves a standard reference with no network dependency
- missing requested translation falls back to available local public-domain text
- licensed translation request without provider shows no copyrighted verse text
- malformed references are rejected with a warning instead of guessed silently
- verse range beyond chapter bounds is flagged invalid
- same reference can preview in a public-domain translation while a requested licensed translation stays blocked
