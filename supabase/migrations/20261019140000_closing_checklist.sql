-- 20261019140000_closing_checklist.sql
--
-- The closing checklist counsel circulates with a PSA: every document and
-- delivery, who prepares it, who signs, and where it stands. Imported from
-- the "Critical Dates and Closing Checklist" Word file (lib/checklist-docx.ts)
-- or added by hand on the Diligence tab. documents.doc_type gains 'checklist'
-- for the imported file itself.
begin;
create table if not exists public.deal_checklist_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  section text not null default 'General' check (length(section) <= 120),
  item text not null check (length(trim(item)) between 1 and 300),
  responsible text check (responsible is null or length(responsible) <= 120),
  signatories text check (signatories is null or length(signatories) <= 120),
  status text check (status is null or length(status) <= 200),
  done boolean not null default false,
  notes text check (notes is null or length(notes) <= 2000),
  document_id uuid references public.documents(id) on delete set null,
  sort_order integer not null default 0,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists deal_checklist_items_unique on public.deal_checklist_items(deal_id, section, item);
alter table public.deal_checklist_items enable row level security;
revoke all on public.deal_checklist_items from anon, authenticated;

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
  'title', 'survey', 'phase1', 'phase2', 'zoning', 'estoppel', 'lease', 'insurance', 'appraisal', 'property_condition',
  'checklist'
));
commit;
