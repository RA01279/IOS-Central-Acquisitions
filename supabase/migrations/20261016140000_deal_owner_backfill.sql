-- 20261016140000_deal_owner_backfill.sql
--
-- deals.assigned_analyst is now the deal owner (set on create, editable on the
-- Summary tab, "Owner" filter on the board, per-owner lines in the brief).
-- Existing unowned deals take their creator as owner when the creator is a
-- Hopper user; imported deals (created_by 'import:...') stay unassigned.
begin;
update public.deals d
set assigned_analyst = lower(d.created_by)
where d.assigned_analyst is null
  and d.deal_type = 'acquisition'
  and exists (select 1 from auth.users u where lower(u.email) = lower(d.created_by));
commit;
