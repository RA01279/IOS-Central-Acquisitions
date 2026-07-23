-- 0006_due_diligence_stage.sql
-- Adds a Due Diligence stage to the acquisitions pipeline, after Moving to PSA:
--   UW -> UW v1 -> Offered -> Moving to PSA -> Due Diligence
-- A deal enters Due Diligence once the PSA is executed. Rebuilds the two stage
-- constraints (drop-then-add so this is safe to re-run) to include the new stage
-- for acquisition deals only.

alter table deals drop constraint if exists deals_stage_check;
alter table deals drop constraint if exists deals_stage_for_type;

alter table deals add constraint deals_stage_check check (
  stage in (
    -- acquisition pipeline
    'uw', 'uw_v1', 'offered', 'moving_to_psa', 'due_diligence',
    -- leasing pipeline
    'prospect', 'tour', 'proposal', 'negotiation', 'executed',
    -- shared terminal stage
    'archived'
  )
);

alter table deals add constraint deals_stage_for_type check (
  stage = 'archived'
  or (deal_type = 'acquisition' and stage in ('uw', 'uw_v1', 'offered', 'moving_to_psa', 'due_diligence'))
  or (deal_type = 'lease' and stage in ('prospect', 'tour', 'proposal', 'negotiation', 'executed'))
);
