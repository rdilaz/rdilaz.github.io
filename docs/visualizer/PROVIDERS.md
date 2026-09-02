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

For OpenRouter, `visualizer-model-eligibility-v1` removes Batch API-only `:batch` entries, expired models, non-text-output entries, models whose declared output ceiling cannot satisfy the Visualizer's minimum response budget, and rows that declare parameters but expose neither `max_tokens` nor `max_completion_tokens` for an enforceable spend ceiling. Interactive variants such as `:free` or `:nitro` remain eligible when the underlying model is otherwise compatible.

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

## OpenRouter authority snapshot (2026-09-02)

The provider facts below are grounded in OpenRouter's official [reasoning guide](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [streaming reference](https://openrouter.ai/docs/api_reference/streaming), [error reference](https://openrouter.ai/docs/api_reference/errors-and-debugging), [generation metadata endpoint](https://openrouter.ai/docs/api/api-reference/generations/get-request-&-usage-metadata-for-a-generation), [model-catalog schema](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), [parameter reference](https://openrouter.ai/docs/api_reference/parameters), and [`require_parameters` routing contract](https://openrouter.ai/docs/guides/routing/provider-selection#requiring-providers-to-support-all-parameters). They are an as-of snapshot, not a substitute for the fresh live-catalog check before spend.

- The Visualizer uses OpenRouter's unified `reasoning: { effort: "<level>" }` request shape. The currently documented gateway effort vocabulary is `max`, `xhigh`, `high`, `medium`, `low`, `minimal`, and `none`; the UI does not infer that every model accepts every value.
- An exact model's `reasoning.supported_efforts` is the allowlist and provider order for explicit choices. `null` means all documented gateway efforts are accepted; omission means no effort selector. `default_effort` describes the model's effort when reasoning is enabled without an explicit effort, `default_enabled` describes native on/off behavior, `mandatory: true` forbids `none`, and `supports_max_tokens: true` advertises `reasoning.max_tokens`. The current product exposes catalog-backed efforts, not a reasoning-token-budget control.
- `Default` means native omission: the request contains no root `reasoning` member. It does not send `{}`, `enabled`, `none`, `low`, or the catalog's `default_effort`. OpenRouter documents omission as allowing the upstream provider/model default to apply, so Default is not synonymous with reasoning off.
- Every completion requires provider support for the supplied parameters. An explicit effort adds only the catalog-backed `reasoning` object; Default still omits it. OpenRouter says `require_parameters: true` can reduce route availability, checks parameter support rather than model quality or value-level upstream semantics, and may normalize an effort into a provider-native control. The Visualizer therefore promises exact catalog-backed user intent and trace evidence, not access to an unmodified upstream provider payload.
- Model-level pricing is the current top-provider price, not a documented maximum across fallback routes. The guard takes the highest prompt/completion rate across current catalog `pricing.overrides`, prices the local envelope with it, and sends OpenRouter [`provider.max_price`](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) at those rates so a more expensive fallback route is excluded. `max_price` limits unit rates rather than total dollars; the local token envelope remains the total-cost authority.
- Reasoning tokens are completion/output tokens and are charged accordingly. Catalog `pricing.completion` is the output-token price; a model may additionally publish the optional per-token `pricing.internal_reasoning`. Provider-returned `usage.cost` remains the preferred exact accounting fact.
- Root `max_tokens` is a total completion ceiling, not a visible-HTML target. Reasoning can consume part of it, leaving fewer tokens for the artifact; it is also bounded by context remaining after the prompt. See OpenRouter's [reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#reasoning-effort-level) and [`max_tokens`](https://openrouter.ai/docs/api_reference/parameters#max-tokens) documentation.
- Request construction uses the exact model's advertised output-limit parameter: `max_tokens` when present, otherwise `max_completion_tokens`. Optional `temperature: 1` is omitted when the model does not advertise temperature support; the app never requires a route to accept an unsupported optional sampling control.
- Chat Completions uses `stream: true`. OpenRouter documents SSE comments such as `: OPENROUTER PROCESSING` as keep-alives, top-level `error` data events for failures after HTTP 200, a final usage-bearing chunk, then `[DONE]`. The host counts any nonempty body chunk as activity but only content/reasoning deltas as model output.
- A request gets a three-minute idle deadline reset by headers/body activity and a separate 30-minute safety ceiling. Crossing six minutes while the body remains active is not terminal. User cancellation, idle timeout, hard timeout, explicit provider error, protocol failure, and normal completion remain distinct trace outcomes.
- The SSE response has exactly one app reader. The spend guard reserves before dispatch but never clones/consumes the body. Final stream usage starts request-scoped settlement without delaying a completed artifact behind another tab's lock; the maximum reservation remains conservative until settlement commits.
- `[DONE]` is terminal even if malformed trailing events share its network chunk. Contradictory header/event or event/event generation ids fail closed, keep partial text diagnostic-only, and cannot settle or query accounting under the ambiguous id.
- `X-Generation-Id` is retained separately from `X-Request-Id` and the local artifact UUID. If final usage is unavailable after cancel/timeout/error, one delayed four-second-bounded GET to `/api/v1/generation?id=...` may reconcile the existing reservation only when its response repeats that id and reports billed cost. It never sends another completion, never delays cancellation UI, and never retries the lookup. Missing or contradictory metadata leaves the reservation conservative.

