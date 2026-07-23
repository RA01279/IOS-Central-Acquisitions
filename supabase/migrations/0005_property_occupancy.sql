-- 0005_property_occupancy.sql
-- Capture the building's state at acquisition on the property record:
--   * occupancy_status -- vacant or occupied
--   * walt_years        -- weighted average lease term remaining (years),
--                          only meaningful when occupied
--   * tenancy           -- single- vs multi-tenant
-- These are collected on the new-acquisition-deal intake form. All nullable
-- so existing properties (and leasing intake, which doesn't ask) stay valid.

alter table properties
  add column if not exists occupancy_status text
    check (occupancy_status in ('vacant', 'occupied')),
  add column if not exists walt_years numeric,
  add column if not exists tenancy text
    check (tenancy in ('single_tenant', 'multi_tenant'));
