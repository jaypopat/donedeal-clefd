# Tyrekick — high-level architecture

Version: 0.2 · 20 October 2026 · Current prototype architecture

[The product specification](product-spec.md) is the source of truth for scope. This version supersedes the earlier D1-backed design. The application is currently a WXT + React starter; this document describes the proposed implementation.

## Shape

**WXT + React extension → one Cloudflare Worker → Workers AI.**

The extension reads loaded search cards, renders badges, and caches results locally. The Worker validates inputs, normalises facts, calculates search-relative prices, and runs evidence-backed text checks. No D1, KV, shared cache, seed corpus, or collected listing database is required for the first prototype.

```text
DoneDeal results opened by buyer
  → content script reads loaded cards and mounts badges
  → background checks local caches and batches missing work
  → Worker receives targets and current comparison context
       ├─ price: filter supplied candidates → calculate price signals
       └─ warnings: Clairic extraction → Clef checks → evidence validation
  → structured results → local cache → correct card/popover

Buyer opens a detail page
  → read description → deepen warning checks
  → reuse matching saved search-relative price, if available
```

Clairic and Clef are used where text needs interpretation. Explicit card fields and price arithmetic use deterministic code. Provider credentials stay in the Worker.

## Content script

Use a DoneDeal adapter for supported HTTPS Cars routes. It extracts canonical listing IDs, asking prices, vehicle facts, seller type, and available detail text. Exact live selectors and field coverage still need inspection.

- Observe new or changed cards with a debounced MutationObserver and prioritise visible cards with IntersectionObserver.
- Identify each card by listing ID and content fingerprint. Ignore Tyrekick's own mutations.
- Mount a compact React badge/popover UI in a WXT shadow-root UI, preserving the original card's navigation.
- Handle search/navigation changes and reused nodes; discard responses for outdated card identities or search snapshots.
- Read detail descriptions when the buyer opens the ad. Do not automatically fetch every listing.
- Use local explanation templates and escaped source excerpts.
- Unmount UI and observers when the extension context is invalidated.

The popup contains enable/pause and clear-local-data controls.

## Search context

A search context is a snapshot of the loaded result cards in one tab and one active search/navigation state. It contains a locally generated context ID, an observation time, candidate facts, and a deterministic fingerprint.

The fingerprint covers the normalised candidate identities and price/matching fields, sorted canonically. It changes when relevant facts or the candidate set change. The server recomputes it from the submitted context.

Filtering, sorting, pagination, and new searches reset the context. Infinite scroll adds candidates to the active context, deduplicated by listing ID. Only loaded candidates count; never imply that the full advertised result count was analysed.

Start with a bounded context of up to 100 loaded cards. If the view exceeds the cap, use an explicitly limited subset of loaded results and disclose the sample count. Selection must be stable for the same snapshot and must not depend on a favourable price conclusion. Validate the cap and subset policy during the browsing spike.

Opening a detail page can carry a recent originating-search assessment through extension storage. A direct visit without that context has insufficient price data, while warning checks still work.

## Background worker and local caching

The extension background worker owns API calls, context routing, and persistent local extension storage. Its in-memory queue is disposable; the active page can resubmit missing work after suspension.

Batch at most 20 targets per request and include their bounded comparison context. Start with at most two in-flight requests. Validate and tune these proposed limits against actual payload sizes and latency.

Keep price and warning caches separate:

- Warning key: listing ID + relevant content hash + coverage + model/policy/schema version.
- Price key: listing ID + target fact hash + comparison-context hash + pricing-policy version.

Changing the comparison set reruns the price calculation without repeating unchanged warning analysis. A content change triggers a new warning check. The extension only sends missing work; the API supports requesting price, warnings, or both.

Use a bounded local cache, initially 200 assessments and a small number of recent search contexts. Start with a 30-minute TTL, subject to measurement. Store expiry, evidence time, context fingerprint and policy versions with each result. Data is local to that browser profile; different users may pay for duplicate analysis.

A cached detail check may enrich a card only while it is fresh and the overlapping facts agree. The card cannot prove that the description is unchanged; show the observation time. A detail-page price must retain its originating search scope.

Changing search context invalidates old price labels immediately. Cancel queued work where possible and ignore in-flight responses from old snapshots. Failed requests do not become successful cached assessments. Pause stops new analysis; clear-local-data removes contexts and results.

## Worker API

One synchronous endpoint, `POST /v1/assess`, is sufficient. The Worker holds request data only while processing; it does not persist listings or assessments.

The application contract contains:

- Request/schema version and current policy version.
- Current context ID, comparison candidates and observation time for price work.
- Target listing IDs, canonical URLs, structured facts, coverage, and requested branches.
- Redacted, length-limited listing text for text analysis.
- Optional extracted claims/evidence only when validated as untrusted client input.

Return per-target results:

- Listing identity, target fingerprint and comparison-context fingerprint.
- Price status: ready / insufficient data / unavailable.
- Price label: great price / typical price / expensive, or no label.
- Reference asking price, descriptive spread, match count and comparable references.
- Warning status, Suspicious or Check details label where justified, reason codes and source evidence.
- Card/detail coverage, evidence time, assessment time, expiry and policy versions.
- A typed per-target error when needed; one failed target must not fail the whole batch.

These are proposed application fields, not Cloudflare provider schemas. The concrete runtime-validated schemas are an implementation task.