### User reasoning contract

- `Default` is always the first option and is the initial state when no valid exact-model selection exists. Only efforts advertised by that exact live model are shown or dispatched; valid choices may be stored independently per exact model id.
- The catalog is refreshed immediately before generation and repair. A stale saved choice falls back to native Default for a new generation, notifies the user, and records requested/applied truth. If an explicit effort used by an active Dream disappears before repair, repair blocks before paid dispatch rather than changing the Dream's snapshotted quality. An unsupported effort is never sent.
- Spend policy never silently lowers reasoning. If the selected effort cannot fit the practical generation envelope, the request is blocked and points to Spend protection instead of switching effort.
- A Dream snapshots its exact model, prompt profile, and reasoning-selection intent. Its optional same-model repair reuses that snapshot and revalidates it against repair-time live metadata; changing NEXT controls while the Dream is running cannot mutate either attempt.

### DeepSeek live-catalog example

The official [live catalog query](https://openrouter.ai/api/v1/models?q=deepseek%2Fdeepseek-v4-flash-0731) reported the interactive `deepseek/deepseek-v4-flash-0731` row on 2026-09-02 with `supported_efforts: ["max", "high", "low"]`, `default_enabled: true`, `default_effort: "high"`, and `mandatory: false`. It reported root `context_length: 1310720`, top-provider `context_length: 1048576`, and top-provider `max_completion_tokens: 943718`; `supports_max_tokens` was omitted. These are mutable catalog facts, not a permanent guarantee or evidence that the model is broken.

There is a catalog/documentation discrepancy in the same official sources: the reasoning guide's generic [effort-level support note](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#reasoning-effort-level) names OpenAI and Grok models, while the per-model metadata contract and live DeepSeek row above advertise exact DeepSeek efforts. The Visualizer follows the fresh exact-model row at request time instead of maintaining a family allowlist.

## Generation result

A successful generation or repair returns:

- privately assembled raw model text after normal `[DONE]` completion;
- the bounded exact SSE transcript and a separately labeled normalized aggregate at the trusted browser boundary when tracing is available;
- extracted complete HTML;
- resolved model identity;
- usage accounting when available;
- request id when available;
- OpenRouter generation id when available;
- prompt version and attempt number.

Generation and repair are separate append-only trace attempts. The provider adapter does not claim access to hidden model reasoning: only reasoning fields explicitly returned by the provider and separate reasoning-token accounting may be retained.

The shared host, not the adapter, validates HTML, runs the Dream reliability harness, stores successful generations, and decides whether one bounded repair is needed.

## Evidence-based completion failures

The preserved DeepSeek regression is exact: one request to `deepseek/deepseek-v4-flash-0731` sent `max_tokens: 14000` and returned HTTP 200 with `finish_reason: "length"`, `native_finish_reason: "length"`, and `message.content: null`. Usage was 600 prompt, 14,000 completion, 12,392 reasoning, and 14,600 total tokens with `cost: 0.004004`; no assistant text or HTML was produced. It is classified as `OUTPUT_BUDGET_EXHAUSTED_BEFORE_ARTIFACT`, not as a provider error or proof of model incompatibility.

That response is not retried because the model executed and was billed, and it is not repaired because there is no artifact to repair. LIVE remains unchanged. The taxonomy keeps output-budget exhaustion, partial-output truncation, empty provider content, provider timeout, provider explicit error, invalid HTML, renderer/runtime failure, and user cancellation distinct so one observation cannot silently become a generic failure or a `KNOWN_INCOMPATIBLE` model verdict.

## Credential and billing rules

Provider credentials are never exposed to generated code. Browser-direct delegated credentials must be short-lived/session-scoped when the provider supports that. Hosted-gateway adapters must keep secrets off the client and use the user's own connected billing source.

The Visualizer does not fund model calls from a site-owned balance in this phase. Optional site-funded credits and monetization are separate future product decisions.

## Active reference adapter

OpenRouter is the only active adapter in Browser Provider Reset v1. It uses PKCE, a session-scoped delegated key, the live OpenRouter model catalog, live-Dream eligibility filtering, a fresh pre-spend model-availability check, browser-side spend controls, private SSE assembly, exact usage accounting when available, explicit provider errors, and no app-issued completion retry after uncertain model execution.

Additional adapters are not accepted until the OpenRouter path passes repeated real-browser acceptance and the new provider's official authentication/billing path has been verified.
