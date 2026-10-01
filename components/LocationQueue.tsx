"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import LocationPreview, { type LocationPoint } from "./LocationPreview";
interface RecordLocation { id: string; kind: "deal" | "comp"; stage: string; address: string; city?: string | null; state?: string | null; market?: string | null }
function Row({ record }: { record: RecordLocation }) {
  const router = useRouter();
  const [point,setPoint] = useState<LocationPoint | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  async function save() {
    if (!point) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(record.kind === "deal" ? `/api/deals/${record.id}/location` : `/api/comps/${record.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...point, expectedAddress: record.address, expectedCity: record.city, expectedMarket: record.market }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save location");
      router.refresh();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="panel"><h3><Link href={`/${record.kind === "deal" ? "deals" : "comps"}/${record.id}`}>{record.address || "Address missing"}</Link></h3>
    <p>{[record.city,record.state,record.market].filter(Boolean).join(" · ")} · {record.stage.replace(/_/g," ")}</p>
    <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
      <LocationPreview {...record} value={point} onChange={setPoint} />
      <button type="button" disabled={!point || busy} onClick={save}>{busy ? "Saving…" : "Save this location"}</button>
      {error && <p className="error">{error}</p>}
    </fieldset>
  </section>;
}
export default function LocationQueue({records}: {records: RecordLocation[]}) {
  const [archived,setArchived] = useState(false);
  const shown = records.filter(r => archived || r.stage !== "archived");
  return <><label><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Include archived deals</label>
    <p>{shown.length} locations to resolve</p>{shown.map(r => <Row key={`${r.kind}/${r.id}`} record={r} />)}
    {!shown.length && <p>All records in this view have usable map locations.</p>}
  </>;
}
