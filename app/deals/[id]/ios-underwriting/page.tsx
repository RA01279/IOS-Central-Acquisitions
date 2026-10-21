import { notFound } from "next/navigation";
import { getDeal } from "@/lib/deal-workspace";
import { dealValue, VALUE_BASIS_LABELS } from "@/lib/summary";
import IosUnderwriting from "@/components/IosUnderwriting";

export const metadata = { title: "IOS Underwriting" };

export default async function UnderwritingPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const deal = await getDeal(id);
  if (deal.asset_class === "industrial") notFound();
  const value = dealValue(deal);
  const finitePositive = (v: unknown) => v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
  const lot = finitePositive(deal.properties?.lot_sf);
  const asking = finitePositive(deal.asking_price);
  return <IosUnderwriting seed={{
    id: deal.id,
    property: deal.properties?.address ?? "Untitled IOS property",
    acres: lot === null ? null : lot / 43560,
    price: finitePositive(value.amount) ?? asking,
    priceSource: value.amount != null ? VALUE_BASIS_LABELS[value.basis] : asking !== null ? "asking price" : "not recorded",
  }} />;
}
