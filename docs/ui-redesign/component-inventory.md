# Component Inventory

## AppShell

- purpose:
  - overall app frame
- props/data needed:
  - nav groups, current route, user, church
- variants:
  - workspace, account
- interactions:
  - sidebar collapse
- animation/polish notes:
  - subtle page transitions

## Sidebar

- purpose:
  - primary app navigation
- props/data needed:
  - groups, items, active state
- variants:
  - expanded, collapsed, mobile
- interactions:
  - hover, keyboard, nested groups
- animation/polish notes:
  - restrained spring

## TopBar

- purpose:
  - search, profile, context actions
- props/data needed:
  - title, breadcrumbs, user, church
- variants:
  - workspace, account
- interactions:
  - search, switchers, notifications
- animation/polish notes:
  - soft surface blur

## AccountSwitcher

- purpose:
  - switch account/admin contexts
- props/data needed:
  - account list, current account
- variants:
  - compact, expanded
- interactions:
  - dropdown
- animation/polish notes:
  - clean menu transitions

## ChurchSwitcher

- purpose:
  - switch org / church context
- props/data needed:
  - church list, current church
- variants:
  - single-tenant hidden state, multi-tenant visible state
- interactions:
  - searchable popover
- animation/polish notes:
  - instant feedback

## CommandSearch

- purpose:
  - global search and actions
- props/data needed:
  - commands, entities, routes
- variants:
  - global, contextual
- interactions:
  - keyboard-first
- animation/polish notes:
  - fast modal/sheet open

## StatCard

- purpose:
  - compact KPI or status summary
- props/data needed:
  - label, value, change, state
- variants:
  - neutral, success, warning, danger
- interactions:
  - link-through
- animation/polish notes:
  - slight count-in optional

## ProductCard

- purpose:
  - show FaithFlow module / app
- props/data needed:
  - name, description, state, icon
- variants:
  - enabled, disabled, future
- interactions:
  - open settings / manage
- animation/polish notes:
  - richer hover

## PlanCard

- purpose:
  - show subscription tier and upgrade state
- props/data needed:
  - plan, seats, renewal, CTA
- variants:
  - trial, active, past_due
- interactions:
  - manage / upgrade
- animation/polish notes:
  - premium border treatment

## BillingCard

- purpose:
  - payment summary
- props/data needed:
  - payment method, invoice summary, billing contact
- variants:
  - healthy, warning
- interactions:
  - update method
- animation/polish notes:
  - none beyond subtle hover

## BibleLicenseCard

- purpose:
  - show translation availability and rights status
- props/data needed:
  - translation, badge, provider, lock state
- variants:
  - public domain, locked, connected
- interactions:
  - details / connect provider
- animation/polish notes:
  - subtle lock-state polish

## DeviceCard

- purpose:
  - show device/output connection state
- props/data needed:
  - name, status, type, last seen
- variants:
  - connected, warning, offline
- interactions:
  - inspect / configure
- animation/polish notes:
  - status pulse only when needed

## OnboardingChecklist

- purpose:
  - onboarding progress and setup actions
- props/data needed:
  - steps, completion states
- variants:
  - first-run, returning
- interactions:
  - mark complete / navigate
- animation/polish notes:
  - satisfying progress motion

## ServiceStatusCard

- purpose:
  - next/today service readiness
- props/data needed:
  - title, date, readiness flags
- variants:
  - upcoming, active, empty
- interactions:
  - open service
- animation/polish notes:
  - prominent CTA

## AIHealthCard

- purpose:
  - AI readiness/health summary
- props/data needed:
  - status, queue counts, provider state
- variants:
  - healthy, degraded, disabled
- interactions:
  - review queue
- animation/polish notes:
  - subdued

## AudioStatusCard

- purpose:
  - account/dashboard-level audio setup summary
- props/data needed:
  - device state, check status
- variants:
  - ready, warning, needs setup
- interactions:
  - open setup
- animation/polish notes:
  - avoid noisy animation

## ImportReviewCard

- purpose:
  - pending import summary
- props/data needed:
  - count, latest job, warnings
- variants:
  - pending, failed, complete
- interactions:
  - review job
- animation/polish notes:
  - badge emphasis

## EmptyState

- purpose:
  - no-data guidance
- props/data needed:
  - icon, title, description, CTA
- variants:
  - neutral, setup, upgrade
- interactions:
  - CTA
- animation/polish notes:
  - minimal

## UpgradeBanner

- purpose:
  - feature / plan expansion CTA
- props/data needed:
  - message, CTA, plan context
- variants:
  - inline, hero
- interactions:
  - open billing/sales
- animation/polish notes:
  - restrained sheen

## SettingsSection

- purpose:
  - grouped settings block
- props/data needed:
  - title, description, children
- variants:
  - standard, licensing, billing
- interactions:
  - expand/collapse optional
- animation/polish notes:
  - light divider transitions

## DangerZone

- purpose:
  - destructive actions
- props/data needed:
  - title, warning, action
- variants:
  - account, organization
- interactions:
  - confirm flow
- animation/polish notes:
  - no flourish

## DataTable

- purpose:
  - tabular admin data
- props/data needed:
  - columns, rows, actions
- variants:
  - dense, spacious
- interactions:
  - sort, filter, select
- animation/polish notes:
  - keep motion minimal

## Tabs

- purpose:
  - page-local section switching
- props/data needed:
  - tabs, current tab
- variants:
  - underline, pill
- interactions:
  - keyboard switch
- animation/polish notes:
  - sliding active indicator

## Badge

- purpose:
  - concise status label
- props/data needed:
  - label, tone, icon optional
- variants:
  - public domain, requires license, warning, connected
- interactions:
  - tooltip trigger optional
- animation/polish notes:
  - static

## Tooltip

- purpose:
  - explain icons / states
- props/data needed:
  - content
- variants:
  - standard, rich
- interactions:
  - hover/focus
- animation/polish notes:
  - fast fade

## Modal

- purpose:
  - high-focus tasks
- props/data needed:
  - title, body, actions
- variants:
  - confirm, form, detail
- interactions:
  - close, submit
- animation/polish notes:
  - scale/fade subtle

## Sheet

- purpose:
  - mobile nav and secondary settings
- props/data needed:
  - side, content
- variants:
  - left nav, right details
- interactions:
  - swipe/click close
- animation/polish notes:
  - smooth slide

## CommandPalette

- purpose:
  - power-user action layer
- props/data needed:
  - commands, search index
- variants:
  - global, section-specific
- interactions:
  - keyboard search and execute
- animation/polish notes:
  - instant open feel
