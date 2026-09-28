export interface AssetTransactions {
  status: string;
  purchase_price: number | null;
  purchased_on: string | null;
  sale_price: number | null;
  sold_on: string | null;
  acquisition_costs: number | null;
  selling_costs: number | null;
}

export function saleComparison(asset: Pick<AssetTransactions, "status" | "purchase_price" | "sale_price" | "acquisition_costs" | "selling_costs">) {
  const purchase = Number(asset.purchase_price);
  const sale = Number(asset.sale_price);
  if (asset.status !== "sold" || !Number.isFinite(purchase) || !Number.isFinite(sale) || purchase <= 0 || sale <= 0) return null;
  const costsKnown = asset.acquisition_costs != null && asset.selling_costs != null && Number.isFinite(Number(asset.acquisition_costs)) && Number.isFinite(Number(asset.selling_costs)) && Number(asset.acquisition_costs) >= 0 && Number(asset.selling_costs) >= 0;
  const basis = costsKnown ? purchase + Number(asset.acquisition_costs) : null;
  const proceeds = costsKnown ? sale - Number(asset.selling_costs) : null;
  const netChange = basis !== null && proceeds !== null ? proceeds - basis : null;
  return { change: sale - purchase, percent: (sale - purchase) / purchase * 100, basis, proceeds, netChange, netPercent: netChange !== null && basis !== null ? netChange / basis * 100 : null };
}

function money(value: unknown, label: string, allowZero = false): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`${label} must be a positive dollar amount.`);
  const text = String(value).trim().replace(/^\$/, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) throw new Error(`${label} must be a positive dollar amount with at most two decimal places.`);
  const result = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(result) || (allowZero ? result < 0 : result <= 0) || result > 999999999999.99) throw new Error(`${label} must be ${allowZero ? "zero or greater" : "greater than zero"} and below $1 trillion.`);
  return result;
}

function date(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be a valid date.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} must be a valid date.`);
  return value;
}

/** Merge partial edits before validation so saved dates and prices are never silently discarded. */
export function transactionUpdate(body: Record<string, unknown>, current: AssetTransactions): Partial<AssetTransactions> {
  const update: Partial<AssetTransactions> = {};
  if ("purchasePrice" in body) update.purchase_price = money(body.purchasePrice, "Purchase price");
  if ("salePrice" in body) update.sale_price = money(body.salePrice, "Sale price");
  if ("purchasedOn" in body) update.purchased_on = date(body.purchasedOn, "Purchase date");
  if ("soldOn" in body) update.sold_on = date(body.soldOn, "Sale date");
  if ("acquisitionCosts" in body) update.acquisition_costs = money(body.acquisitionCosts, "Acquisition costs", true);
  if ("sellingCosts" in body) update.selling_costs = money(body.sellingCosts, "Selling costs", true);
  if ("status" in body) {
    if (!["owned", "sold", "under_contract"].includes(String(body.status))) throw new Error("Choose a valid asset status.");
    update.status = String(body.status);
  }
  const merged = { ...current, ...update };
  const saleEdited = "salePrice" in body || "soldOn" in body || ("status" in body && body.status === "sold");
  if (merged.status === "sold" && saleEdited && (!merged.sale_price || !merged.sold_on)) throw new Error("Record both a sale price and sale date for a sold asset.");
  if (merged.status !== "sold" && (merged.sale_price != null || merged.sold_on != null)) throw new Error("An asset with sale details must be marked sold. Clear both sale fields to correct it to owned.");
  if (merged.status !== "sold" && merged.selling_costs != null && merged.selling_costs !== 0) throw new Error("Selling costs belong to a sold asset. Clear them to correct it to owned.");
  if (merged.purchased_on && merged.sold_on && merged.sold_on < merged.purchased_on) throw new Error("Sale date cannot be earlier than purchase date.");
  return update;
}

/** Marketing-site refreshes must preserve a disposal entered by a person. */
export function seededAssetStatus(prior: { status: string } | undefined, sourceSold: boolean) {
  return sourceSold || prior?.status === "sold" ? "sold" : prior?.status === "under_contract" ? "under_contract" : "owned";
}
