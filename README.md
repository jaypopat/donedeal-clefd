# Tyrekick

A browser-extension prototype that adds price and warning signals to DoneDeal car cards.

Start with the [product specification](docs/product-spec.md): it is the source of truth for the current scope and decisions.

- [High-level architecture](docs/architecture.md)
- [Architecture overview](docs/architecture-overview.html)

Current direction: comparisons within the current search, one Cloudflare Worker, and local browser caching. D1, KV, and a collected market dataset are deferred.

The code is currently a WXT + React starter; the documents describe the proposed build.
