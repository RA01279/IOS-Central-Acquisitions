# Outlook deal intake

Proposed workflow: Outlook `Hopper Intake` folder → extraction → duplicate review → create Prospect.

## Existing Hopper integration points

- `lib/deals.ts:createDeal()` creates the property, acquisition deal at Prospect, MLA record when supplied, contacts and events. Both IOS and Industrial are supported.
- `app/api/deals/route.ts` requires a signed-in Hopper user. An unattended worker needs its own authenticated entry point; never put the Supabase service key in an Outlook flow.
- Current intake does not deduplicate messages or properties. `createDeal()` performs multiple writes without one database transaction. Reliable automatic retries require atomic promotion or a recoverable workflow before unattended creation is enabled.
- `lib/comps/parse.ts` already handles broker email tables for comps. It is not a general new-deal extractor.

## Recommended first release

1. Connect the selected Microsoft 365 mailbox with delegated read access. Select a folder and an explicit start date so historical mail is not imported accidentally.
2. Poll that folder using Microsoft Graph delta queries. Persist pagination and delta checkpoints only after messages are durably saved. Handle expired cursors, token refresh, throttling and retry failures.
3. Store each source message with a unique mailbox + internet-message-ID key (immutable Graph ID fallback), sender, subject, received date, Outlook link and processing state. Reprocessing a message must not create a second intake record.
4. Extract one candidate per property: address, city/market, IOS or Industrial, acres, building SF, broker and stated asking price. Retain source excerpts and explicit missing fields. Store asking price separately from offers, contract price and closed price. Treat email/attachment content as data, never as instructions to the worker.
5. Compare normalized address/location against properties, live deals and prior intake candidates. A repeated marketing email should link to the existing deal. Ambiguous matches and multi-property emails go to review.
6. Show a Hopper review queue with editable extracted fields and actions: **Add Prospect**, **Link to existing deal**, **Ignore**. Promotion must be idempotent and preserve source provenance.
7. Add automatic Prospect creation only after reviewing real extraction results. Restrict it to explicitly chosen sources and sufficiently complete, unambiguous candidates. Never advance deals beyond Prospect automatically.

Start with email text. Add PDF/OM attachment extraction as a second step, including file size/type limits, source retention and visible failure states. Broker contact extraction should link email identities without overwriting existing contact data blindly.

## Connection options

| Option | Best use | Setup/tradeoff |
| --- | --- | --- |
| Microsoft Graph folder sync | Durable in-app integration; folder moves and backfill | Entra app registration, delegated Mail.Read consent, encrypted refresh-token storage and a scheduler. Tenant policy may require IT consent. Read access covers the mailbox even when the application processes only the selected folder. |
| Power Automate → Hopper ingestion endpoint | Fast pilot when tenant licensing permits | Outlook trigger plus authenticated HTTP delivery. Verify connector licensing and tenant policy. New-email triggers can miss moved historical messages and may deliver twice, so retain deduplication and reconciliation. |
| Paste/drop email into Hopper | Fastest fallback if mailbox integration is blocked | Reuse the review/extraction flow with manual submission. No continuous mailbox sync. |

The Outlook connector available to this Codex conversation can assist a bounded import; it is not a deployed background integration for Hopper.

## Decisions needed before connecting

- Personal work mailbox or shared acquisitions mailbox, and which folder should feed intake?
- Is an Entra app registration available, or is Power Automate the allowed integration route?
- Start with one-click review (recommended) or explicitly defined automatic-creation rules?

## Microsoft references

Verified September 9, 2026:

- [Message delta API](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
- [Office 365 Outlook connector and limitations](https://learn.microsoft.com/en-us/connectors/office365/)
- [Email trigger troubleshooting](https://learn.microsoft.com/en-us/power-automate/email-troubleshooting)

This is an implementation proposal. No mailbox sync or automatic creation is enabled by this document.
