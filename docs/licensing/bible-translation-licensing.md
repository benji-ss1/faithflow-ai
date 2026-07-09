# Bible Translation Licensing

As of July 9, 2026, FaithFlow should take a conservative product position: only ship Bible text that is clearly public domain or openly licensed for redistribution, and treat most modern translations as licensed content that requires permission, a provider integration, or church-supplied rights.

This is a product/implementation brief, not legal advice. Final launch decisions should be checked with counsel and, where relevant, the translation owner.

## MVP Position

- Safe default for MVP:
  - ship only public-domain or clearly open translations
  - store translation metadata modularly
  - keep licensed translations visible in UI but locked
- Unsafe default for MVP:
  - embedding full copyrighted Bible text in the product database
  - syncing licensed text into exports, slides, or caches without permission

## Translation Matrix

| Abbr. | Translation | Holder / Publisher | Status | Can FaithFlow embed full text directly? | API / license needed? | BYO church license? | Recommended MVP handling |
|---|---|---|---|---|---|---|---|
| KJV | King James Version / Authorized Version | Public domain in most jurisdictions; special Crown/royal rights in the UK | Public domain in most markets, special UK caveat | Yes for most markets; use caution for UK-specific distribution questions | No for most markets | No | Ship for MVP, with note about UK-specific publishing caveat |
| WEB | World English Bible | eBible.org / Michael Paul Johnson; trademark on the name, text public domain | Public domain | Yes | No | No | Ship for MVP |
| ASV | American Standard Version (1901) | Historical publication, now public domain | Public domain | Yes | No | No | Ship for MVP if desired, though it is dated |
| DRB | Douay-Rheims | Historical translation | Generally treated as public domain | Yes | No | No | Ship only if product wants Catholic public-domain option |
| YLT | Young’s Literal Translation | Historical translation | Public domain | Yes | No | No | Optional MVP add, but not ideal as default reading text |
| OEB | Open English Bible | Russell Allen / OEB team | CC0 / public domain equivalent | Yes | No | No | Optional MVP add if incomplete OT coverage is acceptable |
| NIV | New International Version | Biblica, published in US by Zondervan | Licensed | No | Yes | Possibly | Locked; pursue license or provider deal later |
| ESV | English Standard Version | Crossway / Good News Publishers | Licensed | No | Yes | Possibly | Locked; future provider/license integration |
| NKJV | New King James Version | Thomas Nelson / HarperCollins Christian | Licensed | No | Yes | Possibly | Locked |
| NLT | New Living Translation | Tyndale House Foundation | Licensed | No | Yes | Possibly | Locked |
| MSG | The Message | NavPress / The Message Trust rights chain depending edition | Licensed | No | Yes | Possibly | Locked |
| NASB | New American Standard Bible | The Lockman Foundation | Licensed | No | Yes | Possibly | Locked |
| AMP | Amplified Bible | The Lockman Foundation | Licensed | No | Yes | Possibly | Locked |
| CSB | Christian Standard Bible | Holman Bible Publishers / B&H / Lifeway | Licensed | No | Yes | Possibly | Locked |
| NRSV | New Revised Standard Version | National Council of Churches | Licensed | No | Yes | Possibly | Locked |
| RSV | Revised Standard Version | National Council of Churches | Licensed | No | Yes | Possibly | Locked |

## Public-Domain Or Open Translations

### KJV

- Abbreviation: `KJV`
- Full name: King James Version / Authorized Version
- Rights position:
  - public domain in most of the world
  - special Crown / royal-prerogative printing rights still exist in the UK
- FaithFlow direct embedding:
  - generally yes for MVP, especially outside the UK
- API / license:
  - not generally required
- Church BYO license:
  - not generally required
- Recommended MVP handling:
  - safe MVP inclusion
  - add internal note that UK-specific commercial distribution questions should be rechecked before broad UK rollout

### WEB

- Abbreviation: `WEB`
- Full name: World English Bible
- Holder / publisher:
  - text distributed via eBible.org / WorldEnglish.Bible
  - the name is trademarked, but the text is explicitly public domain
