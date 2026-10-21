# Tyrekick

Tyrekick adds independent price and warning signals to DoneDeal car cards and detail pages. Price comparisons use similar cars loaded in the current search. Warning checks use listing evidence and Cloudflare's Clairic and Clef models.

This v0.2 prototype runs with a local Cloudflare Worker. Hosted requests fail closed. The [product specification](docs/product-spec.md) defines scope, and the [architecture](docs/architecture.md) explains the components. There is no listing database, shared cache, or crawler.

## Run the extension with real models

A `justfile` wraps these steps: `just build`, then `just worker id=YOUR_EXTENSION_ID` (or set `TYREKICK_EXTENSION_ID`). Run `just` to list recipes.

You need Bun, desktop Chrome, and a Cloudflare account with Workers AI access. The startup script uses an existing `CLOUDFLARE_API_TOKEN` environment variable or the saved cf CLI login. It passes credentials only to the Worker development process.

1. Install the locked dependencies.

   ```sh
   bun install --frozen-lockfile
   ```

2. Build for a free local port. These examples use 8791.

   ```sh
   WXT_API_BASE=http://127.0.0.1:8791 bun run build
   ```

3. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `.output/chrome-mv3`. Copy Tyrekick's extension ID.

4. Start the Worker, replacing `YOUR_EXTENSION_ID` with that ID.

   ```sh
   bun run worker:dev --extension-origin chrome-extension://YOUR_EXTENSION_ID --port 8791
   ```

   Wait for `Ready on http://127.0.0.1:8791`. The AI binding must show `remote`. Code runs locally; model inference runs on Cloudflare and uses that account's allowance. The script refreshes the saved cf session at `~/.bun/bin/cf`. Set `TYREKICK_CF_CLI` if your CLI is elsewhere. Set `CLOUDFLARE_ACCOUNT_ID` if your token sees multiple accounts.

5. Open Tyrekick's popup, read the data-use disclosure, and choose **Agree and enable**. Browse [DoneDeal Cars](https://www.donedeal.ie/cars). Choose a make, model, and transmission filter to improve comparison coverage. Missing essential facts correctly produce **Not enough data**.

Click a badge to see the comparison scope and evidence. Open an ad for a fuller warning check. A direct detail visit has no originating price comparison. The popup provides **Pause analysis** and **Clear local data**. Pause before clearing to keep enabled pages from immediately requesting fresh assessments.

When a price label cannot be supported but relevant loaded listings exist, **N similar** opens their asking prices and links. Unconfirmed details appear beside each affected link. These references do not count toward the five confirmed matches required for a price label. Recognised material variants are separated; unmarked titles and models outside the variant registry carry an explicit limitation.

Long descriptions show **Limited info** and disclose the text-check limit. That result does not claim the full listing was checked.

The extension sends allowlisted vehicle facts and redacted listing text. It does not collect cookies, seller profiles, images, plates, or VINs. Assessments expire locally and share a 200-entry limit. The Worker retains inputs only for the request.

To test pricing without remote inference, add `--local` to `worker:dev`. Model-dependent warnings then report unavailable. Rebuild and reload the extension when changing `WXT_API_BASE`; the configured endpoint must be loopback HTTP.

## Verify the build

Run the unit and integration checks, extension build, and Worker packaging check.

```sh
bun run check
```

`worker:check` uses Wrangler's dry-run packaging mode and does not deploy.

With the real Worker running, check pricing, both models, response identities, and source spans using synthetic text.

```sh
bun run worker:smoke --extension-origin chrome-extension://YOUR_EXTENSION_ID --port 8791 --require-models
```

Run the warning regressions against the same real Worker, or replay sanitised saved searches without networking.

```sh
bun scripts/smoke-warning-policy.ts --extension-origin chrome-extension://YOUR_EXTENSION_ID --port 8791
bun scripts/coverage-report.ts
```

The coverage report prints each loaded listing's parsed facts and result, plus outcome counts. It validates comparison links and variant separation. The saved snapshots are a repeatable development check, not a representative shopper trial.

The browser check installs the built extension in an isolated Chromium profile and replays synthetic DoneDeal pages against a deterministic local fixture Worker. It does not use live inference. Use a separate free port for this check.

```sh
bunx playwright-core install chromium
WXT_API_BASE=http://127.0.0.1:8792 bun run build
WXT_API_BASE=http://127.0.0.1:8792 bun run verify:browser
```

On Linux without a desktop display, use `WXT_API_BASE=http://127.0.0.1:8792 xvfb-run -a bun run verify:browser`. Optional environment variables are `TYREKICK_CHROMIUM_PATH`, `TYREKICK_PLAYWRIGHT_MODULE`, and `TYREKICK_SCREENSHOT`. After fixture verification, rebuild for the port used by your real Worker and reload the extension.

## Prototype limits

Matching thresholds and warning probabilities need reviewed examples and shopper trials. A price signal describes asking prices in the loaded search, not a whole-market valuation. A warning check does not verify the vehicle or seller. Promoted cards and cards with missing matching facts can remain insufficient. Private hosted tester access and public deployment are separate work.
