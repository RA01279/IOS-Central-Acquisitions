import { getServiceClient } from "./supabase";
import { reviewedMap, snapshotFromReview, reviewMatchesPin, type DemandMapReview } from "./demand-map-review";
export async function loadDemandMapReview(dealId: string): Promise<DemandMapReview | null> {
  const { data, error } = await getServiceClient().from("deal_analysis_versions")
    .select("version,payload,created_at,created_by").eq("deal_id", dealId).eq("kind", "demand")
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Could not load the saved business-map review");
  if (!data) return null;
  if (!reviewedMap(data.payload)) throw new Error("The saved map review is invalid; regenerate and review the map");
  return data as DemandMapReview;
}
export async function loadReviewedDemandSnapshot(dealId: string) {
  const [review, property] = await Promise.all([loadDemandMapReview(dealId), getServiceClient().from("deals").select("properties(latitude,longitude)").eq("id",dealId).maybeSingle()]);
  if (property.error) throw new Error("Could not check the saved map location");
  const p: any = property.data?.properties;
  const point = Array.isArray(p) ? p[0] : p;
  return review && reviewMatchesPin(review, point?.latitude == null ? null : Number(point.latitude), point?.longitude == null ? null : Number(point.longitude)) ? snapshotFromReview(review) : null;
}
