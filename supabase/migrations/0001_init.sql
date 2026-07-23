-- 0001_init.sql
-- Core shared tables. These are the tables RIDGE Intel's analysis tools
-- (SCOUT, NAPKIN, WATERFALL) also read/write against — this migration
-- assumes it's running against that same Supabase/Postgres project.
-- If starting fresh (no RIDGE Intel yet), this still stands alone fine.

create extension if not exists "uuid-ossp";

create table if not exists companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  company_type text not null check (company_type in ('landlord', 'tenant', 'broker', 'jv_partner', 'other')),
  created_at timestamptz not null default now()
);

create table if not exists contacts (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid references companies(id) on delete set null,
  name text not null,
  email text,
  phone text,
  title text,
  created_at timestamptz not null default now()
);

create table if not exists properties (
  id uuid primary key default uuid_generate_v4(),
  address text not null,
  market text,
  submarket text,
  asset_type text check (asset_type in ('ios', 'industrial', 'flex', 'other')),
  lot_sf numeric,
  building_sf numeric,
  latitude numeric,
  longitude numeric,
  created_at timestamptz not null default now()
);

-- Owned jointly by RIDGE Intel (analysis fields) and this CRM (pipeline fields).
-- deal_type distinguishes acquisitions from leasing rather than splitting tables,
-- since both share the same pipeline mechanics.
create table if not exists deals (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid references properties(id) on delete set null,
  deal_type text not null check (deal_type in ('acquisition', 'lease')),
  stage text not null default 'uw' check (
    stage in ('uw', 'uw_v1', 'offered', 'moving_to_psa', 'archived')
  ),
  source_broker_id uuid references companies(id),
  mla_status text not null default 'pending' check (
    mla_status in ('pending', 'requested', 'provided', 'assumed')
  ),
  death_stage text,
  death_reason text,
  restorable boolean not null default true,
  assigned_analyst text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_deals_stage on deals(stage);
create index if not exists idx_deals_property on deals(property_id);
create index if not exists idx_properties_address on properties using gin (to_tsvector('english', address));