- FaithFlow direct embedding:
  - yes
- API / license:
  - no
- Church BYO license:
  - no
- Recommended MVP handling:
  - one of the best MVP defaults because it is modern enough to use and explicitly open

### ASV

- Abbreviation: `ASV`
- Full name: American Standard Version
- Holder / publisher:
  - historic 1901 edition; public domain
- FaithFlow direct embedding:
  - yes
- API / license:
  - no
- Church BYO license:
  - no
- Recommended MVP handling:
  - safe to include, but likely secondary to WEB or KJV for usability

### Douay-Rheims

- Abbreviation: `DRB` or `DRA`
- Full name: Douay-Rheims Bible
- Holder / publisher:
  - historical translation, commonly treated as public domain
- FaithFlow direct embedding:
  - yes
- API / license:
  - no
- Church BYO license:
  - no
- Recommended MVP handling:
  - include only if Catholic/public-domain coverage matters in early pilots

### Young’s Literal Translation

- Abbreviation: `YLT`
- Full name: Young’s Literal Translation
- Holder / publisher:
  - historical translation, public domain
- FaithFlow direct embedding:
  - yes
- API / license:
  - no
- Church BYO license:
  - no
- Recommended MVP handling:
  - optional, not primary

### Other verified open/public-domain candidates

#### OEB

- Abbreviation: `OEB`
- Full name: Open English Bible
- Holder / publisher:
  - Russell Allen / OEB team
- Rights position:
  - CC0 / public domain equivalent
- FaithFlow direct embedding:
  - yes
- API / license:
  - no
- Church BYO license:
  - no
- Recommended MVP handling:
  - optional
  - note that coverage is still developing, so product should flag canon/completeness clearly

## Modern Licensed Translations

For all of the translations below, the safe default is:

- do not bundle full text in FaithFlow MVP
- do not store redistributable full-text copies without permission
- do not assume a church’s possession of printed Bibles equals SaaS redistribution rights

### NIV

- Abbreviation: `NIV`
- Full name: New International Version
- Holder / publisher:
  - Biblica
  - commonly published in the US by Zondervan
- Status:
  - licensed
- Can FaithFlow embed text directly?
  - no, not by default
- API / license needed?
  - yes
- BYO church license?
  - likely, unless FaithFlow secures platform rights
- Recommended MVP handling:
  - locked translation card
  - future provider/license integration

### ESV

- Abbreviation: `ESV`
- Full name: English Standard Version
- Holder / publisher:
  - Crossway / Good News Publishers
- Status:
  - licensed
- Can FaithFlow embed text directly?
  - no
- API / license needed?
  - yes
- BYO church license?
  - likely
- Recommended MVP handling:
  - locked

### NKJV

- Abbreviation: `NKJV`
- Full name: New King James Version
- Holder / publisher:
  - Thomas Nelson
- Status:
  - licensed
- Can FaithFlow embed text directly?
  - no
- API / license needed?
  - yes
- BYO church license?
  - likely
- Recommended MVP handling:
  - locked

### NLT

- Abbreviation: `NLT`
- Full name: New Living Translation
- Holder / publisher:
  - Tyndale House Foundation
- Status:
  - licensed
- Can FaithFlow embed text directly?
  - no
- API / license needed?
  - yes
- BYO church license?
  - likely
- Recommended MVP handling:
  - locked

### MSG

- Abbreviation: `MSG`
- Full name: The Message
- Holder / publisher:
  - typically associated with NavPress and related rights holders for editions/distribution
- Status:
  - licensed
- Can FaithFlow embed text directly?
  - no
- API / license needed?
  - yes
- BYO church license?
  - likely
- Recommended MVP handling:
  - locked

### NASB

- Abbreviation: `NASB`
- Full name: New American Standard Bible
- Holder / publisher:
  - The Lockman Foundation
- Status:
  - licensed
- Can FaithFlow embed text directly?
  - no
