# Outlook imports in Hopper

Hopper uses the Outlook Email plugin already connected to the local Codex CLI. No Microsoft Entra app registration or new Microsoft token is required.

## Start on Windows

1. Sign in to Codex CLI with the personal ChatGPT account that has Outlook Email connected. The Outlook connection owner must match your Hopper login email.
2. In Hopper, open Comps, select Outlook, and generate a pairing code.
3. In the Hopper project folder run `npm run outlook:helper -- --pair`. Paste the code at the prompt.
4. Leave the helper running. Subsequent starts use `npm run outlook:helper`.
5. Search in Hopper, select a message, review every sale/lease row, and save. Upload spreadsheet attachments separately.

Disconnect helper in Hopper revokes the credential and removes queued email results. A replacement code invalidates the previous code. Pairing expires after 90 days. On Windows the helper credential is encrypted using Windows DPAPI for the current user in `%USERPROFILE%/.hopper-outlook/connection.json`. Microsoft/ChatGPT credentials never leave Codex. Do not share the pairing code.

## Implementation

The helper uses Codex App Server stdio and an ephemeral read-only thread. It calls only Outlook search_messages and fetch_message; no model turns, shell execution, sending, or mailbox changes are exposed. Unrecognized approval requests are rejected. No email contents are logged by the helper.

Hopper server routes authenticate the user or scoped helper credential. Queue tables have RLS enabled and no anon/authenticated grants; only server routes access them. Search results and full bodies expire after 15 minutes, and expired payloads are removed on the next request or helper poll. The helper runs every four seconds while online. Only message IDs from that user's recent search results can be fetched. Selected email bodies pass into the existing parser and review UI; only the normal reviewed save creates comps in Supabase.

The helper depends on installed Codex App Server compatibility. Tested with Codex CLI 0.154.0. Official interface: https://learn.chatgpt.com/docs/app-server

## Local verification

Apply the outlook_helper migration before using these endpoints. For development, run `npm run outlook:helper -- --pair --url http://localhost:3012`. Development pairing is stored separately. No browser-to-localhost connection is needed: both the browser and helper talk to Hopper.
