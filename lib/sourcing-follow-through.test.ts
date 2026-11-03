import {it,expect,vi} from "vitest";
vi.mock("./supabase",()=>({getServiceClient:()=>null}));vi.mock("./deals",()=>({logDealEvent:async()=>{}}));vi.mock("./webhooks",()=>({fireStageChangeWebhook:async()=>{}}));vi.mock("./auth",()=>({canConfirmPsa:()=>true}));
import {restoredFollowUp} from "./deal-archive";
import {parseDealImport} from "./agents/deal-import";
it("retains Darien's explicit source deadline but does not invent dates for ambiguous source text",()=>{
 const fields={address:"4732 Darien St",callForOffersOn:"2026-10-14",deadlineSourceDate:"2026-10-06",deadlineSourceQuote:"Call for offers October 14, 2026"};
 const result=parseDealImport(JSON.stringify({fields}));expect(result?.fields.callForOffersOn).toBe("2026-10-14");expect(result?.fields.deadlineSourceQuote).toBe(fields.deadlineSourceQuote);
 for(const value of ["October 14","next Wednesday","2026-02-30"]){const ambiguous=parseDealImport(JSON.stringify({fields:{...fields,callForOffersOn:value}}));expect(ambiguous?.fields.callForOffersOn).toBeNull();expect(ambiguous?.notes.join(" ")).toMatch(/needs review/);}
});
it("restoration preserves Gulf's former disposition and date but requires new follow-through",()=>{
 const d={assigned_analyst:"owner",disposition:"passed",follow_up_on:"2026-09-01",death_reason:"Pricing/capex",death_stage:"uw",investment_review:{rationale:"Review repricing"}};
 const next=restoredFollowUp(d,"analyst");expect(next.disposition).toBeNull();expect(next.follow_up_on).toBeNull();expect(next.investment_review.nextAction).toBeNull();expect(next.investment_review.reopenedFrom).toMatchObject({disposition:"passed",followUpOn:"2026-09-01",reason:"Pricing/capex"});expect(d.follow_up_on).toBe("2026-09-01");expect(next.investment_review.rationale).toBe("Review repricing");
});
