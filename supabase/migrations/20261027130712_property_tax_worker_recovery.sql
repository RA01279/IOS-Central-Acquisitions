begin;
create or replace function public.claim_property_tax_job() returns setof public.property_tax_jobs language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(2610261510);
 update public.property_tax_jobs set status='failed',lease=null,locked_until=null,updated_at=now(),outcome=coalesce(outcome,'{}'::jsonb)||jsonb_build_object('error','Worker lease expired after three controlled attempts; review and retry explicitly.') where status='processing' and locked_until<now() and attempts>=3;
 if exists(select 1 from public.property_tax_jobs where status='processing' and locked_until>now()) then return;end if;
 return query with candidate as (
 select subject_kind,subject_id from public.property_tax_jobs
 where ((status in ('queued','retry','needs_review') and next_attempt_at<=now()) or (status='processing' and locked_until<now())) and attempts<3
 order by next_attempt_at,subject_id for update skip locked limit 1
 ) update public.property_tax_jobs j set status='processing',attempts=j.attempts+1,locked_until=now()+interval '5 minutes',lease=gen_random_uuid(),updated_at=now()
 from candidate c where j.subject_kind=c.subject_kind and j.subject_id=c.subject_id returning j.*;
end $$;
revoke all on function public.claim_property_tax_job() from public,anon,authenticated;
grant execute on function public.claim_property_tax_job() to service_role;
update public.property_tax_jobs set next_attempt_at=now()+interval '30 days',attempts=0 where status='needs_review';
commit;
