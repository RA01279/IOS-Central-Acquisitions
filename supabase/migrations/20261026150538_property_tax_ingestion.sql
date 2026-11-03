begin;
create table public.property_tax_jobs (
 subject_kind text not null check(subject_kind in ('property','asset')),
 subject_id uuid not null,
 status text not null default 'queued' check(status in ('queued','processing','needs_review','retry','failed')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 locked_until timestamptz,
 lease uuid,
 updated_at timestamptz not null default now(),
 outcome jsonb,
 primary key(subject_kind,subject_id)
);
create index property_tax_jobs_pending on public.property_tax_jobs(next_attempt_at) where status in ('queued','retry');
create table public.property_tax_subjects (
 subject_kind text not null check(subject_kind in ('property','asset')),
 subject_id uuid not null,
 revision integer not null default 1,
 state jsonb not null,
 updated_at timestamptz not null default now(),
 primary key(subject_kind,subject_id)
);
create table public.property_tax_subject_history (
 id bigint generated always as identity primary key,
 subject_kind text not null,
 subject_id uuid not null,
 revision integer not null,
 state jsonb not null,
 created_at timestamptz not null default now(),
 unique(subject_kind,subject_id,revision)
);
create table public.property_tax_jurisdictions (
 jurisdiction text primary key,
 discovery jsonb not null,
 status text not null default 'investigation_open' check(status in ('investigation_open','adapter_available','assisted_required','verified')),
 review_note text not null default '',
 first_seen_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.property_tax_jobs enable row level security;
alter table public.property_tax_subjects enable row level security;
alter table public.property_tax_subject_history enable row level security;
alter table public.property_tax_jurisdictions enable row level security;
revoke all on public.property_tax_jobs,public.property_tax_subjects,public.property_tax_subject_history,public.property_tax_jurisdictions from public,anon,authenticated;
grant select,insert,update on public.property_tax_jobs,public.property_tax_subjects,public.property_tax_jurisdictions to service_role;
grant select,insert on public.property_tax_subject_history to service_role;
grant usage,select on sequence public.property_tax_subject_history_id_seq to service_role;

-- Trigger is fixed to NEW.id and its source relation; no caller-provided SQL or
-- target. Definer is required so ordinary property writes can enqueue work while
-- the queue itself remains inaccessible to browser roles.
create function public.enqueue_property_tax_subject() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 kind:=case when TG_TABLE_NAME='assets' then 'asset' else 'property' end;
 insert into public.property_tax_jobs(subject_kind,subject_id) values(kind,NEW.id)
 on conflict(subject_kind,subject_id) do update set status='queued',attempts=0,next_attempt_at=now(),locked_until=null,lease=null,updated_at=now();
 return NEW;
end $$;
revoke all on function public.enqueue_property_tax_subject() from public,anon,authenticated;
create trigger property_tax_intake after insert or update of address,city,latitude,longitude,geocode_precision on public.properties for each row execute function public.enqueue_property_tax_subject();
create trigger asset_tax_intake after insert or update of address,city,state,latitude,longitude,geocode_precision on public.assets for each row execute function public.enqueue_property_tax_subject();

create function public.claim_property_tax_job() returns setof public.property_tax_jobs language plpgsql security invoker set search_path='' as $$
begin
 -- Serialize claims and allow one live worker globally, limiting collector load.
 perform pg_advisory_xact_lock(2610261510);
 if exists(select 1 from public.property_tax_jobs where status='processing' and locked_until>now()) then return; end if;
 return query with candidate as (
 select subject_kind,subject_id from public.property_tax_jobs
 where ((status in ('queued','retry') and next_attempt_at<=now()) or (status='processing' and locked_until<now())) and attempts<3
 order by next_attempt_at,subject_id for update skip locked limit 1
 ) update public.property_tax_jobs j set status='processing',attempts=j.attempts+1,locked_until=now()+interval '5 minutes',lease=gen_random_uuid(),updated_at=now()
 from candidate c where j.subject_kind=c.subject_kind and j.subject_id=c.subject_id returning j.*;
end $$;
revoke all on function public.claim_property_tax_job() from public,anon,authenticated;
grant execute on function public.claim_property_tax_job() to service_role;

create function public.save_property_tax_subject(p_kind text,p_id uuid,p_expected integer,p_state jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare rev integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_kind||':'||p_id::text,0));
 select revision into rev from public.property_tax_subjects where subject_kind=p_kind and subject_id=p_id for update;
 rev:=coalesce(rev,0);
 if rev<>p_expected then raise exception 'Tax subject changed; retry from saved state' using errcode='40001';end if;
 if p_state->>'version' is distinct from '1' or octet_length(p_state::text)>1500000 then raise exception 'Invalid tax state';end if;
 if exists(select 1 from public.property_tax_subjects s,lateral jsonb_array_elements(s.state->'sources') old where s.subject_kind=p_kind and s.subject_id=p_id and not exists(select 1 from jsonb_array_elements(p_state->'sources') n where n=old)) then raise exception 'Original evidence must be retained';end if;
 insert into public.property_tax_subjects(subject_kind,subject_id,revision,state) values(p_kind,p_id,rev+1,p_state)
 on conflict(subject_kind,subject_id) do update set revision=excluded.revision,state=excluded.state,updated_at=now();
 insert into public.property_tax_subject_history(subject_kind,subject_id,revision,state) values(p_kind,p_id,rev+1,p_state);
 return rev+1;
end $$;
revoke all on function public.save_property_tax_subject(text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_property_tax_subject(text,uuid,integer,jsonb) to service_role;
-- Backfill current subjects. Archived deals remain visible in the audit matrix;
-- they are not repeatedly scheduled as active research.
insert into public.property_tax_jobs(subject_kind,subject_id)
 select distinct 'property',property_id from public.deals where stage<>'archived' and property_id is not null on conflict do nothing;
insert into public.property_tax_jobs(subject_kind,subject_id)
 select 'asset',id from public.assets where status<>'sold' on conflict do nothing;
commit;
