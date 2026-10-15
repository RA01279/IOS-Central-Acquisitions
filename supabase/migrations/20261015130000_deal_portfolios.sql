-- 20261015130000_deal_portfolios.sql
-- A national portfolio offered as one package. Each site is still its own
-- deal -- its own pin, comps, site checks and stage -- and carries
-- deal_portfolio_id so it is flagged as part of the package and the package
-- can be viewed as a whole.
--
-- Named deal_portfolios, not portfolios: "portfolio" already means Dalfen's
-- owned assets (the assets table, deals.portfolio_asset_id).
--
--   portfolio-import   an agent: read a portfolio OM's property schedule into
--                      one row per site. Like deal-import it only drafts.

begin;

create table if not exists public.deal_portfolios (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  seller_broker text,
  current_owner text,
  -- The OM, filed once here; each site's deal gets a documents row for it.
  om_path text,
  om_name text,
  notes text[] not null default '{}',
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.deals
  add column if not exists deal_portfolio_id uuid references public.deal_portfolios(id) on delete set null;
create index if not exists deals_deal_portfolio_id_idx on public.deals (deal_portfolio_id) where deal_portfolio_id is not null;

-- Server-only, like offers: the app reads and writes with the service role.
alter table public.deal_portfolios enable row level security;
revoke all on table public.deal_portfolios from anon, authenticated;

alter table public.agent_runs drop constraint if exists agent_runs_agent_check;
alter table public.agent_runs add constraint agent_runs_agent_check check (agent in (
  'deal-intake', 'comp-analyst', 'pipeline-follow-up', 'site-research',
  'underwriting-review', 'investment-memo', 'ic-narrative', 'off-market-sourcing', 'deal-import',
  'comp-import', 'portfolio-import'
));

commit;
