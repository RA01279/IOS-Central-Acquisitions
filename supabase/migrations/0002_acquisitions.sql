-- 0002_acquisitions.sql
-- Tables specific to the acquisitions tracking workflow.

create table if not exists mla_data (
  id uuid primary key default uuid_generate_v4(),
  deal_id uuid not null references deals(id) on delete cascade,
  asking_rent numeric,
  opex numeric,
  other_assumptions jsonb default '{}'::jsonb,
  provided_by text,
  provided_at timestamptz,
  created_at timestamptz not null default now()
);

-- Append-only underwriting version history. Never update a row — insert a
-- new one. "Current" version for a deal is the highest version_number.
create table if not exists uw_versions (
  id uuid primary key default uuid_generate_v4(),
  deal_id uuid not null references deals(id) on delete cascade,
  version_number int not null,
  excel_document_id uuid,
  returns_summary jsonb default '{}'::jsonb,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (deal_id, version_number)
);

-- IOS lease comps database. v1 scoring (see lib/comps.ts) sorts by
-- recency + distance only — no stored weight config used yet, but the
-- stub table below leaves room to add real weighting later without a
-- schema change.
create table if not exists comps (
  id uuid primary key default uuid_generate_v4(),
  address text not null,
  market text,
  lot_sf numeric,
  building_sf numeric,
  rent numeric not null,
  date_commenced date not null,
  latitude numeric,
  longitude numeric,
  created_at timestamptz not null default now()
);

create table if not exists comp_weight_config (
  id uuid primary key default uuid_generate_v4(),
  label text not null,
  location_weight numeric not null default 0,
  sf_weight numeric not null default 0,
  recency_weight numeric not null default 0,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Every MLA doc, LOI, PSA, and underwriting Excel tied to a deal.
create table if not exists documents (
  id uuid primary key default uuid_generate_v4(),
  deal_id uuid not null references deals(id) on delete cascade,
  doc_type text not null check (doc_type in ('mla', 'loi', 'psa', 'excel', 'other')),
  storage_path text not null,
  uploaded_by text not null,
  uploaded_at timestamptz not null default now()
);

-- Audit trail: stage changes, notifications sent, manual confirmations.
create table if not exists deal_events (
  id uuid primary key default uuid_generate_v4(),
  deal_id uuid not null references deals(id) on delete cascade,
  event_type text not null,
  detail jsonb default '{}'::jsonb,
  actor text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_mla_deal on mla_data(deal_id);
create index if not exists idx_uw_versions_deal on uw_versions(deal_id);
create index if not exists idx_documents_deal on documents(deal_id);
create index if not exists idx_deal_events_deal on deal_events(deal_id);
create index if not exists idx_comps_market on comps(market);
