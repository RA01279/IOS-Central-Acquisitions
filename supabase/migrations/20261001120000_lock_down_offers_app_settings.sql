begin;

-- offers and app_settings were the last public tables with RLS off, so the
-- anonymous key shipped to every browser could read and write them through the
-- Data API: offer prices, and app_settings.export_token. Everything that uses
-- them goes through the server-only service client, which bypasses RLS, so no
-- policies are added: with RLS on and no policy, anon and authenticated get
-- nothing. Same pattern as assets (20260914220504).
alter table public.offers enable row level security;
alter table public.app_settings enable row level security;

-- Belt and braces: the grants are what let RLS-off tables leak, and nothing
-- outside the service role needs them.
revoke all on table public.offers from anon, authenticated;
revoke all on table public.app_settings from anon, authenticated;

-- Only app/search/page.tsx calls this, through the service client. It is
-- security invoker, so RLS already empties it for anon; this removes the
-- endpoint rather than relying on that.
revoke execute on function public.global_search(text) from public, anon, authenticated;

commit;
