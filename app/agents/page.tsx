import Nav from "@/components/Nav";
import AgentWorkspace from "@/components/AgentWorkspace";
export const dynamic = "force-dynamic";
export default function AgentsPage() {
  return <><Nav active="agents" /><main style={{ maxWidth: 1180, margin: "32px auto", padding: "0 24px" }}><AgentWorkspace /></main></>;
}
