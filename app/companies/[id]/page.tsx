import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompanyWithRelations, COMPANY_TYPE_LABELS } from "@/lib/crm";
import Nav from "@/components/Nav";

// Live, per-request, auth-gated data -- never statically prerender this.
export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({ params }: { params: { id: string } }) {
  let data;
  try {
    data = await getCompanyWithRelations(params.id);
  } catch {
    return notFound();
  }
  const { company, contacts, activities } = data;
  if (!company) return notFound();

  return (
    <>
      <Nav active="contacts" />
      <main className="deal-detail">
        <Link href="/contacts" className="back-link">
          ← Contacts
        </Link>

        <div className="deal-header">
          <div>
            <h1>{company.name}</h1>
            <p className="muted">
              {COMPANY_TYPE_LABELS[company.company_type as keyof typeof COMPANY_TYPE_LABELS] ??
                company.company_type}
            </p>
          </div>
        </div>

        <section className="panel">
          <h2>People</h2>
          {contacts.length === 0 ? (
            <p className="muted">No contacts at this company yet.</p>
          ) : (
            <ul className="doc-list">
              {contacts.map((c: any) => (
                <li key={c.id}>
                  <Link href={`/contacts/${c.id}`}>
                    <strong>{c.name}</strong>
                  </Link>
                  {c.title && <span className="muted"> · {c.title}</span>}
                  {c.email && <span className="muted"> · {c.email}</span>}
                  {c.phone && <span className="muted"> · {c.phone}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Activity</h2>
          {activities.length === 0 ? (
            <p className="muted">No activity logged against this company yet.</p>
          ) : (
            <ul className="event-list">
              {activities.map((a: any) => (
                <li key={a.id}>
                  {a.subject ?? a.activity_type}
                  <span className="muted">
                    {" "}
                    · {new Date(a.occurred_at).toLocaleString()} · {a.created_by}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
