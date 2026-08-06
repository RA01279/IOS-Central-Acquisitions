import Link from "next/link";
import { listCompanies, listContacts, CONTACT_TYPE_LABELS, COMPANY_TO_CONTACT_TYPE } from "@/lib/crm";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import ContactForm from "@/components/ContactForm";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

// Section order; unclassified contacts land at the bottom as a nudge.
const SECTION_ORDER = ["broker", "owner_user", "institutional_owner", "tenant", "other", "unclassified"];

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { q?: string; type?: string };
}) {
  const q = searchParams.q?.trim() || undefined;
  const typeFilter = searchParams.type || undefined;
  const [contacts, companies] = await Promise.all([listContacts(q), listCompanies()]);

  // Companies live in the same sections as their people.
  const companySection = (c: any) => COMPANY_TO_CONTACT_TYPE[c.company_type] ?? "other";
  const peopleCount = (companyId: string) =>
    contacts.filter((p: any) => p.companies?.id === companyId).length;

  const visibleSections = SECTION_ORDER.filter((t) => !typeFilter || t === typeFilter);

  const chips = [
    { value: "", label: "All" },
    ...SECTION_ORDER.filter((t) => t !== "unclassified").map((t) => ({
      value: t,
      label: CONTACT_TYPE_LABELS[t],
    })),
  ];

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
              href={chip.value ? `/contacts?type=${chip.value}${q ? `&q=${encodeURIComponent(q)}` : ""}` : `/contacts${q ? `?q=${encodeURIComponent(q)}` : ""}`}
              className={
                (typeFilter ?? "") === chip.value ? "chip chip-active" : "chip"
              }
            >
              {chip.label}
            </Link>
          ))}
        </div>

        <form method="get" className="search-bar">
          {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
          <input name="q" placeholder="Search people…" defaultValue={q ?? ""} />
          <button type="submit" className="secondary">
            Search
          </button>
          {q && (
            <Link href={typeFilter ? `/contacts?type=${typeFilter}` : "/contacts"} className="muted">
              Clear
            </Link>
          )}
        </form>

        {contacts.length === 0 && companies.length === 0 ? (
          <section className="panel">
            <p className="muted">
              No contacts{q ? " match" : " yet"}. Add the brokers, owners, and tenants you work
              with — each is classified as you add it.
            </p>
          </section>
        ) : (
          visibleSections.map((type) => {
            const sectionPeople = contacts.filter(
              (c: any) => (c.contact_type ?? "unclassified") === type
            );
            const sectionCompanies = q
              ? [] // company rows hidden during people-search to keep results focused
              : companies.filter((c: any) => companySection(c) === type);
            if (sectionPeople.length === 0 && sectionCompanies.length === 0) return null;
            const label =
              type === "unclassified"
                ? "Unclassified — needs a type"
                : CONTACT_TYPE_LABELS[type];
            return (
              <section className="panel" key={type}>
                <h2>
                  {label} <span className="count">{sectionPeople.length + sectionCompanies.length}</span>
                </h2>
                <div className="contact-table">
                  <div className="contact-row contact-row-head">
                    <span>Name</span>
                    <span>Company</span>
                    <span>Email</span>
                    <span>Phone</span>
                  </div>
                  {sectionCompanies.map((c: any) => (
                    <div key={`co-${c.id}`} className="contact-row">
                      <span>
                        <span className="doc-type">COMPANY</span>{" "}
                        <Link href={`/companies/${c.id}`}>
                          <strong>{c.name}</strong>
                        </Link>
                      </span>
                      <span className="muted">
                        {peopleCount(c.id)} {peopleCount(c.id) === 1 ? "person" : "people"}
                      </span>
                      <span className="muted">—</span>
                      <span className="muted">—</span>
                    </div>
                  ))}
                  {sectionPeople.map((c: any) => (
                    <div key={c.id} className="contact-row">
                      <span>
                        <Link href={`/contacts/${c.id}`}>
                          <strong>{c.name}</strong>
                        </Link>
                        {c.title && <span className="muted"> · {c.title}</span>}
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
              </section>
            );
          })
        )}
      </main>
    </>
  );
}
