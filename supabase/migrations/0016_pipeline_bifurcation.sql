-- 0016_pipeline_bifurcation.sql
-- The "Central Acquisitions" rework (boss feedback, Aug 2026). Five changes,
-- none of them destructive:
--
--   1. deals.asset_class -- IOS vs Industrial. The pipeline board is now two
--      pipelines you toggle between, so the split has to be an explicit,
--      editable field rather than something inferred at read time from
--      properties.asset_type. Backfilled from asset_type: 'ios' stays IOS,
--      everything else (industrial / flex / other / null) becomes Industrial,
--      except null which we treat as IOS -- this started life as an IOS shop
--      and an unclassified legacy row is an IOS row.
--   2. A 'closed' stage after Due Diligence, plus deals.closed_on so closings
--      can be counted inside a date range (last 7 days / MTD / YTD).
--   3. deals.dd_end_on + deals.closing_on -- the two dates the morning brief
--      warns on when either is within 7 days.
--   4. offers.source -- 'manual' (someone logged it) vs 'loi' (auto-captured
--      when an LOI was generated). The offer log shows provenance.
--   5. Leasing is gone from the UI but NOT from the database. Lease rows,
--      lease stages, and the deal_type column all survive untouched so the
--      decision is reversible; nothing below drops a lease anything.

-- 1. Asset class ----------------------------------------------------------
alter table deals
  add column if not exists asset_class text
    check (asset_class in ('ios', 'industrial'));

update deals d
   set asset_class = case
         when p.asset_type is null then 'ios'
         when p.asset_type = 'ios'  then 'ios'
         else 'industrial'
       end
  from properties p
 where p.id = d.property_id
   and d.asset_class is null;

-- Deals with no property row at all (shouldn't exist, but the FK is nullable).
update deals set asset_class = 'ios' where asset_class is null;

alter table deals alter column asset_class set default 'ios';
alter table deals alter column asset_class set not null;

-- 2 & 3. Closed stage, DD/closing/closed dates ----------------------------
alter table deals
  add column if not exists dd_end_on date,
  add column if not exists closing_on date,
  add column if not exists closed_on date;

alter table deals drop constraint if exists deals_stage_check;
alter table deals drop constraint if exists deals_stage_for_type;

alter table deals add constraint deals_stage_check check (
  stage in (
    -- acquisition pipeline
    'prospect', 'uw', 'offered', 'moving_to_psa', 'due_diligence', 'closed',
    -- leasing pipeline (retained: data only, no UI)
    'tour', 'proposal', 'negotiation', 'executed',
    -- shared terminal stage
    'archived'
  )
);

alter table deals add constraint deals_stage_for_type check (
  stage = 'archived'
  or (deal_type = 'acquisition'
      and stage in ('prospect', 'uw', 'offered', 'moving_to_psa', 'due_diligence', 'closed'))
  or (deal_type = 'lease'
      and stage in ('prospect', 'tour', 'proposal', 'negotiation', 'executed'))
);

-- 4. Offer provenance ------------------------------------------------------
alter table offers
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'loi'));

-- Lookup paths the new home screen, pipeline toggle, and brief actually use.
create index if not exists idx_deals_asset_class on deals(asset_class);
create index if not exists idx_deals_closed_on on deals(closed_on) where closed_on is not null;
create index if not exists idx_deals_dd_end on deals(dd_end_on) where dd_end_on is not null;
create index if not exists idx_deals_closing on deals(closing_on) where closing_on is not null;
create index if not exists idx_offers_offered_at on offers(offered_at desc);
