import Link from "next/link";
import { listCompanies, listContacts, CONTACT_TYPE_LABELS, COMPANY_TO_CONTACT_TYPE } from "@/lib/crm";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import ContactForm from "@/components/ContactForm";
import { ContactTypeSelect, ContactDeleteButton } from "@/components/ContactRowActions";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

const TYPE_ORDER = ["broker", "owner_user", "institutional_owner", "tenant", "other"];

function PersonCard({ c }: { c: any }) {
  return (
    <div className="contact-card">
      <div className="contact-card-head">
        <Link href={`/contacts/${c.id}`} className="contact-card-name">
          {c.name}
        </Link>
        <ContactDeleteButton contactId={c.id} name={c.name} />
      </div>
      <div className="contact-card-line muted">
        {[c.title, c.companies?.name].filter(Boolean).join(" · ") || "no company"}
      </div>
      <div className="contact-card-line">
        {c.email ? (
          <a href={`mailto:${c.email}`}>{c.email}</a>
        ) : (
          <span className="muted">no email</span>
        )}
      </div>
      <div className="contact-card-line muted">{c.phone || "no phone"}</div>
      <div className="contact-card-foot">
        <ContactTypeSelect contactId={c.id} contactType={c.contact_type ?? null} />
      </div>
    </div>
  );
}

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
            <>
              <div className="contact-cards">
                {visiblePeople.slice(0, 24).map((c: any) => (
                  <PersonCard key={c.id} c={c} />
                ))}
              </div>
              {visiblePeople.length > 24 && (
                <details className="show-more">
                  <summary>Show all {visiblePeople.length} ({visiblePeople.length - 24} more)</summary>
                  <div className="contact-cards" style={{ marginTop: 12 }}>
                    {visiblePeople.slice(24).map((c: any) => (
                      <PersonCard key={c.id} c={c} />
                    ))}
                  </div>
                </details>
              )}
            </>
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
            <div className="contact-cards">
              {visibleCompanies.map((c: any) => {
                const members = peopleAt(c.id);
                return (
                  <div key={c.id} className="contact-card">
                    <div className="contact-card-head">
                      <Link href={`/companies/${c.id}`} className="contact-card-name">
                        {c.name}
                      </Link>
                      <span className="doc-type">
                        {CONTACT_TYPE_LABELS[companyType(c)] ?? c.company_type}
                      </span>
                    </div>
                    <div className="contact-card-line muted">
                      {members.length === 0
                        ? "No people yet"
                        : members
                            .slice(0, 3)
                            .map((m: any) => m.name)
                            .join(", ") + (members.length > 3 ? ` +${members.length - 3}` : "")}
                    </div>
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
