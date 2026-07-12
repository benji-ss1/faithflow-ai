# Dashboard Information Architecture

## Primary Nav

### Overview

- purpose:
  - church-wide operational snapshot
- user role:
  - admin, operator, pastor
- main actions:
  - review readiness
  - open next service
  - review alerts and pending work
- cards/components needed:
  - welcome card
  - service status
  - AI health
  - audio status
  - projector status
  - recent archive
- empty states:
  - no upcoming services
  - no songs
  - no team activity
- future upgrades:
  - multi-campus summary

### Services

- purpose:
  - manage service plans
- user role:
  - admin, operator
- main actions:
  - create, schedule, review, operate
- cards/components needed:
  - service table
  - schedule cards
  - filters
- empty states:
  - no service plans yet
- future upgrades:
  - recurring templates

### Operator

- purpose:
  - launch and monitor operating workflow
- user role:
  - operator
- main actions:
  - open current service
- cards/components needed:
  - launch panel
  - readiness summary
- empty states:
  - no active service
- future upgrades:
  - operator presets

### Songs

- purpose:
  - manage song library
- user role:
  - admin, operator, worship lead
- main actions:
  - add, import, edit, search
- cards/components needed:
  - song table
  - import callout
  - copyright metadata
- empty states:
  - no songs imported
- future upgrades:
  - provider integrations

### Bible Library

- purpose:
  - manage available Bible translations
- user role:
  - admin
- main actions:
  - enable public-domain translations
  - review locked licensed translations
- cards/components needed:
  - translation cards
  - license badges
  - provider section
- empty states:
  - no custom providers connected
- future upgrades:
  - licensed provider marketplace

### Media Library

- purpose:
  - manage images, videos, sermon assets
- user role:
  - admin, operator
- main actions:
  - upload, organize, assign
- cards/components needed:
  - media grid/table
  - filters
- empty states:
  - no media uploaded
- future upgrades:
  - packs / templates

### Sermon Archive

- purpose:
  - browse archived sermons and exports
- user role:
  - admin, pastor
- main actions:
  - search, download, review
- cards/components needed:
  - archive search
  - archive cards/table
- empty states:
  - no archived sermons yet
- future upgrades:
  - cloud exports

### AI Assistant

- purpose:
  - manage AI suggestions and health
- user role:
  - admin, pastor, operator
- main actions:
  - review suggestions
  - check AI state
- cards/components needed:
  - review queue
  - AI status cards
- empty states:
  - no pending suggestions
- future upgrades:
  - policy tuning

### Imports & Migration

- purpose:
  - manage imports and review results
- user role:
  - admin
- main actions:
  - start import
  - review errors
- cards/components needed:
  - import queue
  - review cards
  - history table
- empty states:
  - no imports run yet
- future upgrades:
  - provider syncs

### Church Profile

- purpose:
  - organization profile and ministry context
- user role:
  - admin
- main actions:
  - update details and defaults
- cards/components needed:
  - profile form
  - logo / branding card
- empty states:
  - onboarding prompts
- future upgrades:
  - multi-location settings

### Team

- purpose:
  - manage users and roles
- user role:
  - admin
- main actions:
  - invite, assign, review
- cards/components needed:
  - team table
  - invite card
  - role badges
- empty states:
  - no team members beyond owner
- future upgrades:
  - permissions matrix

### Devices & Outputs

- purpose:
  - manage projector, stage, and app/device state
- user role:
  - admin, operator
- main actions:
  - verify connections
  - review statuses
- cards/components needed:
  - device cards
  - output health cards
- empty states:
  - no devices registered
- future upgrades:
  - device fleet management

### Billing

- purpose:
  - manage plan, invoices, payment, usage
- user role:
  - admin, finance owner
- main actions:
  - update payment method
  - review invoices
- cards/components needed:
  - plan card
  - payment card
  - invoice table
- empty states:
  - no payment method
- future upgrades:
  - usage alerts

### Settings

- purpose:
  - advanced church and app settings
- user role:
  - admin
- main actions:
  - update preferences
  - connect providers
- cards/components needed:
  - settings sections
  - danger zones
- empty states:
  - use defaults
- future upgrades:
  - policy controls

## Admin / Account Nav

### Dashboard

- purpose:
  - account-level summary across apps, plan, profile, and billing
- user role:
  - admin / owner
- main actions:
  - review account health
- cards/components needed:
  - plan card
  - profile card
  - payment card
- empty states:
  - trial onboarding
- future upgrades:
  - portfolio summary

### Organization

- purpose:
  - legal and organization details
- user role:
  - admin / owner
- main actions:
  - update church/org data
- cards/components needed:
  - organization profile
  - schedule and branding cards
- empty states:
  - setup prompts
- future upgrades:
  - multi-campus hierarchy

### Applications

- purpose:
  - show PresentFlow product modules and status
- user role:
  - admin
- main actions:
  - review enabled apps and connected devices
- cards/components needed:
  - product cards
  - license cards
  - status cards
- empty states:
  - modules not enabled yet
- future upgrades:
  - app marketplace

### Subscriptions

- purpose:
  - plan/seats/trial/usage management
- user role:
  - owner, finance admin
- main actions:
  - upgrade, review usage, manage seats
- cards/components needed:
  - plan card
  - seat usage card
  - AI/storage usage card
- empty states:
  - starter plan prompts
- future upgrades:
  - add-ons

### Billing

- purpose:
  - payment methods and invoices
- user role:
  - owner, finance admin
- main actions:
  - update card
  - download invoice
- cards/components needed:
  - billing card
  - receipts table
  - tax/VAT form
- empty states:
  - add payment method
- future upgrades:
  - tax exemptions

### My Profile

- purpose:
  - personal account management
- user role:
  - all users
- main actions:
  - update profile
  - review security settings
- cards/components needed:
  - avatar card
  - security section
  - danger zone
- empty states:
  - complete your profile
- future upgrades:
  - session management

### Get More Products

- purpose:
  - future marketplace / upsell area
- user role:
  - admin, owner
- main actions:
  - explore optional packs and modules
- cards/components needed:
  - product cards
  - media packs
  - templates
- empty states:
  - curated recommendations
- future upgrades:
  - paid marketplace
