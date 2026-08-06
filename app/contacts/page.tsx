import Link from "next/link";
import { listCompanies, listContacts, CONTACT_TYPE_LABELS, COMPANY_TO_CONTACT_TYPE } from "@/lib/crm";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import ContactForm from "@/components/ContactForm";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

const TYPE_ORDER = ["broker", "owner_user", "institutional_owner", "tenant", "other"];

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { q?: string; type?: string };
}) {
  const q = searchParams.q?.trim() || undefined;
  const typeFilter = searchParams.type || undefined;
  const [contacts, companies] = await Promise.all([listContacts(q), listCompanies()]);

  const companyType = (c: any) => COMPANY_TO_CONTACT_TYPE[c.company_type] ?? "other";
  const peopleAt = (companyId: string) =>
    contacts.filter((p: any) => p.companies?.id === companyId);

  const visiblePeople = contacts.filter(
    (c: any) => !typeFilter || (c.contact_type ?? "unclassified") === typeFilter
  );
  const visibleCompanies = (q ? companies.filter((c: any) =>
        c.name.toLowerCase().includes(q.toLowerCase())
      ) : companies
  ).filter((c: any) => !typeFilter || companyType(c) === typeFilter);

  const chips = [
    { value: "", label: "All" },
    ...TYPE_ORDER.map((t) => ({ value: t, label: CONTACT_TYPE_LABELS[t] })),
  ];
  const chipHref = (v: string) => {
    const params = new URLSearchParams();
    if (v) params.set("type", v);
    if (q) params.set("q", q);
    const qs = params.toString();
    return `/contacts${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <Nav active="contacts" />
      <AutoRefresh />
      <main>
        <div className="page-header">
          <div>
            <h1>Contacts</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {contacts.length} {contacts.length === 1 ? "person" : "people"} ·{" "}
              {companies.length} {companies.length === 1 ? "company" : "companies"}
            </p>
          </div>
          <div className="header-actions">
            <ContactForm
              companies={companies.map((c: any) => ({
                id: c.id,
                name: c.name,
                company_type: c.company_type,
              }))}
            />
          </div>
        </div>

        <div className="filter-chips">
          {chips.map((chip) => (
            <Link
              key={chip.value || "all"}
              href={chipHref(chip.value)}
              className={(typeFilter ?? "") === chip.value ? "chip chip-active" : "chip"}
            >
              {chip.label}
            </Link>
          ))}
        </div>

        <form method="get" className="search-bar">
          {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
          <input name="q" placeholder="Search people and companies…" defaultValue={q ?? ""} />
          <button type="submit" className="secondary">
            Search
          </button>
          {q && (
            <Link href={chipHref(typeFilter ?? "")} className="muted">
              Clear
            </Link>
          )}
        </form>

        <section className="panel">
          <h2>
            People <span className="count">{visiblePeople.length}</span>
          </h2>
          {visiblePeople.length === 0 ? (
            <p className="muted">No people{typeFilter || q ? " match" : " yet"}.</p>
          ) : (
            <div className="contact-table">
              <div className="contact-row contact-row-5 contact-row-head">
                <span>Name</span>
                <span>Type</span>
                <span>Company</span>
                <span>Email</span>
                <span>Phone</span>
              </div>
              {visiblePeople.map((c: any) => (
                <div key={c.id} className="contact-row contact-row-5">
                  <span>
                    <Link href={`/contacts/${c.id}`}>
                      <strong>{c.name}</strong>
                    </Link>
                    {c.title && <span className="muted"> · {c.title}</span>}
                  </span>
                  <span>
                    {c.contact_type ? (
                      <span className="doc-type">{CONTACT_TYPE_LABELS[c.contact_type] ?? c.contact_type}</span>
                    ) : (
                      <span className="muted contact-unassigned">unclassified</span>
                    )}
                  </span>
                  <span>
                    {c.companies?.name ? (
                      <Link href={`/companies/${c.companies.id}`}>{c.companies.name}</Link>
                    ) : (
                      <span className="muted contact-unassigned">no company</span>
                    )}
                  </span>
                  <span>
                    {c.email ? (
                      <a href={`mailto:${c.email}`}>{c.email}</a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </span>
                  <span>{c.phone || <span className="muted">—</span>}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <h2>
            Companies <span className="count">{visibleCompanies.length}</span>
          </h2>
          {visibleCompanies.length === 0 ? (
            <p className="muted">
              No companies{typeFilter || q ? " match" : " yet"} — they're created automatically when
              you add a contact with a new firm.
            </p>
          ) : (
            <div className="contact-table">
              <div className="contact-row contact-row-3 contact-row-head">
                <span>Company</span>
                <span>Type</span>
                <span>People</span>
              </div>
              {visibleCompanies.map((c: any) => {
                const members = peopleAt(c.id);
                return (
                  <div key={c.id} className="contact-row contact-row-3">
                    <span>
                      <Link href={`/companies/${c.id}`}>
                        <strong>{c.name}</strong>
                      </Link>
                    </span>
                    <span>
                      <span className="doc-type">
                        {CONTACT_TYPE_LABELS[companyType(c)] ?? c.company_type}
                      </span>
                    </span>
                    <span className="muted">
                      {members.length === 0
                        ? "—"
                        : members
                            .slice(0, 3)
                            .map((m: any) => m.name)
                            .join(", ") + (members.length > 3 ? ` +${members.length - 3}` : "")}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
