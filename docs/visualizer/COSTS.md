# Visualizer cost and spend protection

The Visualizer currently bills model generation through the user's connected OpenRouter account. Music/audio is never part of the model request and does not affect model billing.

## What the user sees

The visualizer keeps cost information deliberately quiet at the surface:

- the Dream control shows an approximate typical cost for the selected model;
- the top spend pill shows model spend recorded during the current browser session;
- the Spend drawer exposes deeper pricing, limits, and the exact session ledger.

The default local protections are:

- **$0.75 per Dream**, including any automatic repair request;
- **$5 per browser session**;
- **$10 per local calendar day**;
- confirmation before a Dream whose typical estimate reaches **$0.15**.

These defaults are user-editable in the Spend drawer.

## Before a Dream

The host uses OpenRouter's model catalog pricing plus an estimate of prompt/output tokens to display a typical cost. The estimate is informational; it is not represented as an exact future charge.

For paid models, the browser spend guard derives a maximum output-token allowance from the smallest available budget across:

1. remaining per-Dream app budget;
2. remaining browser-session app budget;
3. remaining local-day app budget;
4. the current OpenRouter key's `limit_remaining`, when OpenRouter reports a provider-side key limit.

A safety margin is applied. If the remaining budget cannot support a minimally viable visualizer response, the request is refused before it is sent. Models without usable published pricing are also refused rather than risking unknown spend.

The first generation attempt reserves some of the Dream budget for a possible automatic repair. A repair therefore shares the same Dream budget instead of silently receiving a second full allowance.

## After a Dream

Requests ask OpenRouter to return usage accounting. When available, the app records OpenRouter's returned `usage.cost` as the authoritative cost for that request. If exact cost is unavailable but actual token counts and catalog prices are available, the app records a clearly approximate fallback calculation.

The session ledger shows generation and repair charges separately so the user can see what actually consumed credits.

The app also queries `GET /api/v1/key` using the already-authorized session key. When OpenRouter reports a key limit, the UI displays usage and `limit_remaining`. When the key is uncapped, the UI says so explicitly rather than treating the missing limit as zero.

## Enforcement boundary

The browser-side per-Dream/session/day controls are strong application guardrails: the app lowers `max_tokens` or refuses to send a request. They are not described as an absolute provider billing guarantee, because provider routing/accounting can evolve outside this static application's control.

An OpenRouter key limit is stronger because OpenRouter enforces that limit on its own side. The static V0 intentionally does not embed a Management API credential and therefore cannot safely create or mutate provider-side keys itself.

## Standalone product target

When the Visualizer moves from static GitHub Pages incubation to its own backend, model connection should provision a dedicated Visualizer OpenRouter key with a user-selected limit and expiry through OpenRouter's OAuth/auth-code provisioning flow. The server-side management credential must never be shipped to browser JavaScript.

That gives the final product two independent protections:

1. **provider-enforced dedicated-key budget/expiry**;
2. **per-Dream/session/day application guardrails**.

The generated visualizer sandbox never receives the OpenRouter key, cost data, billing state, or any other account credential.