- API / license needed?
  - yes
- BYO church license?
  - likely
- Recommended MVP handling:
  - locked

### AMP

- Abbreviation: `AMP`
- Full name: Amplified Bible
- Holder / publisher:
  - The Lockman Foundation
- Status:
  - licensed
- Can FaithFlow embed text directly?
  - no
- API / license needed?
  - yes
- BYO church license?
  - likely
- Recommended MVP handling:
  - locked

### CSB

- Abbreviation: `CSB`
- Full name: Christian Standard Bible
- Holder / publisher:
  - Holman Bible Publishers / B&H / Lifeway
- Status:
  - licensed
- Can FaithFlow embed text directly?
  - no
- API / license needed?
  - yes
- BYO church license?
  - likely
- Recommended MVP handling:
  - locked

### NRSV

- Abbreviation: `NRSV`
- Full name: New Revised Standard Version
- Holder / publisher:
  - National Council of Churches
- Status:
  - licensed
- Can FaithFlow embed text directly?
  - no
- API / license needed?
  - yes
- BYO church license?
  - likely
- Recommended MVP handling:
  - locked

### RSV

- Abbreviation: `RSV`
- Full name: Revised Standard Version
- Holder / publisher:
  - National Council of Churches
- Status:
  - licensed
- Can FaithFlow embed text directly?
  - no
- API / license needed?
  - yes
- BYO church license?
  - likely
- Recommended MVP handling:
  - locked

## Practical Product Rules

### What FaithFlow can safely do in MVP

- bundle KJV
- bundle WEB
- optionally bundle ASV, Douay-Rheims, YLT, OEB if product wants broader public-domain support
- store verse references and church-selected translation metadata
- allow future modular connectors for licensed translations

### What FaithFlow should avoid in MVP

- bundling NIV, ESV, NKJV, NLT, MSG, NASB, AMP, CSB, NRSV, or RSV text
- exporting licensed translation text in PDFs, slide packs, archives, or APIs without a rights model
- caching licensed text indefinitely once fetched from a future provider

## Recommended MVP Translation Set

Recommended initial built-in set:

- `KJV`
- `WEB`
- optional:
  - `ASV`
  - `Douay-Rheims`
  - `YLT`

Keep visible but locked:

- `NIV`
- `ESV`
- `NKJV`
- `NLT`
- `MSG`
- `NASB`
- `AMP`
- `CSB`
- `NRSV`
- `RSV`

## Source Notes

Primary or near-primary references consulted:

- World English Bible official site:
  - <https://worldenglish.bible/>
- Open English Bible official site:
  - <https://openenglishbible.org/>
- Lockman NASB page:
  - <https://www.lockman.org/new-american-standard-bible-nasb/>
- CCLI ecosystem references for church content licensing context:
  - <https://au.ccli.com/>

Secondary references used to verify holder/history/status where official pages were not directly surfaced in search:

- NIV:
  - <https://en.wikipedia.org/wiki/New_International_Version>
- ESV:
  - <https://en.wikipedia.org/wiki/English_Standard_Version>
- NKJV:
  - <https://en.wikipedia.org/wiki/New_King_James_Version>
- NLT:
  - <https://en.wikipedia.org/wiki/New_Living_Translation>
- CSB:
  - <https://en.wikipedia.org/wiki/Christian_Standard_Bible>
- NASB:
  - <https://en.wikipedia.org/wiki/New_American_Standard_Bible>
- NRSV:
  - <https://en.wikipedia.org/wiki/New_Revised_Standard_Version>
- RSV:
  - <https://en.wikipedia.org/wiki/Revised_Standard_Version>
- KJV / UK rights caveat:
  - <https://en.wikipedia.org/wiki/King_James_Version>
- ASV / YLT / public-domain list context:
  - <https://en.wikipedia.org/wiki/List_of_English_Bible_translations>

Where rights language is not directly quoted from an official permissions page, FaithFlow should treat the recommendation as conservative product guidance and verify with the owner before launch.
