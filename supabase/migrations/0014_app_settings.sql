-- 0014_app_settings.sql
-- Simple key/value settings the app reads at runtime (e.g. the reminder
-- webhook URL). Lets configuration land without a Vercel env edit + redeploy.

create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
