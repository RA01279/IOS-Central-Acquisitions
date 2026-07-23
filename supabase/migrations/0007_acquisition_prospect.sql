-- 0007_acquisition_prospect.sql
-- Acquisitions get a Prospect stage in front of UW, and UW v1 is retired:
--   Prospect -> UW -> Offered -> Moving to PSA -> Due Diligence
-- A deal enters at Prospect and moves to UW only when an underwriting model
-- is uploaded (enforced by the versions route, which advances prospect->uw).
-- 'prospect' is now valid for BOTH pipelines -- it was already the leasing
-- opening stage.
--
-- Order matters: drop constraints, migrate legacy rows, then re-add.

alter table deals drop constraint if exists deals_stage_check;
alter table deals drop constraint if exists deals_stage_for_type;

-- Retire uw_v1: any acquisition sitting there has a model uploaded, which in
-- the new scheme means it's in UW. Archived deals keep uw_v1 in death_stage
-- for history -- that column isn't constrained.
update deals set stage = 'uw' where deal_type = 'acquisition' and stage = 'uw_v1';

alter table deals add constraint deals_stage_check check (
  stage in (
    -- acquisition pipeline
    'prospect', 'uw', 'offered', 'moving_to_psa', 'due_diligence',
    -- leasing pipeline (also starts at prospect)
    'tour', 'proposal', 'negotiation', 'executed',
    -- shared terminal stage
    'archived'
  )
);

alter table deals add constraint deals_stage_for_type check (
  stage = 'archived'
  or (deal_type = 'acquisition' and stage in ('prospect', 'uw', 'offered', 'moving_to_psa', 'due_diligence'))
  or (deal_type = 'lease' and stage in ('prospect', 'tour', 'proposal', 'negotiation', 'executed'))
);
