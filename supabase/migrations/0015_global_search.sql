-- 0015_global_search.sql
-- Global search across deals, contacts, companies, notes, and tasks.
-- pg_trgm gives fuzzy matching, which matters here: the imported tracker
-- data contains real typos ("11625 N Housron") that exact matching would
-- never surface. One RPC does all the querying so the app makes one call.

create extension if not exists pg_trgm;

create index if not exists idx_trgm_property_address on properties using gin (address gin_trgm_ops);
create index if not exists idx_trgm_contact_name on contacts using gin (name gin_trgm_ops);
create index if not exists idx_trgm_company_name on companies using gin (name gin_trgm_ops);

create or replace function global_search(q text)
returns jsonb
language sql
stable
as $$
select jsonb_build_object(
  'deals', (
    select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select d.id, d.deal_type, d.stage, d.death_reason,
             p.address, p.city, p.market,
             greatest(similarity(coalesce(p.address, ''), q),
                      similarity(coalesce(p.city, ''), q)) as score
      from deals d
      left join properties p on p.id = d.property_id
      where p.address ilike '%' || q || '%'
         or p.city ilike '%' || q || '%'
         or p.market ilike '%' || q || '%'
         or p.submarket ilike '%' || q || '%'
         or coalesce(d.death_reason, '') ilike '%' || q || '%'
         or similarity(coalesce(p.address, ''), q) > 0.3
         or similarity(coalesce(p.city, ''), q) > 0.4
      order by score desc, d.created_at desc
      limit 25
    ) t
  ),
  'contacts', (
    select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select c.id, c.name, c.title, c.email, c.phone, c.contact_type,
             co.name as company
      from contacts c
      left join companies co on co.id = c.company_id
      where c.name ilike '%' || q || '%'
         or c.email ilike '%' || q || '%'
         or co.name ilike '%' || q || '%'
         or similarity(c.name, q) > 0.3
      order by similarity(c.name, q) desc
      limit 15
    ) t
  ),
  'companies', (
    select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select co.id, co.name, co.company_type
      from companies co
      where co.name ilike '%' || q || '%'
         or similarity(co.name, q) > 0.3
      order by similarity(co.name, q) desc
      limit 10
    ) t
  ),
  'notes', (
    select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select a.id, a.activity_type, a.subject, left(coalesce(a.body, ''), 160) as snippet,
             a.occurred_at, a.deal_id, a.contact_id,
             p.address as deal_address
      from activities a
      left join deals d on d.id = a.deal_id
      left join properties p on p.id = d.property_id
      where a.subject ilike '%' || q || '%'
         or a.body ilike '%' || q || '%'
      order by a.occurred_at desc
      limit 15
    ) t
  ),
  'tasks', (
    select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select tk.id, tk.title, tk.due_date, tk.status, tk.assigned_to, tk.deal_id
      from tasks tk
      where tk.title ilike '%' || q || '%'
         or tk.notes ilike '%' || q || '%'
      order by tk.status asc, tk.due_date asc nulls last
      limit 10
    ) t
  )
);
$$;
