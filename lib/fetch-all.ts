// lib/fetch-all.ts
//
// PostgREST caps a single select at 1000 rows and returns the first 1000
// without complaint. Page until a short page, and throw on any error -- a
// silently empty or truncated result reads as "no deals", which is worse than
// a failed request. Give the query a stable .order() so pages don't overlap.
const PAGE = 1000;

export async function fetchAll(query: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message ?? String(error));
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}
