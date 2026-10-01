import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { readAllCompPages } from "@/lib/comps/mapData";
import { locationReady } from "@/lib/location";
import Nav from "@/components/Nav";
import LocationQueue from "@/components/LocationQueue";
export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  if (!await getCurrentUser()) redirect("/login");
  const db = getServiceClient();
  const [deals, comps] = await Promise.all([
    readAllCompPages<any>((from,to) => db.from("deals").select("id,stage,properties(address,city,market,latitude,longitude,geocode_precision)").order("id").range(from,to)),
    readAllCompPages<any>((from,to) => db.from("comps").select("id,comp_type,address,city,state,market,latitude,longitude,geocode_precision").order("id").range(from,to)),
  ]);
  const records = [
    ...deals.filter(d => d.properties && !locationReady(d.properties)).map(d => ({ ...d.properties, id: d.id, kind: "deal" as const, stage: d.stage })),
    ...comps.filter(c => !locationReady(c)).map(c => ({ ...c, kind: "comp" as const, stage: c.comp_type })),
  ];
  return <><Nav /><main className="page"><h1>Map locations</h1>
    <p>{deals.length} deals and {comps.length} comps checked. {records.length} need a verified property location.</p>
    <p>Check Google first. If the address is incomplete or refers to several properties, confirm the actual site before placing a pin.</p>
    <LocationQueue records={records} />
  </main></>;
}
