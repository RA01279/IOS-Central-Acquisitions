-- 20261016130000_diligence.sql
--
-- PSA / due-diligence tracking and the deal document vault.
--
-- 1. deals.psa_effective_on: the date every diligence deadline counts from.
-- 2. deal_milestones: one row per deadline (deposit, title, survey, objections,
--    Phase I/II, zoning, estoppels, extension notice, DD expiry, closing).
--    Generated from a template (key set) or added by hand (key null). The
--    dd_end and closing rows are kept in step with deals.dd_end_on/closing_on.
-- 3. documents: more types for diligence files, the original file name, its
--    size, and an optional link to the milestone it satisfies.
begin;

alter table public.deals add column if not exists psa_effective_on date;

create table if not exists public.deal_milestones (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  key text,
  label text not null check (length(trim(label)) between 1 and 200),
  due_on date,
  done_on date,
  notes text check (notes is null or length(notes) <= 2000),
  sort_order integer not null default 0,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists deal_milestones_deal_key on public.deal_milestones(deal_id, key) where key is not null;
create index if not exists deal_milestones_open_due on public.deal_milestones(due_on) where done_on is null;
alter table public.deal_milestones enable row level security;
revoke all on public.deal_milestones from anon, authenticated;

do $$
declare c text;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.documents'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%doc_type%'
  loop
    execute format('alter table public.documents drop constraint %I', c);
  end loop;
end $$;
alter table public.documents add constraint documents_doc_type_check check (doc_type in (
  'mla', 'loi', 'psa', 'excel', 'om', 'other',
  'title', 'survey', 'phase1', 'phase2', 'zoning', 'estoppel', 'lease', 'insurance', 'appraisal', 'property_condition'
));
alter table public.documents add column if not exists file_name text;
alter table public.documents add column if not exists size_bytes bigint;
alter table public.documents add column if not exists milestone_id uuid references public.deal_milestones(id) on delete set null;

commit;
