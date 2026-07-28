import Link from "next/link";
import { listCompanies, listContacts } from "@/lib/crm";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import ContactForm from "@/components/ContactForm";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const q = searchParams.q?.trim() || undefined;
  const [contacts, companies] = await Promise.all([listContacts(q), listCompanies()]);

  return (
    <>
      <Nav active="contacts" />
      <AutoRefresh />
      <main>
        <div className="page-header">
          <div>
            <h1>Contacts</h1>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {contacts.length} {q ? `matching “${q}”` : "people"} · brokers, owners, and tenants
              across every deal
            </p>
          </div>
          <div className="header-actions">
            <ContactForm companies={companies.map((c: any) => ({ id: c.id, name: c.name }))} />
          </div>
        </div>

        <form method="get" className="search-bar">
          <input name="q" placeholder="Search people…" defaultValue={q ?? ""} />
          <button type="submit" className="secondary">
            Search
          </button>
          {q && (
            <Link href="/contacts" className="muted">
              Clear
            </Link>
          )}
        </form>

        <section className="panel">
          {contacts.length === 0 ? (
            <p className="muted">
              No contacts{q ? " match" : " yet"}. Add the brokers, sellers, and tenants you work
              with — they link to deals from any deal page.
            </p>
          ) : (
            <div className="contact-table">
              <div className="contact-row contact-row-head">
                <span>Name</span>
                <span>Company</span>
                <span>Email</span>
                <span>Phone</span>
              </div>
              {contacts.map((c: any) => (
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
          )}
        </section>
      </main>
    </>
  );
}
