# Tyrekick — product specification

Version: 0.2 · 20 October 2026 · Current scope for the first prototype

**This file is the source of truth for product scope.** This version supersedes the earlier database-backed design. Read [the architecture](architecture.md) for the technical approach.

## Product

Tyrekick adds small price and warning badges directly to DoneDeal car listing cards. The buyer browses normally, spots a signal, and clicks to understand why.

The promise: **Spot promising cars and warning signs while you scroll.**

The first version is a page-first experiment. Price signals compare similar cars already loaded in the current search. They describe that comparison group, not the whole Irish market or a guaranteed vehicle valuation.

## Current decisions

- Desktop Chrome first, using the existing WXT + React starter.
- DoneDeal Cars results and car detail pages.
- One Cloudflare Worker for normalisation, price calculations, and model calls.
- Local extension storage for short-lived assessments and current search context.
- No D1, KV, shared assessment cache, seed corpus, or collected market database initially.
- Price calculations use the current search's loaded results; warning checks use available listing evidence.
- Clairic extracts messy details from text; Clef assesses specific warning signs. Code calculates price comparisons.
- Cards are analysed automatically after enablement. Opening an ad provides more evidence for deeper checks.
- No background crawler, automatic detail-page fetching, or hidden tabs.

The product is not implemented or validated yet. Numeric defaults below are starting points for evaluation.

## User and job

An Irish used-car buyer is comparing cars and deciding which ads deserve a click, a message, a history check, or a viewing. Support dealer and private listings, keeping their comparison groups separate.

The question is: “How does this price compare with similar cars in this search, and is there anything specific I should question?”

Undisclosed finance, clocking, accident history, and mechanical condition may be invisible in an ad. A low price or an ordinary description does not establish that a car is safe to buy.

## Card experience

Place a small Tyrekick badge row near the asking price. Preserve existing DoneDeal content and controls, make Tyrekick's attribution visible, and avoid repeated layout movement.

Price labels:

| Label | Meaning |
| --- | --- |
| Great price | Materially cheaper than close matches in the current search |
| Typical price | Within the comparison group's normal asking-price band |
| Expensive | Materially more expensive than close matches in the current search |
| Not enough data | Too few close matches or too much uncertainty |

The explanation must say **“Compared with this search”**, with the comparison count and sample time. Great price is a price observation, not a recommendation to buy. Avoid whole-market language such as “Fair market value”.

Warning labels:

| Label | Meaning |
| --- | --- |
| Suspicious | Specific, strong scam-related evidence in the supplied listing text |
| Check details | A contradiction or uncertainty worth asking about |
| Limited info | Only card-level information has been checked |

Keep price and warning signals independent: a listing can show `Great price · Suspicious`. A low price alone does not justify a Suspicious label.

With full listing evidence and no displayed finding, omit the warning badge and say “No warning signs detected in the information checked” in the explanation. Do not claim Safe, Verified, or Not a scam. Preserve “Card info only” in explanations when a warning is based on limited card evidence.

Illustrative states:

- `Great price · Limited info`
- `Typical price · Check details`
- `Great price · Suspicious`
- `Expensive · Limited info`
- `Not enough data · Check details`

## Explanation and detail page

Click, keyboard activation, or tap opens a compact explanation. Hover may also work but must not be required. Show:

1. The price comparison, number of matches, and links to the closest matches.
2. “Compared with this search”, the observation time, and any important matching limitation.
3. Up to three evidence-backed warnings, with the relevant text or structured fields.
4. Coverage: Card info only or Full listing checked.
5. A concrete next step for a warning, such as a question to ask the seller.

When the buyer opens an ad, read its description and available fields, refresh the warning assessment, and show the same signals near the price. Reuse a recent price assessment from the originating search only when the target facts and search context still match; retain its search scope and observation time.

A directly opened detail page with no saved search context shows Not enough data for price. Warning checks still run.

Returning to results may reuse a recent detail assessment when visible facts agree. A card cannot reveal an unseen description edit; retain the evidence time and expire these checks quickly.

## Search-relative price assessment

Use the cards actually observed in the active results view, including cards loaded as the buyer scrolls. Do not claim to cover unloaded pages, the full result count, earlier searches, or the wider market. Search filters and promoted results can bias the sample.

For each target listing:

- Match make/model, fuel or powertrain, transmission, and seller type; require similar year and mileage. Consider generation, trim, engine, body type, or battery variant when material and available.
- Treat unknown matching fields as uncertainty. A broad mixed search may legitimately produce no price labels.
- Exclude the target itself, duplicate listing IDs, finance instalments, missing/price-on-request values, damaged/parts-only cars, and obvious mismatches.
- Compare with at least five distinct close matches as an initial prototype rule. Reject dispersed or unstable groups even when that count is met.
- Calculate the median asking price and a descriptive spread using ordinary code. As tentative boundaries: at least 15% below the median → Great price; at least 15% above → Expensive; otherwise → Typical price.
- Abstain when uncertain matching or reasonable variations in the cohort change the conclusion materially. Typical price must not be used as an uncertainty fallback.

