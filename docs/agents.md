# Hopper agents

Open **Agents** in Hopper. Six assistants generate draft reports from the selected deal, recorded comps/underwriting summaries and pasted source text. Every run has a saved URL (`/agents?run=<id>`) and a downloadable Markdown report.

## Local helper

This extends the existing Outlook helper and reuses its owner-scoped pairing. Start `npm run outlook:helper`; if not paired, generate a pairing code in Comps and start `npm run outlook:helper -- --pair`. Keep the computer and helper running. It requires a current Codex CLI supporting `exec --ignore-user-config` and an active Codex sign-in.

The report worker uses a fresh temporary directory, read-only sandbox, and disables shell, plugins, apps and subagents. Only Site Research enables web search. It receives a bounded evidence snapshot; it cannot change deals or send messages. Failed delivery retries the same result instead of repeating generation. Stopping the process during generation may lose that unfinished result; stale runs fail after 20 minutes.

## Install

Apply `20260929205444_hopper_agents.sql` after the existing Outlook helper migration, deploy the app changes, and restart the updated helper. No new AI API key is needed. Model usage is charged against the user's existing Codex allowance; the runner saves reported token usage, not an invented dollar estimate.

## Initial scope

- Intake produces a review draft; use the existing New Deal/Comps flows to save records.
- Comp analysis uses the latest 100 entered comps in the subject market (all markets if no market is set), and states that coverage.
- Pipeline uses the latest 500 updated deals, contractual dates and timestamps. It does not scan the mailbox automatically or schedule daily runs.
- Site research cites public web evidence and flags unverified zoning/flood/access findings.
- Underwriting reviews stored summaries and supplied text. It does not open or recalculate the approved Excel model; scenarios are requests for the analyst to run unless outputs are supplied.
- Memo drafts are based on recorded evidence, not independent investment approval.
- Paste extracted document text for this release; binary PDF/Excel attachments are not read by the report generator.

Reports are private to the requesting Hopper account. The existing application treats deal records as shared across authenticated workspace users. Database tables have RLS enabled and no browser grants; server routes enforce run ownership. Disconnecting the helper revokes access. Reports survive disconnection.

Validation: `node scripts/test-agents.cjs`, `npm run typecheck`, and a synthetic Codex report followed by authenticated queue/run/report verification.
