import OfflineList from "@/components/OfflineList";

// Served by the service worker when a page isn't in the cache and there's no
// connection. Static, and excluded from the auth middleware, so it can be
// precached at install time.
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main style={{ maxWidth: 560, padding: "48px 20px" }}>
      <img src="/logo-navy.svg" alt="Dalfen" style={{ height: 16, marginBottom: 24 }} />
      <h1>You&apos;re offline</h1>
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
        This page hasn&apos;t been saved to this device yet. The deals you opened most recently are available
        offline; anything you change syncs when the connection returns.
      </p>
      <OfflineList />
    </main>
  );
}
