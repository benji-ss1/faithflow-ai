-- OpenFlow conversation history (Increment A2) — apply to the PresentFlow prod
-- Supabase project (paste into the SQL editor, or run via CLI). Additive + safe:
-- creates one new table; touches no existing data. Until this runs, OpenFlow
-- persistence is fail-soft (no history; chat still works).
--
-- RLS: prod has RLS enabled on every public table with an owner-role bypass
-- model (see the 2026-08-18 lockdown). The app connects as the owner/service
-- role, which bypasses RLS. We ENABLE RLS here with NO policies so anon/
-- authenticated roles get zero rows and Supabase's advisor stays clean, exactly
-- like the other locked-down tables.

create table if not exists public.openflow_conversations (
  id                  uuid primary key default gen_random_uuid(),
  church_id           uuid not null references public.churches(id),
  created_by_user_id  uuid,
  title               text not null default 'New conversation',
  mode                text not null default 'chat',
  messages            jsonb not null default '[]'::jsonb,
  pinned              boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_openflow_conv_church_updated
  on public.openflow_conversations (church_id, updated_at);

alter table public.openflow_conversations enable row level security;
-- No policies on purpose: owner/service role bypasses RLS; anon/authenticated
-- get nothing. Matches the platform lockdown posture.