Validate the count, matching windows, dispersion gates and price boundaries with reviewed examples before treating them as reliable. There is no trained transaction-price model in this version.

The result is scoped to a specific comparison snapshot. Newly loaded cards can change that snapshot and its labels. Filtering, sorting, pagination, or a new search creates a new context; do not silently mix contexts. Price calculations can rerun without repeating unchanged text-model checks.

## Warning assessment

Prioritise findings with direct evidence:

- Mileage, year, fuel, or transmission contradictions across fields and description, accounting for units.
- Explicit demands for payment before viewing, shipping-only arrangements, or similar concrete payment/viewing warnings.
- Business-sale wording in an ad declared private, presented as a seller-type question unless corroborated.
- Conflicting service-history statements.

Clairic extracts text claims and their source evidence. Clef assesses defined questions. Every displayed finding needs valid supporting fields or excerpts. Probabilities stay internal and require evaluation for this use case.

Seller claims remain unverified claims. Missing service-history wording does not prove that records are absent. Import status and unusually low mileage alone do not establish fraud.

Exclude image-based stock-photo detection, write-off recognition, reverse image search, seller-network investigations, mechanical diagnoses, and numerical consumer-facing fraud probabilities.

## Enablement, loading, and failure

Enablement explains that listing facts and redacted description text are sent to Tyrekick's Worker and Cloudflare for processing. The popup provides enable/pause and clear-local-data controls.

- Show Checking while a result is pending and Temporarily unavailable for service failures.
- Distinguish missing evidence from service errors. A failed warning check must not imply that the listing passed.
- Price and warning branches can succeed independently.
- Cached signals should appear promptly; measure cached and uncached latency before setting release targets.
- Support infinite scroll, filtering, sorting, back navigation, reused DOM nodes, and background-worker restarts.
- Use text as well as colour. Popovers support keyboard activation, Escape, and focus return.
- Keep local data bounded and short-lived. Clearing local data removes stored assessments and search context.

## Validation and success

Start with a small reviewed set covering realistic cards and descriptions, then expand as mistakes emerge. Keep some examples separate from prompt and threshold tuning.

Check exact price/year/mileage/unit extraction; missing fields; monthly finance prices; sparse and mismatched comparison groups; duplicate ads; changed searches; newly loaded cards; stale caches; edited listings; contradictory descriptions; scam-language examples and benign counterexamples.

Every displayed warning must have real source evidence. Report warning precision and recall with sample counts; detecting warning language is not proof of actual fraud. Review price groups and label stability with a knowledgeable reviewer.

The first product test is five car shoppers using it during real searches. Learn whether the badges help them choose which ads to open or question, whether they understand “Compared with this search”, and how often insufficient data limits usefulness.

Record latency, repeat calls, tokens and spend during development. A local cache prevents repeat work in one browser; separate users may analyse the same ad independently.

## Build sequence

1. Inspect real DoneDeal cards/details and save sanitised parser fixtures.
2. Build the card overlay and explanations with clearly labelled sample assessments.
3. Compare loaded search cards using real parsed facts.
4. Connect the Worker, Clairic/Clef checks, and local cache; validate evidence and failure states.
5. Try the complete prototype during actual car shopping and adjust matching, labels, and thresholds.

No seed dataset or external data-access agreement is needed for this search-relative experiment.

## Deferred until justified

Whole-market comparisons, a persistent listing dataset, D1, KV/shared caching, price history, accounts, billing, chat, alerts, mobile apps, multiple marketplaces, history-check referrals, and a separate dashboard.

Consider shared caching if measured cross-user repeat analysis makes it worthwhile. Consider a persistent comparison dataset if shoppers need broader price context than loaded results provide. Either change should solve an observed problem.

## Remaining questions

- Which fields are reliably available on cards versus detail pages?
- How often do real searches contain enough genuinely comparable cars?
- Does Great price communicate the limited comparison scope clearly enough?
- What matching rules and display thresholds survive reviewed examples?
- What are the actual model access, latency, accuracy, and cost characteristics on these listings?

## Sources

Technical capabilities and marketplace observations were checked on 20 October 2026. Product policies are proposals; this revision updates scope based on the conversation.

- [DoneDeal Cars](https://www.donedeal.ie/cars?area=Dublin)
- [Clairic](https://developers.cloudflare.com/workers-ai/models/clairic/) and [Clef](https://developers.cloudflare.com/workers-ai/models/clef/)
- [CCPC car-history report announcement](https://www.ccpc.ie/news-and-media/news/article/2025/02/26/ccpc-calls-for-public-access-to-used-car-histories)
- [Cartell's 2017 study](https://www.cartell.ie/2017/09/clocking-surges-ireland/): historical discrepancies requiring investigation, not a current confirmed-fraud rate.
