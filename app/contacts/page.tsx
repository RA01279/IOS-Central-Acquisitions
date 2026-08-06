import Link from "next/link";
import { listCompanies, listContacts, CONTACT_TYPE_LABELS, COMPANY_TO_CONTACT_TYPE } from "@/lib/crm";
import Nav from "@/components/Nav";
import AutoRefresh from "@/components/AutoRefresh";
import ContactForm from "@/components/ContactForm";
import CompanyForm from "@/components/CompanyForm";
import { ContactTypeSelect, ContactDeleteButton } from "@/components/ContactRowActions";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

const TYPE_ORDER = ["broker", "owner_user", "institutional_owner", "tenant", "other"];

function PersonLine({ c }: { c: any }) {
  return (
    <div className="person-line">
      <span className="person-name">
        <Link href={`/contacts/${c.id}`}>{c.name}</Link>
        {c.title && <span className="muted"> · {c.title}</span>}
      </span>
      <span className="muted person-contact">
        {c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "no email"}
        {c.phone ? ` · ${c.phone}` : ""}
      </span>
      <span>
        <ContactTypeSelect contactId={c.id} contactType={c.contact_type ?? null} />
      </span>
      <span>
        <ContactDeleteButton contactId={c.id} name={c.name} />
      </span>
    </div>
  );
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { q?: string; type?: string };
}) {
  const q = searchParams.q?.trim()?.toLowerCase() || undefined;
  const typeFilter = searchParams.type || undefined;
  const [contacts, companies] = await Promise.all([listContacts(), listCompanies()]);

  const companyType = (c: any) => COMPANY_TO_CONTACT_TYPE[c.company_type] ?? "other";

  // Search matches a company name OR any of its people; type filter matches
  // the company's classification or a person's own.
  function companyMatches(c: any, members: any[]) {
    const typeOk =
      !typeFilter ||
      companyType(c) === typeFilter ||
      members.some((m: any) => (m.contact_type ?? "") === typeFilter);
    const qOk =
      !q ||
      c.name.toLowerCase().includes(q) ||
      members.some((m: any) => m.name.toLowerCase().includes(q));
    return typeOk && qOk;
  }

  const groups = companies
    .map((c: any) => ({
      company: c,
      members: contacts.filter((p: any) => p.companies?.id === c.id),
    }))
    .filter(({ company, members }) => companyMatches(company, members))
    .sort((a, b) => a.company.name.localeCompare(b.company.name));

  const loosePeople = contacts.filter(
    (p: any) =>
      !p.companies &&
      (!typeFilter || (p.contact_type ?? "unclassified") === typeFilter) &&
      (!q || p.name.toLowerCase().includes(q))
  );

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
              {companies.length} {companies.length === 1 ? "company" : "companies"} ·{" "}
              {contacts.length} {contacts.length === 1 ? "person" : "people"}
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
            <CompanyForm />
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
          <input name="q" placeholder="Search companies and people…" defaultValue={q ?? ""} />
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
          {groups.length === 0 && loosePeople.length === 0 ? (
            <p className="muted">
              Nothing{typeFilter || q ? " matches" : " yet"}. Add a company (e.g. an institutional
              owner you're tracking) or a contact — firms are also created automatically when you
              add a person with a new company.
            </p>
          ) : (
            <>
              {groups.map(({ company, members }) => (
                <div key={company.id} className="company-group">
                  <div className="company-head">
                    <Link href={`/companies/${company.id}`} className="company-name">
                      {company.name}
                    </Link>
                    <span className="doc-type">
                      {CONTACT_TYPE_LABELS[companyType(company)] ?? company.company_type}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {members.length === 0
                        ? "no people yet"
                        : `${members.length} ${members.length === 1 ? "person" : "people"}`}
                    </span>
                  </div>
                  {members.length > 0 && (
                    <div className="company-people">
                      {members.map((m: any) => (
                        <PersonLine key={m.id} c={m} />
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {loosePeople.length > 0 && (
                <div className="company-group">
                  <div className="company-head">
                    <span className="company-name muted">No company</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {loosePeople.length} {loosePeople.length === 1 ? "person" : "people"} — assign
                      a firm from their page
                    </span>
                  </div>
                  <div className="company-people">
                    {loosePeople.map((m: any) => (
                      <PersonLine key={m.id} c={m} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </>
  );
}
