-- 20261020120000_lock_down_public_schema.sql
--
-- Hopper reads and writes every table on the server with the service role.
-- The anon key (shipped in the browser bundle) and signed-in sessions are used
-- only for auth and signed storage uploads -- never to query a table. So no
-- public table should be reachable by `anon` or `authenticated`, and every one
-- should have row-level security on.
--
-- Live already matched this for the older tables (RLS on, no policies), but
-- it was set by hand: a database rebuilt from these migrations (a branch, a
-- restore) would have left deals, properties, contacts, companies, comps,
-- tasks, documents, deal_events, activities, mla_data, uw_versions,
-- deal_contacts and comp_weight_config readable with the browser key. This
-- writes the rule down, for every table, and stops new tables and functions
-- from granting those roles access by default.
begin;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on table public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;

revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated;

-- New objects created by the migration role don't pick up those grants again.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

commit;
