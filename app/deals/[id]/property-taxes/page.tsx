import { getDeal } from "@/lib/deal-workspace";
import PropertyTaxes from "@/components/property-taxes/PropertyTaxes";
export const dynamic="force-dynamic";
export const metadata={title:"Property Taxes"};
export default async function TaxPage(props:{params:Promise<{id:string}>}) {
  const {id}=await props.params,deal=await getDeal(id);
  return <PropertyTaxes dealId={id} address={deal.properties?.address??"Untitled property"} ios={deal.asset_class!=="industrial"}/>;
}
