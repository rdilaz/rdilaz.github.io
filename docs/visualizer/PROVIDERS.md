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

## Live Dream model eligibility

A provider catalog may contain entries that exist for other API products but cannot serve the Visualizer's interactive generation path. `listModels()` must expose only models that can currently produce a live Dream through the adapter's declared generation endpoint.

For OpenRouter, `visualizer-model-eligibility-v1` removes Batch API-only `:batch` entries, expired models, non-text-output entries, and models whose declared output ceiling cannot satisfy the Visualizer's minimum response budget. Interactive variants such as `:free` or `:nitro` remain eligible when the underlying model is otherwise compatible.

Catalog filtering is not the final authority. Immediately before each paid generation or repair, the OpenRouter adapter refreshes the current catalog with `cache: no-store` and verifies the exact model id again. If the model disappeared or became ineligible, the Dream fails before the `/chat/completions` request is sent. No availability fallback silently substitutes another model because model identity is part of the experiment.

## Normalized model record

Adapters return stable records containing at least:

- model `id` and display `name`;
- upstream model/provider identity;
- Visualizer provider id/source;
- context and output limits when known;
- pricing when known;
- supported parameters/capabilities when known;
- current eligibility metadata when the provider catalog exposes lifecycle information.

Future inference-level support must come from verified provider capability metadata. The Visualizer must never fabricate low/medium/high/xhigh options.

## Generation result

A successful generation or repair returns:

- raw model text;
- the decoded raw provider response and parsed payload at the trusted browser boundary when tracing is available;
- extracted complete HTML;
- resolved model identity;
- usage accounting when available;
- request id when available;
- prompt version and attempt number.

Generation and repair are separate append-only trace attempts. The provider adapter does not claim access to hidden model reasoning: only reasoning fields explicitly returned by the provider and separate reasoning-token accounting may be retained.

The shared host, not the adapter, validates HTML, runs the Dream reliability harness, stores successful generations, and decides whether one bounded repair is needed.

## Credential and billing rules

Provider credentials are never exposed to generated code. Browser-direct delegated credentials must be short-lived/session-scoped when the provider supports that. Hosted-gateway adapters must keep secrets off the client and use the user's own connected billing source.

The Visualizer does not fund model calls from a site-owned balance in this phase. Optional site-funded credits and monetization are separate future product decisions.

## Active reference adapter

OpenRouter is the only active adapter in Browser Provider Reset v1. It uses PKCE, a session-scoped delegated key, the live OpenRouter model catalog, live-Dream eligibility filtering, a fresh pre-spend model-availability check, browser-side spend controls, exact usage accounting when available, explicit provider errors, and no automatic request retry after uncertain model execution.

Additional adapters are not accepted until the OpenRouter path passes repeated real-browser acceptance and the new provider's official authentication/billing path has been verified.
