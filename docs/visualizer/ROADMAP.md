# Visualizer Roadmap

The roadmap is ordered around usable browser experiences, not infrastructure phases.

## Browser Provider Reset v1 — CURRENT

Remove the desktop/local detour completely; lock the normal experience to browser-only and user-funded provider connections; establish `visualizer-provider-v1`; keep OpenRouter as the sole reference adapter; preserve the canonical prompt, audio runtime, sandbox, saves, battles, spend controls, and truthful Dream lifecycle.

## V0.1 — OpenRouter live acceptance

Prove the entire real flow repeatedly in Chrome/Edge: connect, catalog, Dream, response-body progress, validation, bounded repair, launch, exact usage accounting, cancellation, reconnect, insufficient-balance handling, rate-limit handling, and recovery without replacing the current visualizer on failure.

## V0.2 — Music and rendering performance

Display-rate host frames; latency profiling; generated-visualizer FPS/long-frame monitoring; bounded optimization/repair for janky output; capture-ended recovery; real Chrome/Edge/macOS/Windows audio-source matrix; graceful unsupported-browser guidance.

## V0.3 — Inference-level comparison

Add a provider-neutral capability model for reasoning/inference controls. Where a supported API exposes levels such as low, medium, high, or xhigh, show them as explicit variants while preserving the same prompt and audio contract. Never invent levels a provider does not expose.

## V0.4 — Browser provider gateway

Add a small hosted gateway only when a provider cannot safely work browser-direct. It may handle OAuth callbacks, encrypted user-owned credentials, CORS, normalized requests, and usage reporting. It must not require local software and must not silently fund inference from a site-owned account.

## V0.5 — Additional providers

Add providers one at a time through `visualizer-provider-v1`, only after their supported authentication and billing model is verified. Keep provider details secondary to the model-selection experience.

## V0.6 — Gallery polish

Instant transitions; collections; recent models; reroll affordance; optional auto-rotation/party mode; better model-vs-model and inference-level Battles.

## V0.7 — Dedicated product extraction

Choose a final name/domain only after the experience deserves one; extract `/visualizer/` into its own repository without changing behavior; use a dedicated deployment and sandbox origin.

## V1 — Public ship

Production domain; hardened authentication/session behavior; cost and abuse controls; durable synced library only if it materially helps; shareable generation links; polished onboarding; public privacy/security/provider documentation.

## Explicitly outside the current roadmap

Desktop applications, native audio wrappers, localhost services, terminal setup, companion executables, browser extensions, and tunneling consumer chat subscriptions through local software.
