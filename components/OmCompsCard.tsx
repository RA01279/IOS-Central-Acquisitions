// components/OmCompsCard.tsx
//
// Summary-tab prompt for a deal that came with an OM: pull the OM's lease and
// sale comparables into the comp database (reviewed on the Comps page, then
// saved and mapped), or -- once done -- how many comps came from it.

export type OmDoc = { id: string; name: string; comps: number };

export default function OmCompsCard({ dealId, oms }: { dealId: string; oms: OmDoc[] }) {
  if (!oms.length) return null;
  return (
    <div className="card" style={{ gap: 8 }}>
      <div className="card-head">
        <span className="overline">Comps in the OM</span>
      </div>
      {oms.map((om) => (
        <p key={om.id} className="hint" style={{ margin: 0 }}>
          {om.comps > 0 ? (
            <>
              <strong>{om.comps}</strong> comp{om.comps === 1 ? "" : "s"} from {om.name} are in Comps.{" "}
              <a href={`/comps?om=${dealId}:${om.id}#add-comps`} className="link-caps">Read again</a>
            </>
          ) : (
            <>
              {om.name}: pull its lease and sale comparables into Comps and the map.{" "}
              <a href={`/comps?om=${dealId}:${om.id}#add-comps`} className="link-caps">Pull comps</a>
            </>
          )}
        </p>
      ))}
    </div>
  );
}
