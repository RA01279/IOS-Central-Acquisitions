-- 0017_search_ranking.sql
-- Global search v2. Three things were wrong with v1 (0015):
--
--   1. Ranking. `score` was similarity() on address/city only, so a deal that
--      matched on market, submarket, or death_reason scored 0.0 and fell to
--      the bottom behind fuzzy near-misses. Exact substring hits now outrank
--      trigram hits, and active deals outrank archived ones -- when you search
--      "Decker" you want the live deal, not the 2024 corpse.
--   2. Partial-word matching. similarity() compares whole strings, so
--      "Decker" against "7411 Decker Dr" scores badly (short query, long
--      target). word_similarity(q, text) scores the query against the most
--      similar *extent* of the target, which is what a search box wants.
--      Both are indexed by the same gin_trgm_ops indexes from 0015.
--   3. Leasing. Lease deals (and notes/tasks hanging off them) still came back
--      and linked to /leasing/*, which no longer exists. Filtered out here
--      rather than in the page, so every caller gets the same result set.
--
-- Contacts also match on phone now -- "search everything" failed on a phone
-- number, which is exactly what you have in hand when a call comes in.

create or replace function global_search(q text)
returns jsonb
language sql
stable
as $$
select jsonb_build_object(
  'deals', (
    select coalesce(jsonb_agg(t order by t.score desc, t.created_at desc), '[]'::jsonb) from (
      select d.id, d.deal_type, d.stage, d.death_reason, d.asset_class,
             d.created_at, d.closed_on,
             p.address, p.city, p.market,
             -- Exact-substring hit on the address is worth more than any
             -- fuzzy score; being live is worth more than being a good match.
             ( case when p.address ilike '%' || q || '%' then 1.0 else 0.0 end
             + greatest(similarity(coalesce(p.address, ''), q),
                        word_similarity(q, coalesce(p.address, '')))
             + case when p.city ilike '%' || q || '%'
                      or p.market ilike '%' || q || '%'
                      or p.submarket ilike '%' || q || '%' then 0.3 else 0.0 end
             + case when coalesce(d.death_reason, '') ilike '%' || q || '%' then 0.2 else 0.0 end
             + case when d.stage <> 'archived' then 0.5 else 0.0 end
             ) as score
      from deals d
      left join properties p on p.id = d.property_id
      where d.deal_type <> 'lease'
        and ( p.address ilike '%' || q || '%'
           or p.city ilike '%' || q || '%'
           or p.market ilike '%' || q || '%'
           or p.submarket ilike '%' || q || '%'
           or coalesce(d.death_reason, '') ilike '%' || q || '%'
           or similarity(coalesce(p.address, ''), q) > 0.3
           or word_similarity(q, coalesce(p.address, '')) > 0.5
           or similarity(coalesce(p.city, ''), q) > 0.4 )
      -- Order inside the subquery too: LIMIT without it would pick an
      -- arbitrary 25 rows and then rank only those.
      order by score desc, d.created_at desc
      limit 25
    ) t
  ),
  'contacts', (
    select coalesce(jsonb_agg(t order by t.score desc, t.name), '[]'::jsonb) from (
      select c.id, c.name, c.title, c.email, c.phone, c.contact_type,
             co.name as company,
             ( case when c.name ilike '%' || q || '%' then 1.0 else 0.0 end
             + greatest(similarity(c.name, q), word_similarity(q, c.name))
             + case when coalesce(c.email, '') ilike '%' || q || '%' then 0.5 else 0.0 end
             + case when coalesce(co.name, '') ilike '%' || q || '%' then 0.4 else 0.0 end
             -- Digits only, so "5085551212" finds "(508) 555-1212".
             + case when regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') <> ''
                     and regexp_replace(q, '\D', '', 'g') <> ''
                     and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')
                         like '%' || regexp_replace(q, '\D', '', 'g') || '%'
                    then 0.6 else 0.0 end
             ) as score
      from contacts c
      left join companies co on co.id = c.company_id
      where c.name ilike '%' || q || '%'
         or c.email ilike '%' || q || '%'
         or co.name ilike '%' || q || '%'
         or similarity(c.name, q) > 0.3
         or word_similarity(q, c.name) > 0.5
         or ( length(regexp_replace(q, '\D', '', 'g')) >= 4
              and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')
                  like '%' || regexp_replace(q, '\D', '', 'g') || '%' )
      order by score desc, c.name
      limit 15
    ) t
  ),
  'companies', (
    select coalesce(jsonb_agg(t order by t.score desc, t.name), '[]'::jsonb) from (
      select co.id, co.name, co.company_type,
             ( case when co.name ilike '%' || q || '%' then 1.0 else 0.0 end
             + greatest(similarity(co.name, q), word_similarity(q, co.name))
             ) as score
      from companies co
      where co.name ilike '%' || q || '%'
         or similarity(co.name, q) > 0.3
         or word_similarity(q, co.name) > 0.5
      order by score desc, co.name
      limit 10
    ) t
  ),
  'notes', (
    select coalesce(jsonb_agg(t order by t.occurred_at desc), '[]'::jsonb) from (
      select a.id, a.activity_type, a.subject, left(coalesce(a.body, ''), 160) as snippet,
             a.occurred_at, a.deal_id, a.contact_id,
             p.address as deal_address
      from activities a
      left join deals d on d.id = a.deal_id
      left join properties p on p.id = d.property_id
      where (d.id is null or d.deal_type <> 'lease')
        and ( a.subject ilike '%' || q || '%'
           or a.body ilike '%' || q || '%' )
      order by a.occurred_at desc
      limit 15
    ) t
  ),
  'tasks', (
    select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select tk.id, tk.title, tk.due_date, tk.status, tk.assigned_to, tk.deal_id
      from tasks tk
      left join deals d on d.id = tk.deal_id
      where (d.id is null or d.deal_type <> 'lease')
        and ( tk.title ilike '%' || q || '%'
           or tk.notes ilike '%' || q || '%' )
      order by tk.status asc, tk.due_date asc nulls last
      limit 10
    ) t
  )
);
$$;
