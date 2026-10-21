# Implementation contract

## Selected shape

Two independent sketches and a third-model judge agreed on page-owned DOM state, background-owned transport and storage, and Worker-owned assessment. Use the Codex sketch's explicit result identities and clear generations. Use the Claude sketch's Bun tests and local-only development Worker. Keep all batches at 20 targets or fewer.

The content script submits an observation and receives two independent branches. Price can be ready, a neutral reference, insufficient, or unavailable. Warnings can be checked, limited by coverage, or unavailable. The UI must never interpret a failed check as a clean result. Derive types from runtime schemas. Keep core calculations and display policy pure.

## Ownership

- The DoneDeal adapter owns canonical identity, allowlisted facts, description coverage, and privacy filtering.
- The content controller owns card bindings, document and search identities, snapshot revisions, observers, and shadow-root UI.
- The background owns settings, validated runtime messages, request scheduling, bounded caches, context provenance, and storage writes.
- The Worker owns HTTP validation, normalization, price calculations, model calls, and evidence policy.

Use ordinary modules rather than a generic framework. Keep request, result, cache, and lifecycle states explicit. Validate inputs at each external boundary, including runtime messages and storage reads.

## Invariants

1. No analysis or transmission precedes consent. Redact free-text titles and descriptions before messages, hashes, storage, or requests. Never collect whole-page HTML or contact/profile areas at runtime.
2. Enumerate real DOM cards, including promoted cards. Join page data by listing ID. Preserve unknown matching fields. A cash price remains valid when a separate finance offer is displayed.
3. Cards and details use exact submitted fingerprints for asynchronous response acceptance. Reusing detail evidence instead checks agreeing overlapping facts, freshness, and identity. Extra known detail fields must not break enrichment by whole-object hash equality.
4. Price reuse requires explicit originating-search provenance. A direct detail visit has insufficient price data. Never use the most recent global search as a fallback.
5. Search changes remove old price labels immediately. Growing cohorts can rerun price without repeating unchanged text checks. Reject old document, context, target, and generation responses.
6. The background serializes storage writes. Pause stops new work and cancels pending work where possible. Clear increments a persisted generation, clears contexts and assessments, informs pages, and rejects late results and cache writes.
7. Bound snapshots to 100 candidates, batches to 20 targets, concurrent requests to two, and assessments to 200 combined entries. Start with a 30-minute TTL and retain evidence time. Do not cache service errors.
8. Validate body size while reading, canonical HTTPS DoneDeal URL and ID agreement, schema and policy versions, numeric ranges, per-target identity, and provider output. Keep branch and target errors independent.
9. Every displayed warning has validated exact text spans or structured source evidence and a fixed explanation template. Model probabilities remain internal. Include benign and adversarial counterexamples.
10. Local development binds to loopback and requires explicit development configuration plus a configured allowed extension origin. Hosted requests fail closed until private access is configured. Origin checks alone are not hosted authentication. Do not embed credentials or shared API keys in the extension.

## Acceptance

Provide focused parser, redaction, pricing, evidence, response-identity, pause, clear-race, and expiry tests. Provide a repeatable installed-extension browser check and a local Worker smoke check. Distinguish fixture tests, real-page extension checks, and real model calls in verification reports.

The local Worker must be able to call real Clairic and Clef without a public deployment. Document configuration and startup commands. Verify the actual provider binding or REST adapter, because the existing cf login does not establish Wrangler authentication.

Keep scoped commits, no co-author trailers, and no deployment in this build. The coordinator integrates and independently reviews the committed result.
