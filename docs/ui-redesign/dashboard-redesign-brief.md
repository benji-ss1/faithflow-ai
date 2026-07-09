# Dashboard Redesign Brief

## Current Problem

FaithFlow’s general web app shell is not yet at the level the product needs for a premium church-tech SaaS.

Current issues:

- the account/dashboard layer is not visually distinctive enough
- navigation does not yet express the full product surface clearly
- operational status, licensing, billing, and setup information are not unified into one confident system
- the general dashboard experience feels lighter and more utilitarian than the product ambition

The operator/live area should remain darker and more mission-critical. The broader dashboard/account area needs to feel premium, calm, and capable without becoming generic admin-panel sludge.

## Design Goals

- create a dark-first premium SaaS dashboard identity for FaithFlow
- make the app feel more polished than RenewedVision’s account area without copying it
- separate account/admin/product-management surfaces from the live operator experience
- support church admins, operators, pastors, and billing owners with clearer information architecture
- make licensing, applications, subscriptions, and organization management feel first-class

## Design Principles

- calm confidence over noisy futurism
- dark surfaces with depth, not flat darkness
- production/media feel without gamer aesthetics
- clear hierarchy and fewer but stronger cards
- premium motion, subtle and purposeful
- strong empty states and locked states
- licensing, billing, and device status must be legible at a glance

## Visual Direction

- dark-first foundation
- primary structural color: `#232b2b`
- layered surfaces:
  - matte background
  - soft glass/elevated cards
  - restrained gloss only on premium/high-value surfaces
- church-tech tone:
  - serious
  - polished
  - trustworthy
  - slightly cinematic

## Information Architecture

Two levels:

### Product workspace nav

- Overview
- Services
- Operator
- Songs
- Bible Library
- Media Library
- Sermon Archive
- AI Assistant
- Imports & Migration
- Church Profile
- Team
- Devices & Outputs
- Billing
- Settings

### Account/admin nav

- Dashboard
- Organization
- Applications
- Subscriptions
- Billing
- My Profile
- Get More Products

## Navigation Model

- left sidebar for primary workspace navigation
- top bar for organization switcher, search, notifications, profile, and environment status
- account/admin subnav can sit in a secondary rail or segmented top tabs depending on screen size
- mobile collapses to sheet navigation with grouped sections

## Page List

- Overview Dashboard
- Services
- Songs
- Bible Library
- Media Library
- Sermon Archive
- AI Assistant
- Imports & Migration
- Organization / Church Profile
- Team
- Devices & Outputs
- Applications
- Subscriptions
- Billing
- My Profile
- Settings
- Get More Products

## Component Inventory

Core system should be built from reusable primitives and premium dashboard blocks:

- AppShell
- Sidebar
- TopBar
- ChurchSwitcher
- AccountSwitcher
- CommandSearch
- StatCard
- PlanCard
- ProductCard
- BibleLicenseCard
- DeviceCard
- ServiceStatusCard
- AIHealthCard
- BillingCard
- OnboardingChecklist
- UpgradeBanner
- DataTable
- EmptyState
- SettingsSection
- DangerZone

## Motion Rules

- page entrance: restrained fade/slide
- sidebar: soft spring, not bouncy
- cards: subtle stagger, only where it improves scan
- hover: light elevation and border illumination
- avoid dramatic transforms, parallax, or ambient loops that distract from church operations

## Responsive Behavior

- desktop:
  - persistent sidebar
  - spacious cards
  - secondary panels for billing/status/licensing
- tablet:
  - condensed sidebar
  - two-column card system
- mobile:
  - stacked cards
  - top summary first
  - drawer/sheet navigation
  - billing/settings remain usable, not desktop-only

## Accessibility Rules

- WCAG-conscious contrast on dark surfaces
- clear focus rings
- keyboard-navigable sidebar and command search
- semantic landmarks and headings
- motion respects reduced-motion settings
- badges and status cannot rely on color alone

## What To Avoid

- flat black everywhere
- purple-on-black “AI startup” styling
- cluttered KPI dashboards with no church context
- overusing transparency until readability drops
- generic white admin components pasted into a dark shell
- copying RenewedVision layouts too directly
