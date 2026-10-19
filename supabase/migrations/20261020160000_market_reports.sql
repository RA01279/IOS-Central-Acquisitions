-- 20261020160000_market_reports.sql
--
-- Broker market reports and the narratives Hopper writes from them.
--  * market_reports: one row per uploaded PDF (publisher, period, market,
--    submarkets, the broker's summary and takeaways, deals it names). The PDF
--    itself lives in storage under market-reports/.
--  * market_report_metrics: every statistic a report states -- vacancy,
--    absorption, rents... -- by submarket, size segment and basis (current
--    figure vs an average or prior period), so figures trend across quarters
--    and can be compared across brokers.
--  * market_narratives: the latest written narrative per market / submarket,
--    with the reports it cites.
-- agent_runs gains the two agents that read reports and write narratives.
begin;

create table if not exists public.market_reports (
  id uuid primary key default gen_random_uuid(),
  publisher text not null check (length(publisher) <= 120),
  title text check (title is null or length(title) <= 200),
  period text check (period is null or length(period) <= 40),
  period_end date,
  property_type text not null default 'industrial' check (property_type in ('industrial', 'ios', 'flex', 'office', 'other')),
  market text not null check (length(market) <= 80),
  submarkets text[] not null default '{}',
  geography text check (geography is null or length(geography) <= 300),
  summary text check (summary is null or length(summary) <= 2000),
  takeaways text[] not null default '{}',
  transactions jsonb not null default '[]',
  notes text[] not null default '{}',
  storage_path text not null,
  file_name text,
  pages integer,
  uploaded_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists market_reports_market on public.market_reports(market, period_end desc);

create table if not exists public.market_report_metrics (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.market_reports(id) on delete cascade,
  market text not null,
  submarket text,
  segment text,
  metric text not null,
  label text not null,
  value numeric not null,
  basis text not null default 'current' check (basis in ('current', 'average', 'prior_period', 'year_ago', 'forecast', 'peak')),
  period text,
  period_end date
);
create index if not exists market_report_metrics_area on public.market_report_metrics(market, submarket, metric);

create table if not exists public.market_narratives (
  id uuid primary key default gen_random_uuid(),
  market text not null,
  submarket text,
  headline text not null,
  narrative text not null,
  points jsonb not null default '[]',
  conflicts text[] not null default '{}',
  gaps text[] not null default '{}',
  -- [{ label: "R1", reportId, publisher, period }]
  sources jsonb not null default '[]',
  generated_by text not null,
  generated_at timestamptz not null default now()
);
create unique index if not exists market_narratives_area on public.market_narratives(lower(market), lower(coalesce(submarket, '')));

alter table public.market_reports enable row level security;
alter table public.market_report_metrics enable row level security;
alter table public.market_narratives enable row level security;
revoke all on public.market_reports, public.market_report_metrics, public.market_narratives from anon, authenticated;

alter table public.agent_runs drop constraint if exists agent_runs_agent_check;
alter table public.agent_runs add constraint agent_runs_agent_check check (agent in (
  'deal-intake', 'comp-analyst', 'pipeline-follow-up', 'site-research',
  'underwriting-review', 'investment-memo', 'ic-narrative', 'off-market-sourcing', 'deal-import',
  'comp-import', 'portfolio-import', 'market-report', 'market-narrative'
));

commit;
