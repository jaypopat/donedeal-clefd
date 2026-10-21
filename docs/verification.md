# Prototype verification

Verification distinguishes synthetic fixtures, live provider calls, and live DoneDeal pages. Synthetic pages prove controlled outcomes. Live pages establish that the installed extension can read and render the current site.

## Repeatable checks

- `bun run check`: TypeScript checks, behavior tests, Chrome MV3 production build, and Worker dry-run packaging.
- `bun run verify:browser`: an installed extension in isolated headed Chromium, synthetic DoneDeal pages, and a local deterministic Worker. Build for a separate free loopback port first, as described in the README.
- `bun run worker:smoke --extension-origin chrome-extension://YOUR_EXTENSION_ID --port 8791 --require-models`: synthetic vehicle data through the real local Worker and remote Workers AI binding.

The browser workflow checks consent, cash beside finance, independent signals, keyboard explanations, viewport bounds, growing comparison cohorts, same-tab and new-tab provenance, detail enrichment, direct-detail abstention, search changes, service failures, pause, and clearing during a delayed response. It checks source privacy and focus return. The fixture Worker never calls remote models.

The final integrated build passed 143 behavior tests across 14 files, both TypeScript projects, extension packaging, and the Worker dry run. All nine installed-extension replay checks passed.

## Live evidence, 20 October 2026

Both Clairic and Clef returned valid results through the authenticated remote AI binding while the Worker ran on loopback. The smoke request produced a price comparison, a payment-before-viewing finding, a mileage contradiction, and no finding for the benign payment example. Every returned text span matched the submitted redacted text. Hosted access remains disabled.

The production extension loaded in headed Chrome 153 and rendered badges on 33 live Volkswagen Golf result cards. An opened detail page completed a real full-listing warning check and displayed its explanation. Screenshots were inspected locally and are kept outside Git.

That loaded search produced insufficient price data. This is evidence that abstention renders correctly; it does not establish useful price coverage across real searches. Ready price labels were verified with synthetic cohorts through the Worker and installed-extension replay.

## Review and scope

Independent reviews found and prompted fixes for contact redaction, rejected model evidence, scrolled-card facts, bounded messages, stale preparation after pause or clear, shared request identities, newly disclosed damage, expiry cleanup, and popover placement. Follow-up reviews accepted the scoped UI/workflow and cache/concurrency corrections. The trigger-toggle concern did not reproduce in the installed browser; the replay now checks it.

Matching thresholds and warning policy remain provisional. This build does not establish warning accuracy or price coverage through shopper trials. Hosted tester authentication, public deployment, Firefox, and automated collection of unopened listings are outside this prototype.

## Dispatch record

| Work | Provider and model |
| --- | --- |
| Context and independent design | Claude / Opus 5.5; Codex / GPT-6.1-Sol |
| Design selection | Codex / GPT-6-Astra |
| Initial backend implementation | Claude / Opus 5.5; committed work recovered after its rate limit |
| UI, lifecycle, integration, concurrency fixes | Codex / GPT-6.1-Sol |
| Adapter and provider corrections, comment cleanup | Antigravity / Gemini 3.8 Flash High |
| Independent implementation reviews | Codex / GPT-6.1-Sol; Antigravity / Gemini 3.8 Flash High |

Build the Lever produced the repeatable browser and model-smoke scripts. Boundary Discipline keeps validation at DOM, message, storage, HTTP, and model boundaries. Prove It Works kept fixture outcomes separate from live-page and provider evidence.
