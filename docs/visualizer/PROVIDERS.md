# Browser Provider Contract — `visualizer-provider-v1`

## Purpose

The Visualizer should feel like one product even when models come from different services. A provider adapter translates one supported, user-funded model service into the same small host contract.

The user-facing rule is fixed:

**open the website → connect a provider → choose a model → Dream**

No adapter may require a terminal, localhost service, native companion, browser extension, or downloaded executable for the normal product.

## Required adapter shape

Every registered adapter exposes:

- `id` and human-readable `name`;
- `browserOnly: true`;
- `billing: "user"` during the current phase;
- a declared transport such as `browser-direct` or `hosted-gateway`;
- capability metadata;
- `getCredential()` and `isConnected()`;
- `connect(callbackUrl)`, `consumeCallback()`, and `disconnect()`;
- `listModels()`;
- `generate(options)`;
- `repair(options)`.

Registration fails closed when those requirements are missing.

## Normalized model record

Adapters return stable records containing at least:

- model `id` and display `name`;
- upstream model/provider identity;
- Visualizer provider id/source;
- context and output limits when known;
- pricing when known;
- supported parameters/capabilities when known.

Future inference-level support must come from verified provider capability metadata. The Visualizer must never fabricate low/medium/high/xhigh options.

## Generation result

A successful generation or repair returns:

- raw model text;
- extracted complete HTML;
- resolved model identity;
- usage accounting when available;
- request id when available;
- prompt version and attempt number.

The shared host, not the adapter, validates HTML, performs sandbox smoke tests, stores successful generations, and decides whether one bounded repair is needed.

## Credential and billing rules

Provider credentials are never exposed to generated code. Browser-direct delegated credentials must be short-lived/session-scoped when the provider supports that. Hosted-gateway adapters must keep secrets off the client and use the user's own connected billing source.

The Visualizer does not fund model calls from a site-owned balance in this phase. Optional site-funded credits and monetization are separate future product decisions.

## Active reference adapter

OpenRouter is the only active adapter in Browser Provider Reset v1. It uses PKCE, a session-scoped delegated key, the live OpenRouter model catalog, browser-side spend controls, exact usage accounting when available, explicit provider errors, and no automatic request retry after uncertain model execution.

Additional adapters are not accepted until the OpenRouter path passes repeated real-browser acceptance and the new provider's official authentication/billing path has been verified.