Processing:

1. Enforce request-size, target-count, candidate-count and text limits.
2. Validate identities, source URLs, field types and requested policy versions; recompute fingerprints.
3. Normalise currency, mileage units and known vehicle facts, preserving unknowns.
4. Run requested price and warning branches independently.
5. Validate findings and evidence, apply display policy, and return results.

The browser and client timestamps are untrusted inputs. They scope a private comparison; they do not establish listing authenticity. There is no shared benchmark that a submission can modify.

## Price branch

Operate on candidates supplied with the current search context. Match make/model, fuel, transmission and seller type, then similar year and mileage. Use variant/generation/body/engine/battery information where material. Unknown essential fields may prevent a comparison.

Exclude the target, duplicate ads, non-cash prices, damaged/parts-only vehicles and mismatches. Use the product spec's initial five-match minimum, median-based calculation, tentative ±15% label boundaries, and uncertainty/dispersion gates.

Return comparable identities, observation time, count and the limited scope: **Compared with this search**. Never call the median a whole-market valuation or a realised sale price.

All calculations are ordinary code. No database query, external marketplace request, embedding lookup, or model-estimated market price is involved.

## Warning branch

**Clairic:** extract text claims, such as mileage mentions, service-history statements and payment/viewing conditions. Preserve missing values and trace claims to exact spans in the redacted input.

**Clef:** assess narrowly defined questions using the listing facts and relevant text evidence: contradictory mileage, explicit payment-before-viewing demands, and seller-type inconsistencies.

Skip model work when no relevant text or adequate evidence is available. Do not turn limited cards into a full-history verdict.

Both adapters call Workers AI server-side. Version extraction schemas, decision questions, thresholds and display policy. Evaluate actual access, latency and output behaviour before locking provider details.

The policy layer validates spans/fields and maps evidence-backed decisions to reason codes. Unsupported model outputs are rejected. The UI uses short templates rather than generated essays. Internal model probabilities are not presented as measured fraud probabilities.

Listing instructions are untrusted content. The models have a fixed analysis task and no tools or external actions. Include adversarial text in evaluation fixtures.

## Privacy and operating controls

Explain data use before automatic analysis. Read only supported pages the user opens. Send necessary vehicle facts and redacted listing text; strip phone numbers, email addresses and unnecessary personal details. Do not collect cookies, messages, seller contact profiles, VINs, plates or images for this prototype.

Use HTTPS and Worker-held model bindings/secrets. Request only DoneDeal/API host access and extension storage. Do not rely on an embedded API key or extension-origin checks as strong authentication.

For the initial experiment, keep the Worker restricted to development/private testers and configure request limits and provider spend controls. Before a public rollout, decide how to enforce abuse limits and access control without assuming that an anonymous extension is a trusted client.

Do not log raw descriptions, full request bodies, or browsing trails. The Worker keeps analysis inputs in memory for the request; local assessments and contexts expire and are bounded. Operational metrics contain counts, latency, tokens and error codes. No shared browsing-contribution system or feedback database is needed initially.

The API does not fetch supplied listing or image URLs. URLs are validated DoneDeal references for the UI.

## Validation and first build

1. Inspect real cards/details, confirm fields, and save sanitised fixtures.
2. Build overlay placement, explanations and page lifecycle with labelled example data.
3. Implement local extraction and the search-relative price branch.
4. Connect the Worker and model adapters; add evidence validation and local caching.
5. Exercise the full loop during real searches and measure usefulness, latency and spend.

Check unit conversions, finance prices, sparse/mixed cohorts, duplicate ads, search resets, infinite scroll, target edits, cache expiry, direct detail visits, worker suspension, out-of-order responses and independent branch failures.

Keep reviewed model examples separate from tuning examples. Count evidence errors, warning false positives/negatives, price coverage and cohort instability. Exact scoring thresholds remain provisional.

## Suggested repository shape

```text
entrypoints/
  content/             parsing, search context, badge lifecycle
  background.ts        local storage, batching, API communication
  popup/               enable/pause and clear data
components/            BadgeRow, AssessmentPopover
lib/
  donedeal/            card/detail adapters and identities
  contracts/           request/result schemas
  cache/               keys, expiry and local storage
server/
  src/
    index.ts           Worker route
    pricing/           filtering, statistics and abstention
    models/            Clairic/Clef adapters
    assessment/        orchestration and evidence policy
fixtures/              sanitised DOM and reviewed examples
docs/                  current product and architecture
```

Keep the backend's configuration separate from the extension, sharing only runtime-neutral contracts. No migrations, import scripts, or storage service are part of the initial build.

## Add complexity when justified

- Shared caching if measured repeat inference across users is costly.
- A persistent comparison dataset if search-relative signals prove too limited.
- D1 or another queryable store if that dataset needs ongoing collection and flexible filtering.
- Additional infrastructure only for a measured workload requirement.

The current experiment remains one Worker, the existing extension, and local browser caching.

## Technical references

Capabilities were checked on 20 October 2026. Application choices and limits above are design proposals.

- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [WXT UI and lifecycle](https://wxt.dev/guide/essentials/content-scripts.html)
- [Clairic](https://developers.cloudflare.com/workers-ai/models/clairic/)
- [Clef](https://developers.cloudflare.com/workers-ai/models/clef/)
