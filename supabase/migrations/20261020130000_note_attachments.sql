-- 20261020130000_note_attachments.sql
--
-- Files attached to a note or site visit on Notes & History. They are
-- ordinary deal documents (so they show in the Diligence tab's vault too),
-- linked back to the note they came with.
alter table public.documents add column if not exists activity_id uuid references public.activities(id) on delete set null;
create index if not exists documents_activity on public.documents(activity_id) where activity_id is not null;
