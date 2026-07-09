# Licensing Product Strategy

## Strategy Summary

FaithFlow should treat licensed Bible text and copyrighted worship lyrics as modular, rights-sensitive content layers rather than bundled MVP content.

Recommended model:

- FaithFlow ships with public-domain Bible translations only
- licensed translations appear as locked or license-required resources
- churches can connect licensed providers later
- Bible translation architecture stays modular
- song lyrics are church-owned or church-imported, not globally distributed by FaithFlow
- FaithFlow stores usage metadata and copyright fields
- future marketplace or licensing partnerships can be added later

## MVP Policy

### Bible translations

- ship public-domain/open translations only
  - KJV
  - WEB
  - optional ASV / Douay-Rheims / YLT / OEB
- show licensed translations as locked cards
- do not bundle copyrighted translation text in the product

### Song lyrics

- allow church-scoped manual lyric entry
- allow church-scoped imports
- store metadata and usage logs
- do not bundle a copyrighted lyric catalog

## Pilot Church Policy

For pilots:

- keep the same conservative default as MVP
- if a pilot insists on a licensed translation:
  - require explicit written rights confirmation or a provider arrangement
  - avoid making that pilot arrangement appear as globally available product functionality
- do not let one pilot’s licensed content become multi-tenant shared content

## Paid SaaS Policy

For paid SaaS:

- keep public-domain Bible text bundled
- offer licensed translations only through:
  - negotiated platform license
  - approved API/provider integration
  - customer-provided licensed access path
- keep copyrighted worship lyrics church-scoped
- generate reporting/support tools, not blanket redistribution

## Enterprise / Multi-Campus Policy

Enterprise needs tighter controls:

- explicit organization ownership boundaries
- content-sharing controls per campus / per church
- provider connection management
- audit logs for licensed-content access
- retention and export controls

Enterprise customers may justify:

- provider integrations
- custom licensing terms
- campus-scoped Bible access rules
- centralized usage reporting

## Why FaithFlow Should Stay Conservative

The legal and operational risks are asymmetric:

- shipping public-domain text is straightforward
- shipping copyrighted text without full rights is high-risk
- church-facing scripture features are valuable even with public-domain defaults
- lyric workflow value exists even if FaithFlow never becomes the rights distributor

## UI Implications

### Bible library

- public-domain translations clearly available
- licensed translations visible but locked
- each translation card shows:
  - translation name
  - abbreviation
  - public-domain or requires-license badge
  - rights/source summary

### Song library

- songs can be added manually or imported
- copyright metadata fields are first-class
- imported copyrighted lyrics trigger a warning banner
- usage reporting is visible from admin/account areas

### Settings/admin

- provider connections live in admin settings
- organization-level content policy should state:
  - which translations are enabled
  - whether external licensed providers are connected
  - who can import copyrighted lyrics

## Architecture Implications

### Bible architecture must be modular

- translation registry
- source metadata
- rights type
  - public domain
  - licensed
  - external provider
- content retrieval adapter per source
- lock state in UI

### Lyrics architecture must be church-owned

- church-scoped song rows
- church-scoped lyric content
- usage event logs
- copyright metadata
- import provenance

## Legal Risk Warnings

High-risk product moves:

- bundling NIV/ESV/NLT/NKJV/etc. full text without rights
- bundling modern worship lyrics globally
- syncing copyrighted lyrics across church tenants
- training AI on copyrighted imported lyric text without clear rights analysis
- exporting licensed Bible text into sermon packs or archives without permission

## Product Recommendation

### Safe near-term

- public-domain Bible bundle
- locked licensed Bible cards
- church-owned song libraries
- usage metadata and reporting

### Future optional expansion

- Bible provider integrations
- licensing marketplace partnerships
- approved lyric-provider connections
- enterprise content-governance controls

## Bottom Line

FaithFlow should win first on workflow, presentation, archive, and church operations.

It should not make licensed Bible text or copyrighted worship lyrics the core bundled value proposition until rights are explicitly solved.
