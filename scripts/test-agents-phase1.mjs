// scripts/test-agents-phase1.mjs
//
// Tests the helper's agent runner (scripts/outlook-helper/agents.mjs) without
// calling Codex: settings, the fact-check pass and its fallbacks, which agents
// are checked, and that the web-search list matches Hopper's
// (lib/agents/catalog.ts WEB_SEARCH_AGENTS).
//   node scripts/test-agents-phase1.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentSettings, runAgent, sameShape, verifyPrompt, VERIFY, WEB_SEARCH } from "./outlook-helper/agents.mjs";

// Settings: strong defaults, flags beat environment, junk falls back.
assert.deepEqual(agentSettings(() => undefined, {}), { reasoning: "high", concurrency: 3, model: null, verify: true });
const flags = { "--agent-reasoning": "XHIGH", "--agent-concurrency": "5", "--agent-model": "gpt-5.6", "--agent-verify": "off" };
assert.deepEqual(agentSettings((n) => flags[n], { HOPPER_AGENT_REASONING: "low" }), { reasoning: "xhigh", concurrency: 5, model: "gpt-5.6", verify: false });
assert.deepEqual(agentSettings(() => undefined, { HOPPER_AGENT_REASONING: "max", HOPPER_AGENT_CONCURRENCY: "40", HOPPER_AGENT_MODEL: "bad model; rm" }), { reasoning: "high", concurrency: 3, model: null, verify: true });

// Web-search list is the same in Hopper and the helper.
const catalog = readFileSync(new URL("../lib/agents/catalog.ts", import.meta.url), "utf8");
const listed = JSON.parse(catalog.match(/WEB_SEARCH_AGENTS: readonly AgentId\[\] = (\[[^\]]*\])/)[1]);
assert.deepEqual([...WEB_SEARCH].sort(), [...listed].sort(), "helper and Hopper agree on which agents may search the web");
for (const id of ["deal-import", "comp-import", "portfolio-import", "market-report"]) assert(!WEB_SEARCH.has(id) && !VERIFY.has(id), `${id} reads documents only`);

// Format checks.
const draftJson = JSON.stringify({ version: 2, sites: [{ ref: "S1", owner: "ACME LLC" }, { ref: "S2", owner: null }] });
assert(sameShape(draftJson, JSON.stringify({ version: 2, sites: [{ ref: "S1", owner: "ACME HOLDINGS LLC" }, { ref: "S2", owner: null }], extra: 1 })));
assert(!sameShape(draftJson, JSON.stringify({ version: 2, sites: [{ ref: "S1", owner: "x" }] })), "a dropped site is a format change");
assert(!sameShape(draftJson, "## markdown now"), "JSON contract must stay JSON");
assert(sameShape("# Markdown report", "# Corrected markdown"));
assert(!sameShape("# Markdown report", "  "));
const vp = verifyPrompt("TASK-TEXT", { report: draftJson, model: "m", limitations: [] }, true);
assert(vp.includes("TASK-TEXT") && vp.includes("ACME LLC") && /cite the URL/.test(vp));
assert(!verifyPrompt("T", { report: "r", limitations: [] }, false).includes("cite the URL"));

// The runner, with a fake Codex.
const settings = { reasoning: "high", concurrency: 3, model: null, verify: true };
const job = (agent, prompt = "PROMPT") => ({ id: "j", agent, prompt });
const fake = (...outputs) => { const calls = []; const run = async (prompt, opts) => { calls.push({ prompt, opts }); const o = outputs[calls.length - 1]; if (o instanceof Error) throw o; return { result: o, usage: { input_tokens: 10, output_tokens: 1 } }; }; return { run, calls }; };
const draft = { report: draftJson, model: "m", limitations: ["Owner unconfirmed"] };
const checked = { report: JSON.stringify({ version: 2, sites: [{ ref: "S1", owner: "ACME HOLDINGS LLC" }, { ref: "S2", owner: null }] }), model: "m", limitations: ["Fact-check: corrected S1 owner from the appraisal roll"] };

{ // Research agent: draft, then a checked version replaces it; usage adds up; web on for both passes.
  const { run, calls } = fake(draft, checked);
  const out = await runAgent(job("off-market-sourcing"), undefined, settings, run);
  assert.equal(calls.length, 2);
  assert(calls.every((c) => c.opts.web === true && c.opts.settings.reasoning === "high"));
  assert(calls[1].prompt.includes("PROMPT") && calls[1].prompt.includes("ACME LLC"), "the checker sees the task and the draft");
  assert.equal(JSON.parse(out.result.report).sites[0].owner, "ACME HOLDINGS LLC");
  assert.deepEqual(out.usage, { input_tokens: 20, output_tokens: 2 });
}
{ // Checker breaks the format: keep the draft and say so.
  const { run } = fake(draft, { ...checked, report: "not json" });
  const out = await runAgent(job("off-market-sourcing"), undefined, settings, run);
  assert.equal(out.result.report, draftJson);
  assert(out.result.limitations.some((l) => /Not fact-checked/.test(l)));
}
{ // Checker fails outright: same.
  const { run } = fake(draft, new Error("codex down"));
  const out = await runAgent(job("site-research"), undefined, settings, run);
  assert.equal(out.result.report, draftJson);
  assert(out.result.limitations.some((l) => /Not fact-checked/.test(l)));
}
{ // A checker that changed nothing still says it ran.
  const { run } = fake(draft, { ...draft, limitations: [] });
  const out = await runAgent(job("ic-narrative"), undefined, settings, run);
  assert(out.result.limitations.includes("Fact-check: completed."));
}
{ // Document readers: one pass, no web.
  const { run, calls } = fake(draft);
  await runAgent(job("comp-import"), undefined, settings, run);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.web, false);
}
{ // Fact-check switched off, or the source too big for a second pass.
  let { run, calls } = fake(draft);
  await runAgent(job("off-market-sourcing"), undefined, { ...settings, verify: false }, run);
  assert.equal(calls.length, 1);
  ({ run, calls } = fake(draft));
  const out = await runAgent(job("off-market-sourcing", "x".repeat(260000)), undefined, settings, run);
  assert.equal(calls.length, 1);
  assert(out.result.limitations.some((l) => /too large/.test(l)));
}
await assert.rejects(runAgent(job("delete-everything"), undefined, settings, fake().run), /Invalid agent job/);

console.log("PASS: helper agent runner (settings, fact-check pass and fallbacks, document readers single-pass, web-search list matches Hopper).");
