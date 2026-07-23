// lib/comps.ts
//
// v1 scoring: simple recency + distance blend, no tunable weights.
// Full weighted scoring (location / SF / lease-commencement date) is
// deferred to v2 -- see comp_weight_config table, which is ready to
// hold real weights once there's a basis for them.

import { getServiceClient } from "./supabase";

interface CompCandidate {
  id: string;
  address: string;
  rent: number;
  date_commenced: string;
  latitude: number | null;
  longitude: number | null;
}

interface ScoredComp extends CompCandidate {
  score: number;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function recencyScore(dateCommenced: string): number {
  const months = (Date.now() - new Date(dateCommenced).getTime()) / (1000 * 60 * 60 * 24 * 30);
  // Linear falloff over 24 months, floors at 0.
  return Math.max(0, 1 - months / 24);
}

function distanceScore(miles: number): number {
  // Linear falloff over 15 miles, floors at 0.
  return Math.max(0, 1 - miles / 15);
}

export async function getRentRecommendation(market: string, lat: number, lon: number) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("comps")
    .select("id, address, rent, date_commenced, latitude, longitude")
    .eq("market", market)
    .limit(50);

  if (error) throw error;

  const scored: ScoredComp[] = (data ?? [])
    .filter((c) => c.latitude != null && c.longitude != null)
    .map((c) => {
      const miles = haversineMiles(lat, lon, c.latitude!, c.longitude!);
      // v1: equal-weighted blend of recency and distance. Replace with
      // comp_weight_config lookup once v2 weighting is ready.
      const score = 0.5 * recencyScore(c.date_commenced) + 0.5 * distanceScore(miles);
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 5);
  const blendedRent = top.length
    ? top.reduce((sum, c) => sum + c.rent * c.score, 0) / top.reduce((sum, c) => sum + c.score, 0)
    : null;

  return { topComps: top, blendedRent };
}
