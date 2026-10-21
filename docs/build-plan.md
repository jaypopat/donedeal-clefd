# Build the v0.2 prototype

The product specification remains the source of truth. This plan records the implementation sequence and verification gates.

## Completion criteria

The Chrome extension reads DoneDeal results and detail pages that the buyer opens. After consent, it renders independent price and warning signals with keyboard-accessible explanations. Price calculations use only the loaded search snapshot. Warnings show validated source evidence. Pause, clear data, navigation, cache expiry, and service failures have observable behavior.

One Worker validates requests, computes price comparisons, and calls Clairic and Clef. Provider credentials stay outside the extension. Development can exercise the full loop without a public deployment.

The build passes type checks, production builds, and focused behavior tests. An installed extension runs on real DoneDeal pages in headed Chromium. Independent review checks correctness and privacy before the change is ready for review.

## Ordered units

1. Capture sanitised card and detail fixtures. Define runtime-validated contracts and parsers. Check cash prices, finance prices, units, identity, unknown fields, and redaction.
2. Build the attributed badge row, accessible explanation, and consent controls. Mount on cards and detail pages without intercepting DoneDeal navigation.
3. Track loaded search snapshots and implement deterministic price matching in the Worker. Test sparse, mixed, duplicate, dispersed, and unstable groups.
4. Connect the Worker, Clairic extraction, Clef questions, and evidence policy. Keep per-target failures and the two assessment branches independent.
5. Add bounded local caching, batching, pause, clearing, expiry, and stale-response rejection. Verify browser navigation and the full live model loop.

Each unit ends with focused verification and a scoped commit. Commit messages have no co-author trailers.

## Ownership and parallel work

The implementation owner controls shared contracts and integration in an isolated worktree. Independent design and review delegates inspect the same specification. The coordinator captures live-page evidence and verifies the integrated artifact. Concurrent writers use separate worktrees.

## Baseline

The untouched starter passes `npm run compile` and `npm run build` after a frozen-lockfile Bun install. The shared browser reads real DoneDeal results and details. A temporary Manifest V3 extension loads in headed Chromium and runs its content script on real results. Both Cloudflare models returned successful responses to synthetic requests. GitHub push permission and Cloudflare Workers write scopes are present.

The initial live-page inspection found structured year, fuel, mileage, and cash price on results. Transmission and variant facts are often absent from cards. Detail pages contain named vehicle attributes. Unknown matching facts must remain unknown and can prevent a price label.

## Review record

Keep generated screenshots and local credentials out of Git. Capture repeatable verification commands in the repository.
