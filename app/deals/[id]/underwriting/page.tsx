// app/deals/[id]/underwriting/page.tsx
//
// Underwriting tab: Hopper's screening engine on this deal's own inputs --
// the Excel model's rent roll, debt and costs where there is one, else the
// deal and its comps -- editable, checked against the comps, compared with
// the Excel model, and saveable as a run (components/UwScreen). The Excel
// model stays the approved underwriting.
//
// Hidden behind NEXT_PUBLIC_UW_ENGINE_TAB=screen; without it the route 404s
// and the tab is not shown. ("screen", not "1": production carries a
// leftover "1", and the tab is turned on deliberately.)

import { notFound } from "next/navigation";
import { getDeal } from "@/lib/deal-workspace";
import { listRuns, screenFor } from "@/lib/uw-screen";
import UwScreen from "@/components/UwScreen";

export const metadata = { title: "Underwriting" };

export default async function UnderwritingPage(props: { params: Promise<{ id: string }> }) {
  if (process.env.NEXT_PUBLIC_UW_ENGINE_TAB !== "screen") notFound();
  const { id } = await props.params;
  const deal = await getDeal(id);
  const [screen, runs] = await Promise.all([screenFor(deal), listRuns(deal.id)]);

  return (
    <UwScreen
      dealId={deal.id}
      initial={screen.build}
      comps={screen.comps}
      model={screen.model ? { versionNumber: screen.model.versionNumber, snapshot: screen.model.snapshot } : null}
      modelPending={screen.modelPending}
      ios={deal.asset_class !== "industrial"}
      runs={runs}
    />
  );
}
