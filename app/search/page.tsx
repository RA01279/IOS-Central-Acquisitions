import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import { ASSET_CLASS_LABELS, STAGE_LABELS } from "@/lib/deals";
import { CONTACT_TYPE_LABELS } from "@/lib/crm";
import Nav from "@/components/Nav";
import NavSearch from "@/components/NavSearch";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const q = searchParams.q?.trim() || "";

  let results: any = null;
  if (q.length >= 2) {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("global_search", { q });
    if (!error) results = data;
  }

  const deals = results?.deals ?? [];
  const contacts = results?.contacts ?? [];
  const companies = results?.companies ?? [];
  const notes = results?.notes ?? [];
  const tasks = results?.tasks ?? [];
  const total = deals.length + contacts.length + companies.length + notes.length + tasks.length;

  return (
    <>
      <Nav active="" />
      <main>
        <div className="page-header">
          <div>
            <h1>Search</h1>
            {q && (
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {total} result{total === 1 ? "" : "s"} for “{q}” — fuzzy matching on, typos forgiven
              </p>
            )}
          </div>
        </div>

        <div style={{ maxWidth: 480, marginBottom: 20 }}>
          <NavSearch initial={q} />
        </div>

        {q.length > 0 && q.length < 2 && (
          <p className="muted">Type at least two characters.</p>
        )}

        {q.length >= 2 && total === 0 && (
          <section className="panel">
            <p className="muted">
              Nothing found for “{q}” — not in any deal, contact, company, note, or task.
            </p>
          </section>
        )}

        {deals.length > 0 && (
          <section className="panel">
            <h2>
              Deals <span className="count">{deals.length}</span>
            </h2>
            <ul className="doc-list">
              {deals.map((d: any) => (
                <li key={d.id}>
                  <span className="doc-type">
                    {ASSET_CLASS_LABELS[d.asset_class] ?? "ACQ"}
                  </span>
                  <Link href={`/deals/${d.id}`}>
                    <strong>{d.address ?? "Untitled deal"}</strong>
                  </Link>
                  <span className="muted">
                    {" "}
                    · {[d.city, d.market].filter(Boolean).join(", ")} ·{" "}
                    {d.stage === "archived"
                      ? `Archived${d.death_reason ? ` — ${String(d.death_reason).slice(0, 60)}` : ""}`
                      : d.stage === "closed"
                        ? `Closed${d.closed_on ? ` ${d.closed_on}` : ""}`
                        : STAGE_LABELS[d.stage] ?? d.stage}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(contacts.length > 0 || companies.length > 0) && (
          <section className="panel">
            <h2>
              People &amp; companies <span className="count">{contacts.length + companies.length}</span>
            </h2>
            <ul className="doc-list">
              {companies.map((c: any) => (
                <li key={`co-${c.id}`}>
                  <span className="doc-type">COMPANY</span>
                  <Link href={`/companies/${c.id}`}>
                    <strong>{c.name}</strong>
                  </Link>
                </li>
              ))}
              {contacts.map((c: any) => (
                <li key={c.id}>
                  {c.contact_type && (
                    <span className="doc-type">
                      {CONTACT_TYPE_LABELS[c.contact_type] ?? c.contact_type}
                    </span>
                  )}
                  <Link href={`/contacts/${c.id}`}>
                    <strong>{c.name}</strong>
                  </Link>
                  <span className="muted">
                    {[c.title, c.company, c.email].filter(Boolean).map((x: string) => ` · ${x}`)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {notes.length > 0 && (
          <section className="panel">
            <h2>
              Notes &amp; touchpoints <span className="count">{notes.length}</span>
            </h2>
            <ul className="doc-list">
              {notes.map((n: any) => (
                <li key={n.id}>
                  <span className="doc-type">{String(n.activity_type ?? "note").toUpperCase()}</span>
                  {n.deal_id ? (
                    <Link href={`/deals/${n.deal_id}`}>{n.deal_address ?? "deal"}</Link>
                  ) : n.contact_id ? (
                    <Link href={`/contacts/${n.contact_id}`}>contact</Link>
                  ) : (
                    <span className="muted">unlinked</span>
                  )}
                  <span className="muted">
                    {" "}
                    · {n.subject ? `${n.subject} — ` : ""}
                    {n.snippet}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tasks.length > 0 && (
          <section className="panel">
            <h2>
              Follow-ups <span className="count">{tasks.length}</span>
            </h2>
            <ul className="doc-list">
              {tasks.map((t: any) => (
                <li key={t.id}>
                  <span className="doc-type">{t.status === "done" ? "DONE" : "OPEN"}</span>
                  {t.deal_id ? (
                    <Link href={`/deals/${t.deal_id}`}>{t.title}</Link>
                  ) : (
                    <span>{t.title}</span>
                  )}
                  <span className="muted">
                    {t.due_date ? ` · due ${t.due_date}` : ""}
                    {t.assigned_to ? ` · ${t.assigned_to}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
