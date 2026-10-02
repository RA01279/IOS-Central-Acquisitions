// Starting points for an off-market sweep: the industrial nodes where IOS
// clusters in each market. Centres are approximate -- they only aim the search;
// every result is measured from wherever the sweep is actually centred.

export interface Submarket { key: string; label: string; lat: number; lng: number }
export interface Market { key: string; label: string; state: string; submarkets: Submarket[] }

export const MARKETS: Market[] = [
  { key: "houston", label: "Houston", state: "TX", submarkets: [
    { key: "hou-nw", label: "Northwest (US-290 / Beltway 8)", lat: 29.87, lng: -95.55 },
    { key: "hou-n", label: "North (IAH / Aldine)", lat: 29.93, lng: -95.37 },
    { key: "hou-e", label: "East (Ship Channel / Pasadena)", lat: 29.72, lng: -95.18 },
    { key: "hou-sw", label: "Southwest (Stafford / Sugar Land)", lat: 29.62, lng: -95.57 },
    { key: "hou-s", label: "South (Hobby / Pearland)", lat: 29.62, lng: -95.27 },
  ] },
  { key: "dfw", label: "Dallas–Fort Worth", state: "TX", submarkets: [
    { key: "dfw-gsw", label: "Great Southwest (Grand Prairie / Arlington)", lat: 32.77, lng: -97.05 },
    { key: "dfw-sd", label: "South Dallas (I-20 / I-45)", lat: 32.68, lng: -96.76 },
    { key: "dfw-nfw", label: "North Fort Worth (Alliance / Meacham)", lat: 32.87, lng: -97.33 },
    { key: "dfw-st", label: "Stemmons / Northwest Dallas", lat: 32.86, lng: -96.9 },
    { key: "dfw-e", label: "East Dallas / Mesquite", lat: 32.78, lng: -96.62 },
  ] },
  { key: "austin", label: "Austin", state: "TX", submarkets: [
    { key: "aus-se", label: "Southeast (US-183 / SH-71)", lat: 30.21, lng: -97.69 },
    { key: "aus-e", label: "East (US-290 / SH-130)", lat: 30.3, lng: -97.62 },
    { key: "aus-n", label: "North (Pflugerville / Round Rock)", lat: 30.45, lng: -97.65 },
  ] },
  { key: "sa", label: "San Antonio", state: "TX", submarkets: [
    { key: "sa-e", label: "East (I-10 / Loop 410)", lat: 29.43, lng: -98.39 },
    { key: "sa-ne", label: "Northeast (I-35 / Schertz)", lat: 29.55, lng: -98.33 },
    { key: "sa-s", label: "South (I-37 / Brooks)", lat: 29.33, lng: -98.45 },
    { key: "sa-nw", label: "Northwest (Loop 410 / Leon Valley)", lat: 29.5, lng: -98.58 },
  ] },
];

export function findSubmarket(key: string): { market: Market; submarket: Submarket } | null {
  for (const market of MARKETS) {
    const submarket = market.submarkets.find((s) => s.key === key);
    if (submarket) return { market, submarket };
  }
  return null;
}

export interface BuyBox { minAcres: number; maxAcres: number; maxCoveragePct: number }
export const DEFAULT_BUY_BOX: BuyBox = { minAcres: 1.5, maxAcres: 10, maxCoveragePct: 35 };
