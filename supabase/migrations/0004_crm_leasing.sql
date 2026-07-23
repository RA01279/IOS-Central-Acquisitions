-- 0004_crm_leasing.sql
-- Turns Hopper from an acquisitions-only tracker into a CRM covering both
-- acquisitions and leasing. Three things happen here:
--   1. The deals.stage constraint learns the leasing pipeline, and becomes
--      deal_type-aware so acquisition stages can't leak onto lease deals
--      (or vice versa).
--   2. deal_contacts lets a deal carry the people involved (tenant, brokers,
--      seller, etc.) -- the relationship backbone of the CRM.
--   3. activities + tasks give us relationship tracking and follow-ups,
--      the things a tracker has but a CRM needs.
-- Nothing here drops data. Existing acquisition deals keep working unchanged.

-- 1. Leasing stages -------------------------------------------------------
-- The original inline constraint (0001) was auto-named deals_stage_check and
-- only allowed acquisition stages. Replace it with two constraints: one that
-- lists every valid stage, and one that ties each stage to the right pipeline.

alter table deals drop constraint if exists deals_stage_check;

alter table deals
  add constraint deals_stage_check check (
    stage in (
      -- acquisition pipeline
      'uw', 'uw_v1', 'offered', 'moving_to_psa',
      -- leasing pipeline
      'prospect', 'tour', 'proposal', 'negotiation', 'executed',
      -- shared terminal stage
      'archived'
    )
  );

-- A stage is valid only for its own pipeline. 'archived' is shared (a deal can
-- die from any stage). Lease deals are created at 'prospect', not the 'uw'
-- default -- createDeal() sets the right opening stage per deal_type.
alter table deals
  add constraint deals_stage_for_type check (
    stage = 'archived'
    or (deal_type = 'acquisition' and stage in ('uw', 'uw_v1', 'offered', 'moving_to_psa'))
    or (deal_type = 'lease' and stage in ('prospect', 'tour', 'proposal', 'negotiation', 'executed'))
  );

-- 2. deal_contacts --------------------------------------------------------
-- Many-to-many between deals and contacts, with the role that contact plays
-- on this particular deal. The same person can be a tenant contact on one
-- deal and a broker on another, so role lives on the link, not the contact.
create table if not exists deal_contacts (
  id uuid primary key default uuid_generate_v4(),
  deal_id uuid not null references deals(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  role text not null check (role in (
    'seller', 'buyer', 'seller_broker', 'buyer_broker',   -- acquisition-side
    'tenant', 'landlord', 'tenant_broker', 'listing_broker', -- leasing-side
    'other'
  )),
  created_at timestamptz not null default now(),
  unique (deal_id, contact_id, role)
);

-- 3. activities -----------------------------------------------------------
-- User-facing relationship log: calls, emails, tours, meetings, and free
-- notes. Distinct from deal_events, which is a system/audit trail. An activity
-- can hang off any combination of contact / company / deal / property -- most
-- log against a contact, often also a deal.
create table if not exists activities (
  id uuid primary key default uuid_generate_v4(),
  activity_type text not null check (activity_type in ('call', 'email', 'meeting', 'tour', 'note', 'other')),
  subject text,
  body text,
  occurred_at timestamptz not null default now(),
  contact_id uuid references contacts(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  deal_id uuid references deals(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  created_by text not null,
  created_at timestamptz not null default now()
);

-- 4. tasks ----------------------------------------------------------------
-- Follow-ups and reminders. Like activities, a task can be tied to a contact,
-- company, and/or deal. Kept deliberately simple: open or done, one due date,
-- one assignee (matched to a login email).
create table if not exists tasks (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  notes text,
  due_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  assigned_to text,
  contact_id uuid references contacts(id) on delete set null,
  company_id uuid references companies(id) on delete set null,
  deal_id uuid references deals(id) on delete cascade,
  created_by text not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Indexes on the lookup paths the CRM screens actually use.
create index if not exists idx_deal_contacts_deal on deal_contacts(deal_id);
create index if not exists idx_deal_contacts_contact on deal_contacts(contact_id);
create index if not exists idx_activities_contact on activities(contact_id);
create index if not exists idx_activities_deal on activities(deal_id);
create index if not exists idx_activities_company on activities(company_id);
create index if not exists idx_activities_occurred on activities(occurred_at desc);
create index if not exists idx_tasks_assigned_open on tasks(assigned_to) where status = 'open';
create index if not exists idx_tasks_deal on tasks(deal_id);
create index if not exists idx_tasks_contact on tasks(contact_id);
create index if not exists idx_deals_type on deals(deal_type);
