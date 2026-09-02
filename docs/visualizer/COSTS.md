# Visualizer cost and spend protection

The Visualizer currently bills model generation through the user's connected OpenRouter account. Music/audio is never part of the model request and does not affect model billing.

## What the user sees

The visualizer keeps cost information deliberately quiet at the surface:

- the Dream control shows compatible local empirical cost evidence plus the enforced whole-Dream maximum;
- the top spend pill shows model spend recorded during the current browser session;
- the Spend drawer exposes deeper pricing, limits, and the exact session ledger.

The default local protections are:

- **$0.75 per Dream**, including any automatic repair request;
- **$5 per browser session**;
- **$10 per local calendar day**;
- confirmation before a Dream whose enforced generation-plus-possible-repair maximum exceeds **$0.15**.

These defaults are user-editable in the Spend drawer.

## Three different cost facts

1. **Empirical estimate:** `No estimate yet` means there is no retained exact billed observation for the compatible configuration. One retained observation is `Last ~$X`; two or more use the deterministic retained-sample median `Usually ~$X`. Compatibility includes exact model, reasoning choice, prompt profile/version/hash, generation-envelope major version, Audio API, reliability, and runtime. This is bounded historical evidence, not a promised charge.
2. **Enforced maximum:** the Dream control and confirmation name the strict whole-Dream ceiling including at most one possible repair. The Spend drawer and confirmation also show the smaller final post-envelope initial-request ceiling that will be reserved before dispatch. The confirmation threshold is evaluated against the whole-Dream maximum rather than Last/Usually.
3. **Theoretical model ceiling:** the catalog model's full completion ceiling priced with the current prompt assumptions. It is developer-only diagnostics, is not consumer-visible, and is neither expected nor typical cost.

## Before a Dream

`visualizer-generation-envelope-v1` computes `max_tokens` as a ceiling, never a generation target. There is no universal 14,000-token cap: an affordable model may receive more, while another request receives less. The final ceiling is the strict minimum allowed by the live model completion limit, context capacity after a conservative prompt estimate, any explicit root request ceiling, and affordability.

Affordability includes published prompt and completion prices, the request fee when present, and optional `internal_reasoning` pricing. Reasoning tokens are already completion/output tokens; when OpenRouter separately publishes `internal_reasoning`, the guard conservatively reserves that rate as well. An omitted optional request or internal-reasoning fee is zero, but missing/invalid required prompt or completion pricing blocks dispatch. The rate bound uses the highest prompt/completion price present in current catalog overrides and sends matching OpenRouter `provider.max_price` limits so a costlier fallback route cannot silently invalidate the local arithmetic.

The affordability bound uses the smallest remaining per-Dream, browser-session, local-day, and provider-key budget. A 0.9 safety factor is applied to that strict remainder before request fee, conservative prompt cost, and worst-case completion/reasoning cost are reserved. An uncapped provider key contributes no finite provider bound; it does not disable the three app bounds.

The documented practical artifact allowance is 4,500 tokens. It is a provisional quality heuristic derived from existing successful-artifact allowances, not certainty. Because root `max_tokens` includes reasoning plus visible output, the envelope adds reasoning headroom using OpenRouter's documented effort-to-budget ratios when an explicit or known native effort applies: Minimal 5,000 total, Low 5,625, Medium 9,000, High 22,500, and XHigh/Max 90,000. Incomplete native metadata is labeled `unknown-native`; the policy conservatively uses High headroom without claiming that Default actually means High. These are dispatch floors, not predictions of actual use. If affordability is the limiting constraint, no request is sent and the UI links to Spend protection. If the model/context ceiling itself is too small for that configuration, the UI instead asks the user to choose another supported effort or model. The app never silently downgrades quality to fit a cap.

Expensive Dreams are allowed when explicit per-Dream/session/day/provider bounds make the envelope dispatchable and the user authorizes the enforced whole-Dream maximum. The app does not block merely because a model's developer-only theoretical full ceiling is large. A repair shares the same remaining per-Dream/session/day bounds and never receives a second full Dream allowance.

## After a Dream

Streamed requests ask OpenRouter to return usage accounting. The final SSE chunk is the primary settlement source; when available, the app records its `usage.cost` as the authoritative cost for that request. Settlement starts immediately but does not block a completed artifact behind another tab's spend lock: the already-persisted maximum reservation remains conservative until the lock is acquired. If exact cost is unavailable but actual token counts and catalog prices are available, the app records a clearly approximate fallback calculation.

The spend guard never clones or consumes the completion stream. A request-scoped accounting handoff lets the single provider reader settle the exact reservation. If cancellation, idle/hard timeout, an HTTP-200 stream error, premature EOF, or missing final usage leaves cost unknown, the maximum reservation remains charged conservatively.

When an OpenRouter generation id is available for an uncertain outcome, the app may make one delayed metadata GET with a four-second deadline. This is a reconciliation read, not a completion retry: it cannot generate output or duplicate spend. Exact `total_cost` can settle the existing ledger entry only when returned metadata repeats the same generation id; a missing id, contradictory id, missing cost, late record, or failed lookup leaves it uncertain. Cancellation UI never waits for this read.

The session ledger shows generation and repair charges separately so the user can see what actually consumed credits.

The app also queries `GET /api/v1/key` using the already-authorized session key. When OpenRouter reports a key limit, the UI displays usage and `limit_remaining`. When the key is uncapped, the UI says so explicitly rather than treating the missing limit as zero.

## Enforcement boundary

The browser-side per-Dream/session/day controls are strong application guardrails: the app lowers `max_tokens` or refuses to send a request. They are not described as an absolute provider billing guarantee, because provider routing/accounting can evolve outside this static application's control.

Where the Web Locks API is available, the spend guard serializes completion authorization and durable reservation before dispatch, then reacquires the same lock for stream-usage or metadata settlement. It deliberately does not hold the lock while a long SSE body remains open; the already-persisted maximum reservation prevents a second tab from racing the shared local-day budget. Browsers without Web Locks retain conservative per-request reservation and storage-event reconciliation but cannot make localStorage updates fully transactional across tabs. Every displayed maximum rounds upward to cents so consumer copy never rounds a ceiling down.

An OpenRouter key limit is stronger because OpenRouter enforces that limit on its own side. The static V0 intentionally does not embed a Management API credential and therefore cannot safely create or mutate provider-side keys itself.

## Standalone product target

When the Visualizer moves from static GitHub Pages incubation to its own backend, model connection should provision a dedicated Visualizer OpenRouter key with a user-selected limit and expiry through OpenRouter's OAuth/auth-code provisioning flow. The server-side management credential must never be shipped to browser JavaScript.

That gives the final product two independent protections:

1. **provider-enforced dedicated-key budget/expiry**;
2. **per-Dream/session/day application guardrails**.

The generated visualizer sandbox never receives the OpenRouter key, cost data, billing state, or any other account credential.
