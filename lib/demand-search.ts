// lib/demand-search.ts
//
// Google Places "who nearby would rent a yard" search. Moved out of
// app/api/deals/[id]/demand-map/route.ts (route files may only export HTTP
// handlers) so the site-score refresh in lib/site-signals.ts runs exactly the
// same search, screen and de-dupe as the IC demand map.

import { rejectReason, normalizeName } from "@/lib/sourcing/yard-users";
import { haversineMiles } from "@/lib/ic-deck/geo";

export type NearbyTenant = {
  name: string;
  category: string;
  lat: number;
  lng: number;
  placeId: string;
  distanceMi: number;
  website: string | null;
  logoBase64: string | null;
};

export async function searchNearby({
  lat,
  lng,
  radiusMiles,
  categories,
  perCategoryCap,
  apiKey,
}: {
  lat: number;
  lng: number;
  radiusMiles: number;
  categories: { label: string; keywords: string[] }[];
  /** The IC map caps at 8 so its legend stays readable; scoring wants the real count. */
  perCategoryCap: number;
  apiKey: string;
}): Promise<{ tenants: NearbyTenant[]; screened: number }> {
  const radiusMeters = Math.round(radiusMiles * 1609.34);
  let screened = 0;

  const resultsByCategory = await Promise.all(
    categories.map(async (cat) => {
      // Every keyword in the category, merged. Dedupe happens below on
      // place_id, which is what makes multiple keywords per category safe.
      const perKeyword = await Promise.all(
        cat.keywords.map(async (keyword) => {
          const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
          url.searchParams.set("location", `${lat},${lng}`);
          url.searchParams.set("radius", String(radiusMeters));
          url.searchParams.set("keyword", keyword);
          url.searchParams.set("key", apiKey);

          const r = await fetch(url.toString(), { cache: "no-store" });
          const data = await r.json();
          if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
            console.error(`Places error for "${cat.label}" / "${keyword}":`, data.status, data.error_message);
            return [] as NearbyTenant[];
          }
          return (data.results || [])
            .filter((place: any) => {
              const reason = rejectReason(place, cat.label);
              if (reason) {
                screened++;
                return false;
              }
              return true;
            })
            .map((place: any) => ({
              name: place.name,
              category: cat.label,
              lat: place.geometry.location.lat,
              lng: place.geometry.location.lng,
              placeId: place.place_id,
              distanceMi: haversineMiles(lat, lng, place.geometry.location.lat, place.geometry.location.lng),
              website: null,
              logoBase64: null,
            })) as NearbyTenant[];
        })
      );
      return perKeyword.flat();
    })
  );

  let tenants = resultsByCategory.flat().filter((t) => t.distanceMi <= radiusMiles);

  // De-dupe by placeId (the same business surfaces under several keywords, and
  // across categories -- Austin Wholesale Landscape Supply answers to both
  // "stone yard" and "landscape supply yard"). Nearest wins, and the first
  // category to claim it keeps it. Then cap per category.
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  const perCategoryCount: Record<string, number> = {};
  tenants = tenants
    .sort((a, b) => a.distanceMi - b.distanceMi)
    .filter((t) => {
      if (seen.has(t.placeId)) return false;
      // Also dedupe on the name: chains and duplicate Google listings share a
      // name across different place_ids, and four identical pins for the same
      // operator ("Truck Parking Club") is noise, not demand.
      const nameKey = normalizeName(t.name);
      if (seenNames.has(nameKey)) return false;
      seen.add(t.placeId);
      seenNames.add(nameKey);
      perCategoryCount[t.category] = (perCategoryCount[t.category] || 0) + 1;
      return perCategoryCount[t.category] <= perCategoryCap;
    });

  return { tenants, screened };
}
