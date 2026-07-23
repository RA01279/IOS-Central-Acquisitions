import Link from "next/link";
import { listCompanies, listContacts, COMPANY_TYPE_LABELS } from "@/lib/crm";
import Nav from "@/components/Nav";
import ContactForm from "@/components/ContactForm";
import CompanyForm from "@/components/CompanyForm";
import BackButton from "@/components/BackButton";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const q = searchParams.q?.trim() || undefined;
  const [contacts, companies] = await Promise.all([listContacts(q), listCompanies(q)]);

  return (
    <>
      <Nav active="contacts" />
      <main>
        <BackButton />
        <div className="page-header">
          <h1>Contacts</h1>
          <div className="header-actions">
            <ContactForm companies={companies.map((c: any) => ({ id: c.id, name: c.name }))} />
            <CompanyForm />
          </div>
        </div>

        <form method="get" className="search-bar">
          <input
            name="q"
            placeholder="Search people and companies…"
            defaultValue={q ?? ""}
          />
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
          <h2>People {q ? `matching “${q}”` : ""}</h2>
          {contacts.length === 0 ? (
            <p className="muted">No contacts yet. Add the brokers, sellers, and tenants you work with.</p>
          ) : (
            <ul className="doc-list">
              {contacts.map((c: any) => (
                <li key={c.id}>
                  <Link href={`/contacts/${c.id}`}>
                    <strong>{c.name}</strong>
                  </Link>
                  {c.title && <span className="muted"> · {c.title}</span>}
                  {c.companies?.name && <span className="muted"> · {c.companies.name}</span>}
                  {c.email && <span className="muted"> · {c.email}</span>}
                  {c.phone && <span className="muted"> · {c.phone}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Companies {q ? `matching “${q}”` : ""}</h2>
          {companies.length === 0 ? (
            <p className="muted">No companies yet.</p>
          ) : (
            <ul className="doc-list">
              {companies.map((c: any) => (
                <li key={c.id}>
                  <span className="doc-type">
                    {COMPANY_TYPE_LABELS[c.company_type as keyof typeof COMPANY_TYPE_LABELS] ??
                      c.company_type}
                  </span>
                  <Link href={`/companies/${c.id}`}>{c.name}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
