import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Nav from "@/components/Nav";
import SourcingWorkspace from "@/components/SourcingWorkspace";

export const dynamic = "force-dynamic";

export default async function SourcingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <>
      <Nav active="sourcing" />
      <main style={{ maxWidth: 1180, margin: "32px auto", padding: "0 24px" }}>
        <SourcingWorkspace viewerKey={user.email.toLowerCase()} />
      </main>
    </>
  );
}
