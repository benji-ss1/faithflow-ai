# Song Lyrics and CCLI Licensing

FaithFlow should assume that most modern worship lyrics are copyrighted and cannot be freely distributed, bundled, or synced across churches as if they were public-domain content.

This document is product guidance, not legal advice.

## Core Principle

FaithFlow cannot safely act like a public worship-lyrics distributor.

Why:

- many worship songs remain under active copyright
- churches often have performance/projection/reporting rights through services like CCLI, but that does not automatically give a SaaS vendor blanket redistribution rights
- storing, syncing, exporting, or redistributing lyrics across church accounts can create a separate licensing problem from local church use

## Why FaithFlow Cannot Freely Distribute Worship Lyrics

Church worship use and software-platform distribution are not the same thing.

A church may be licensed to:

- project lyrics during worship
- print service sheets
- report song usage

That does not automatically mean FaithFlow may:

- ship a global lyric database of copyrighted songs
- give every church access to every lyric text by default
- sync copyrighted lyrics across tenants
- export lyric packs outside the church’s own licensed context

## How Churches Commonly Manage Lyrics

Typical church workflow:

- they maintain a local song library in presentation software
- they manually enter lyrics or import them from licensed sources
- they rely on CCLI / SongSelect or similar services for lyrics, charts, and reporting
- they track usage for royalty/reporting requirements

This maps well to a church-owned content model inside FaithFlow.

## CCLI-Style Reporting Considerations

FaithFlow should design for reporting, not assume FaithFlow itself is the license.

Useful reporting-oriented metadata:

- song title
- alternate title
- author / composer / arranger
- publisher
- copyright notice
- CCLI song number
- source of import
- dates used
- services used in
- whether projected / printed / streamed

FaithFlow should be able to generate church-facing usage logs and export reports later.

## Product-Safe Content Model

### Church-owned song libraries

Preferred model:

- each church owns or imports its own song records
- lyrics are scoped to that church
- FaithFlow does not expose one church’s copyrighted lyrics to another church
- imported song metadata is retained for reporting and auditing

### Manual lyric entry

Manual entry is acceptable product behavior if:

- the church is responsible for rights compliance
- FaithFlow presents warnings for copyrighted content
- the UI captures copyright and licensing metadata

### Imported lyrics

Imports from ProPresenter, EasyWorship, OpenLP, or similar systems should be treated as church-owned imported content, not FaithFlow-distributed catalog content.

FaithFlow should:

- import lyrics into the originating church only
- retain source system metadata if available
- warn the admin that imported copyrighted lyrics remain the church’s licensing responsibility

## Risks If FaithFlow Stores, Syncs, or Distributes Lyrics

Main risk areas:

- bundling copyrighted lyrics in the product
- cross-tenant sharing of copyrighted lyrics
- exporting lyrics in archives or backups without a rights model
- syncing lyrics into third-party clouds automatically
- using copyrighted lyrics to train AI or generate content suggestions

High-risk behaviors to avoid:

- “global song catalog” of copyrighted lyrics without license
- public API access to lyric text
- unauthenticated lyric downloads
- shipping demo seed data with copyrighted modern worship lyrics

## CCLI / SongSelect-Style Integration Placeholder

Future safe direction:

- church connects its own authorized lyric provider
- FaithFlow fetches lyrics on behalf of that church within provider rules
- FaithFlow stores only the allowed cache, or none if provider terms disallow it
- FaithFlow logs song usage and can help churches export usage reports

Until then:

- do not market copyrighted lyric access as included
- do not imply FaithFlow replaces CCLI or SongSelect rights

## Copyright Footer Fields To Capture

Every song record should support:

- title
- authors
- publisher
- copyright year
- copyright notice
- CCLI song number
- licensing source
- imported from
- translation / adaptation note
- public-domain flag

Every projected lyric item should be able to render:

- song title
- copyright notice
- CCLI number

Whether it is always shown can be configurable later, but the data model should exist.

## Song Usage Logs

FaithFlow should track:

- song used
- church
- service plan
- date/time used
- output mode
  - projected
  - printed
  - livestreamed
- frequency count

This is useful for:

- church reporting
- internal audit
- future licensing integrations

## Recommended MVP Handling

- allow church-scoped manual lyric entry
- allow church-scoped imports from existing systems
- capture copyright metadata fields
- store usage metadata
- warn on import that copyrighted lyrics remain the church’s responsibility
- do not ship a built-in copyrighted worship-lyrics catalog
- do not build “search all worship songs with full lyrics” unless licensing is solved

## Public-Domain Exception

FaithFlow can safely ship public-domain hymns or church-created original songs if:

- provenance is clear
- the public-domain flag is explicit
- the product distinguishes public-domain from copyrighted content

## Source Notes

References consulted:

- CCLI official site:
  - <https://au.ccli.com/>
- SongSelect landing page:
  - <https://songselect.ccli.com/>
- background context on CCLI’s role:
  - <https://en.wikipedia.org/wiki/Christian_Copyright_Licensing_International>

The product recommendation here is intentionally conservative: church worship rights do not equal SaaS redistribution rights.
