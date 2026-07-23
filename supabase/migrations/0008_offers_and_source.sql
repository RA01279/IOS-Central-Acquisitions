-- 0008_offers_and_source.sql
-- Brings Hopper up to parity with the team's 2026 Pipeline Tracker (IOS tab):
--   * offers        -- one row per offer made on a deal. The tracker's
--                      "Last Offer Date/Price" and "Times We've Offered"
--                      columns become a real negotiation history.
--   * deals.marketing_status  -- Marketed vs Off-Market
--   * deals.acquisition_type  -- standard / SLB / unsolicited
--   * properties.city         -- tracker tracks City separate from submarket
-- Land-basis PSF (price / lot SF) is computed in the UI, not stored.

create table if not exists offers (
  id uuid primary key default uuid_generate_v4(),
  deal_id uuid not null references deals(id) on delete cascade,
  offered_at date,
  price numeric,
  notes text,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_offers_deal on offers(deal_id);

alter table deals
  add column if not exists marketing_status text
    check (marketing_status in ('marketed', 'off_market')),
  add column if not exists acquisition_type text
    check (acquisition_type in ('standard', 'slb', 'unsolicited'));

alter table properties
  add column if not exists city text;
