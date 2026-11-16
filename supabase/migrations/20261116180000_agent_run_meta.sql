-- 20261116180000_agent_run_meta.sql
--
-- What an agent run is FOR, beyond its prompt -- for a market-report read, the
-- uploaded PDF it is reading ({ path, fileName, pages }). Lets the Market page
-- list reads that finished while nobody was waiting on the upload box ("read,
-- waiting for your review") and save them against the right PDF.
begin;
alter table public.agent_runs add column if not exists meta jsonb;

-- Reads from the last 30 days that ran before this column existed: link each
-- to the market-report PDF uploaded just before it (the upload box uploads,
-- then queues the read, within seconds).
with matched as (
  select r.id,
    (select so.name from storage.objects so
      where so.bucket_id = 'documents' and so.name like 'market-reports/%'
        and so.created_at between r.created_at - interval '2 minutes' and r.created_at
      order by so.created_at desc limit 1) as path,
    substring(r.prompt from 'MARKET REPORT \(([^)]*), \d+ pages\)') as file_name,
    nullif(substring(r.prompt from 'MARKET REPORT \([^)]*, (\d+) pages\)'), '')::int as pages
  from public.agent_runs r
  where r.agent = 'market-report' and r.meta is null and r.created_at > now() - interval '30 days'
)
update public.agent_runs r
   set meta = jsonb_build_object('path', m.path, 'fileName', coalesce(m.file_name, split_part(m.path, '/', 2)), 'pages', m.pages)
  from matched m
 where r.id = m.id and m.path is not null;
commit;
