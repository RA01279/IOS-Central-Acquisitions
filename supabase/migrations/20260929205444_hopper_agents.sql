alter table public.outlook_helpers add column if not exists agents_last_seen_at timestamptz;
create table public.agent_runs (
 id uuid primary key default gen_random_uuid(),
 owner_email text not null,
 helper_id uuid references public.outlook_helpers(id) on delete set null,
 agent text not null check(agent in ('deal-intake','comp-analyst','pipeline-follow-up','site-research','underwriting-review','investment-memo')),
 deal_id uuid references public.deals(id) on delete set null,
 status text not null default 'queued' check(status in ('queued','processing','completed','failed')),
 prompt text not null,
 sources jsonb not null default '[]',
 result jsonb,
 error text,
 created_at timestamptz not null default now(),
 started_at timestamptz,
 finished_at timestamptz,
 usage jsonb,
 model text,
 reviewed_at timestamptz
);
create index agent_runs_owner_created on public.agent_runs(owner_email,created_at desc);
create unique index agent_runs_one_active on public.agent_runs(owner_email) where status in ('queued','processing');
alter table public.agent_runs enable row level security;
revoke all on public.agent_runs from anon,authenticated;
grant all on public.agent_runs to service_role;
comment on table public.agent_runs is 'Owner-scoped draft reports. Server routes enforce owner_email on every access. No direct browser grants.';
