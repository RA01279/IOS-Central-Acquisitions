import type { UwInputs } from "../ios-uw/types";
import type { TaxSchedule } from "./types";
/** Replaces the existing tax line; never adds taxes to OtherOpex. */
export function applyTaxSchedule(inputs: UwInputs, schedule: TaxSchedule, embeddedTax: number, reviewed: boolean): UwInputs {
  if (!reviewed) throw new Error("Review the gross-tax, reimbursement and existing-expense treatment before applying.");
  if (!Number.isFinite(embeddedTax) || embeddedTax < 0 || !Number.isFinite(inputs.OtherOpex) || embeddedTax > inputs.OtherOpex) throw new Error("Enter the annual property tax amount already included in other expenses; it cannot exceed OtherOpex.");
  if (schedule.gross.length!==inputs.Hold+1 || schedule.reimbursements.length!==schedule.gross.length) throw new Error("Tax schedule hold must match underwriting, including the forward exit year.");
  if (!Number.isInteger(schedule.startYear) || schedule.startYear<1900 || !schedule.provenance.trim()) throw new Error("Tax schedule needs its year and assumptions.");
  schedule.gross.forEach((gross,i)=>{const recovery=schedule.reimbursements[i]; if(!Number.isFinite(gross)||gross<0||!Number.isFinite(recovery)||recovery<0||recovery>gross)throw new Error("Invalid gross tax or reimbursement.");});
  return {...inputs,TaxSchedule:structuredClone(schedule),OtherOpex:inputs.OtherOpex-embeddedTax};
}
