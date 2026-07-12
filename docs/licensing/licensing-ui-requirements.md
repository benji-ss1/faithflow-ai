# Licensing UI Requirements

## Goals

- make rights status obvious before a church enables content
- support public-domain content cleanly
- prevent user confusion around licensed content
- capture song copyright metadata without making rights assumptions

## Bible Library Page

### Required sections

- public-domain translations
- licensed translations
- connected providers
- translation details drawer or modal

### Required card states

- available
- locked
- connected via provider
- unavailable in region or plan

### Required badges

- `Public Domain`
- `Requires License`
- `Connected Provider`
- `Coming Soon`

### Required metadata on each card

- abbreviation
- full name
- source / publisher
- rights status
- canon notes if relevant
- short handling note
  - `Included with PresentFlow`
  - `Requires external license`

## Locked Licensed Bible Cards

Each locked card should show:

- translation name
- abbreviation
- short publisher/rights line
- lock icon
- clear CTA:
  - `Learn about licensing`
  - `Connect provider`
  - `Contact sales`

It should not imply that the translation is included by default.

## Translation Source and Copyright Info

Every translation detail view should show:

- source / publisher / holder
- rights status
- whether full-text embedding is enabled
- whether export/projection is allowed under the current connection model
- last verified rights note

## Song Copyright Metadata Fields

Song forms should include:

- title
- alternate title
- authors
- publisher
- copyright year
- copyright notice
- CCLI number
- source
- public-domain checkbox
- imported-from field

## Import Warning for Lyrics

When lyrics are imported:

- show an import warning banner
- explain that imported copyrighted lyrics remain the church’s licensing responsibility
- offer a checkbox acknowledgment for admins
- log import source and timestamp

## Song Usage Report UI

Admin reporting should support:

- date range
- service plan filter
- song filter
- usage count
- projected / printed / livestream flags
- export placeholder for future reporting integrations

## Admin Settings for Licensed Providers

Settings should include a content licensing section with:

- connected Bible providers
- provider status
- enabled translations
- organization notes
- future church license upload / verification placeholder

## UX Rules

- rights information should be visible before a user clicks deep into content
- locked content should still be informative, not mysterious
- warnings should be calm and operational, not legalistic
- public-domain content should feel first-class, not second-rate
