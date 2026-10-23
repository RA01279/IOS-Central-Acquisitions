export type RateUnit = "per_100" | "mills" | "percent" | "decimal";
export type Metric = "market" | "assessed" | "taxable" | "exemptions" | "levied" | "paid" | "balance" | "penalties" | "interest" | "dueDate" | "delinquency" | "appeal";
export const METRICS: Metric[] = ["market", "assessed", "taxable", "exemptions", "levied", "paid", "balance", "penalties", "interest", "dueDate", "delinquency", "appeal"];
export interface TaxSource { id: string; label: string; url: string; retrievedAt: string; taxYear: number | null; taxYears?: number[]; kind: "official" | "manual" | "upload"; evidence: string; storagePath?: string; captureMethod?:'user_import' }
export interface Fact { value: number | string | null; sourceId: string; stage: "proposed" | "adopted" | "issued" | "reported"; reviewed: boolean; previous?: number | string | null }
export interface Jurisdiction { name: string; rate: number; unit: RateUnit; taxable: number | null; exemption: number | null; sourceId: string; stage: "proposed" | "adopted" }
export interface BillEvidence { kind: 'issued_statement' | 'collector_history'; sourceId: string; scope: string; notes: string; collectorAccount?: string }
export interface TaxRecord { parcelKey: string; year: number; facts: Partial<Record<Metric, Fact>>; jurisdictions: Jurisdiction[]; billEvidence?: BillEvidence }
export interface TaxParcel { key: string; accountId: string; county: string; state: string; address: string; owner: string; legal: string; sourceIds: string[]; matchEvidence: string[]; review: "pending" | "included" | "excluded"; reviewNote: string; component: "combined" | "land" | "building" | "unknown"; assessmentGroup: string; identityOverride?: boolean }
export interface TaxRules { jurisdiction: string; sourceIds: string[]; notes: string; reviewed: boolean }
export interface TaxOverride { parcelKey: string; year: number; metric: Metric; value: number | string | null; sourceId: string; reason: string; stage?: Fact["stage"] }
export interface ProjectionYear { year: number; market: number; ratio: number; exemption: number; growth: number; cap: number | null; capThrough: number | null; rate: number; unit: RateUnit; special: number; reimbursement: number; grossOverride: number | null; reassess: boolean }
export interface ParcelProjection { parcelKey: string; rows: ProjectionYear[] }
export interface TaxScenario { id: "continuation" | "acquisition" | "custom"; name: string; startYear: number; hold: number; notes: string; rulesReviewed: boolean; parcels: ParcelProjection[] }
export interface TaxResearchAttempt { parcelKey:string; status:'retrieved'|'blocked'|'unsupported'|'failed'; message:string; sourceUrl?:string }
export interface TaxState { version: 1; parcels: TaxParcel[]; records: TaxRecord[]; overrides: TaxOverride[]; sources: TaxSource[]; rules: TaxRules[]; scenarios: TaxScenario[]; research: { at: string; status: "partial" | "complete"; gaps: string[]; attempts?:TaxResearchAttempt[] } | null }
export const emptyTaxState = (): TaxState => ({ version: 1, parcels: [], records: [], overrides: [], sources: [], rules: [], scenarios: [], research: null });
export interface TaxSchedule { scenario: string; startYear: number; gross: number[]; reimbursements: number[]; provenance: string; appliedAt: string }
