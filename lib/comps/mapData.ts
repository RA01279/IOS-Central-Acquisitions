/** A map pin requires two finite, geographically valid coordinates. */
export function hasMapCoordinates(comp: { latitude: unknown; longitude: unknown }): boolean {
  if (comp.latitude == null || comp.longitude == null || comp.latitude === "" || comp.longitude === "") return false;
  const lat = Number(comp.latitude);
  const lng = Number(comp.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Read every page; a database's response cap must not silently truncate a map. */
export async function readAllCompPages<T>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  while (true) {
    const { data, error } = await load(rows.length, rows.length + pageSize - 1);
    if (error) throw new Error(`Could not load comps: ${error.message}`);
    if (!data?.length) return rows;
    rows.push(...data);
    // Continue even for a short page: the database may cap below pageSize.
  }
}
