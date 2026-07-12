# Internet-Assisted Song Detection

## Goals

- identify likely songs without making the open web a source of projected lyrics
- keep the church library as the primary source of truth
- use internet search only as metadata assistance, not as a content ingestion shortcut
- prevent unlicensed lyric projection
- surface confidence, provenance, and rights state clearly to the operator

## Detection Order

### 1. Local library first

- detect against church-scoped songs first
- normalize title, punctuation, casing, apostrophes, and common abbreviations
- prefer exact title match over fuzzy lyric-fragment match
- treat church-owned/imported songs as the highest-authority result for live usage

### 2. Current playlist boost

- boost songs already present in:
  - the active service plan
  - recent services from the same church
  - the current operator queue or recent preview stack
- if two songs score similarly, prefer the one already in the current service context

### 3. Public-domain hymn fallback

- search approved local public-domain hymn records when the church library has no strong match
- allow preview/send-live only if PresentFlow already has locally stored, rights-safe lyrics or slides
- typical examples:
  - public-domain hymn titles
  - church-owned public-domain slide versions

### 4. Internet metadata lookup

- only after local matching fails or remains low-confidence
- internet lookup may return:
  - canonical title
  - alternate title
  - likely artist/composer metadata
  - likely hymn/public-domain classification
  - likely provider/source candidate
- internet lookup must not import or scrape full lyrics
- internet lookup must not create a live-projectable asset by itself

### 5. Licensed provider placeholder

- reserve a future provider layer for approved integrations such as SongSelect-style or church-connected rights providers
- provider responses may confirm metadata and rights availability
- provider text or licensed assets should only be shown if the church has a valid connection and permitted usage path

## Hard Guardrails

### No open-web lyric scraping

- do not crawl lyric sites
- do not parse search result snippets into lyric content
- do not save copied lyric text from search results
- do not use scraped lyrics as embeddings, previews, or live content

### No projecting unlicensed lyrics

- internet metadata matches without local or licensed content must remain non-projectable
- if the match is likely copyrighted and no approved source is connected:
  - `can_preview = false`
  - `can_send_live = false`
  - show a rights warning

## Confidence Model

### Inputs

- exact title match strength
- fuzzy title match strength
- lyric-fragment similarity against local licensed-safe content only
- recency or current playlist boost
- hymn/public-domain classification confidence
- internet metadata agreement across multiple sources

### Suggested bands

- `0.90 - 1.00`
  - very high confidence
  - local exact match or confirmed provider match
- `0.75 - 0.89`
  - high confidence
  - local fuzzy title match with service-context support
- `0.55 - 0.74`
  - medium confidence
  - needs operator review before any staging action
- `< 0.55`
  - low confidence
  - show as informational only

## Source Badges

- `Church Library`
- `Current Service`
- `Public Domain`
- `Internet Metadata`
- `Licensed Provider`
- `Unavailable Rights`

Badge priority should reflect trust and usability:

1. `Church Library`
2. `Current Service`
3. `Licensed Provider`
4. `Public Domain`
5. `Internet Metadata`
6. `Unavailable Rights`

## UI States

### Local ready match

- show canonical title
- show confidence
- show source badge
- allow preview
- allow send live if the church asset is already renderable

### Metadata-only internet result

- show candidate title and metadata source
- disable live actions
- show `Metadata only` or `License required`
- offer:
  - `Search library`
  - `Add placeholder`
  - `Mark not this song`

### Public-domain fallback

- show `Public Domain` badge
- show available local slide or lyric status
- allow preview/send-live only if PresentFlow already has local rights-safe content prepared

### Unavailable licensed result

- show likely title
- show `Unavailable Rights`
- explain that the match may be correct but content cannot be projected
- future CTA:
  - `Connect licensed provider`

### Ambiguous result set

- group top 3 candidates
- show why each candidate was suggested
- keep actions conservative until one candidate is chosen

## Suggested Event Logging

- `ai.song.detected`
- `ai.song.matched_local`
- `ai.song.matched_public_domain`
- `ai.song.matched_internet_metadata`
- `ai.song.blocked_unlicensed`
- `ai.song.operator_confirmed`
- `ai.song.operator_rejected`

## Test Cases

- exact local song title is detected and ranked above every internet result
- song in the current service plan beats an older fuzzy library match
- public-domain hymn is detected without requiring internet access
- copyrighted song matched from internet metadata remains non-projectable with no local/provider asset
- lyric fragment from open web is never stored or projected
- ambiguous title returns multiple candidates with conservative actions
- licensed provider placeholder state shows disabled actions until a provider is connected
- low-confidence result does not auto-stage to preview or live
