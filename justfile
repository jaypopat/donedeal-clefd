# Local Worker port (8787 is often taken). Override with TYREKICK_PORT or `just port=NNNN <recipe>`.
port := env("TYREKICK_PORT", "8791")
api := "http://127.0.0.1:" + port

# Extension ID from chrome://extensions after loading .output/chrome-mv3.
id := env("TYREKICK_EXTENSION_ID", "")

default:
    @just --list

install:
    bun install --frozen-lockfile

# Build the unpacked extension for the local Worker port.
build:
    WXT_API_BASE={{api}} bun run build

# Run the Worker with remote Cloudflare models.
worker: _need-id
    bun run worker:dev --extension-origin chrome-extension://{{id}} --port {{port}}

# Run the Worker without remote inference; warnings report unavailable.
worker-local: _need-id
    bun run worker:dev --extension-origin chrome-extension://{{id}} --port {{port}} --local

# Check pricing and both models against a running Worker.
smoke: _need-id
    bun run worker:smoke --extension-origin chrome-extension://{{id}} --port {{port}} --require-models

# Run warning regressions against a running Worker.
smoke-warnings: _need-id
    bun scripts/smoke-warning-policy.ts --extension-origin chrome-extension://{{id}} --port {{port}}

# Replay saved searches offline.
coverage:
    bun scripts/coverage-report.ts

test:
    bun test

# Compile, test, build, and dry-run the Worker package.
check:
    bun run check

# Install the built extension in Chromium against the fixture Worker.
verify-browser browser_port="8792":
    WXT_API_BASE=http://127.0.0.1:{{browser_port}} bun run build
    WXT_API_BASE=http://127.0.0.1:{{browser_port}} {{ if env("DISPLAY", "") == "" { "xvfb-run -a " } else { "" } }}bun run verify:browser
    @echo "Run 'just build' before using the real Worker again."

_need-id:
    @test -n "{{id}}" || { echo "Set TYREKICK_EXTENSION_ID or pass id=<extension id> (see chrome://extensions)."; exit 1; }
