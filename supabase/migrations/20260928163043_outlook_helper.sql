create table public.outlook_helpers (
 id uuid primary key default gen_random_uuid(),
 owner_email text not null unique,
 token_hash text not null unique,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '90 days'),
 last_seen_at timestamptz,
 mailbox_email text
);
create table public.outlook_helper_jobs (
 id uuid primary key default gen_random_uuid(),
 helper_id uuid not null references public.outlook_helpers(id) on delete cascade,
 owner_email text not null,
 kind text not null check (kind in ('search','fetch')),
 input jsonb not null,
 status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
 result jsonb,
 error text,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '15 minutes')
);
create index outlook_helper_jobs_claim_idx on public.outlook_helper_jobs(helper_id, status, created_at);
alter table public.outlook_helpers enable row level security;
alter table public.outlook_helper_jobs enable row level security;
revoke all on public.outlook_helpers, public.outlook_helper_jobs from anon, authenticated;
grant all on public.outlook_helpers, public.outlook_helper_jobs to service_role;
comment on table public.outlook_helpers is 'Owner-scoped local Outlook helpers. Tokens hashed; server-only access.';
comment on table public.outlook_helper_jobs is 'Short-lived email search/read results, owner-scoped in server routes. Expired payloads deleted by helper polling and user requests.';

create unique index outlook_helper_one_active_job on public.outlook_helper_jobs(helper_id) where status in ('queued', 'processing');
create index outlook_helper_jobs_expiry_idx on public.outlook_helper_jobs(expires_at);
