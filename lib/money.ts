/** Empty is optional; malformed input must never silently become a price. */
export function parseMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Enter a valid positive dollar amount");
  const text = String(value).trim();
  if (!text) return null;
  const match = /^\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*([kKmM])?$/.exec(text);
  if (!match) throw new Error("Enter a positive amount such as 4,200,000 or $4.2M");
  const multiplier = match[2]?.toLowerCase() === "m" ? 1e6 : match[2]?.toLowerCase() === "k" ? 1e3 : 1;
  const amount = Number(match[1].replace(/,/g, "")) * multiplier;
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER / 100) throw new Error("Enter a valid positive dollar amount");
  return Math.round(amount * 100) / 100;
}

/**
 * A rent or rate rather than a price: "$0.80", ".80", "0.875", "18,500".
 * Up to four decimals and a leading decimal point are fine. Returns null for
 * blank, undefined for anything that isn't a positive number.
 */
export function parseRate(value: unknown): number | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/^\$\s*/, "").replace(/,/g, "");
  if (!text) return null;
  if (!/^(?:\d+(?:\.\d{1,4})?|\.\d{1,4})$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function moneyPreview(value: unknown): string {
  try {
    const amount = parseMoney(value);
    return amount == null ? "" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
  } catch (error) { return (error as Error).message; }
}
