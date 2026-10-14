-- 20261014120000_comp_email_attachments.sql
-- Comps > Select from Outlook reads the email's attachments, not just its body.
--
--   fetch_comps   a helper job: the email body plus its spreadsheet (.xlsx,
--                 .xlsm, .csv) and PDF attachments, uploaded to the owner's
--                 imports/ folder like New Deal > Import's OMs.
--   comp-import   an agent: read a PDF comp sheet and return comp rows for the
--                 intake review table. Like deal-import it only drafts; nothing
--                 is saved until a person reviews the rows.

begin;

alter table outlook_helper_jobs drop constraint if exists outlook_helper_jobs_kind_check;
alter table outlook_helper_jobs add constraint outlook_helper_jobs_kind_check
  check (kind in ('search', 'fetch', 'fetch_om', 'fetch_comps'));

alter table public.agent_runs drop constraint if exists agent_runs_agent_check;
alter table public.agent_runs add constraint agent_runs_agent_check check (agent in (
  'deal-intake', 'comp-analyst', 'pipeline-follow-up', 'site-research',
  'underwriting-review', 'investment-memo', 'ic-narrative', 'off-market-sourcing', 'deal-import',
  'comp-import'
));

commit;
