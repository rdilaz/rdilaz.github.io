# AI Visualizer Security Boundaries

Generated HTML is untrusted code, and connected provider credentials are sensitive user-owned access.

## Browser-only provider boundary

The normal product requires no local server, desktop companion, executable, terminal, browser extension, or localhost connection. OpenRouter is currently browser-direct through PKCE. Future providers may use a hosted HTTPS gateway when required for CORS, OAuth, or credential protection, but the user's experience must remain browser-only.

The current product uses user-funded provider access. A provider adapter must declare `billing: "user"` and `browserOnly: true` before registration. Consumer chat subscriptions are not tunneled through unofficial local clients. A subscription may be supported only when the provider offers an official third-party authorization/API path for that use.

## Credential boundary

OpenRouter's user-controlled key is stored in `sessionStorage`, so it disappears when the browser session ends. It is used only by the trusted host page for model generation. Generated visualizer code never receives the key.

A future hosted gateway must keep provider credentials server-side or use short-lived delegated tokens, encrypt stored secrets, scope access narrowly, and never place management credentials in browser JavaScript.

## Execution boundary

Generated HTML runs in an iframe with `sandbox="allow-scripts"`. `allow-same-origin` is not granted, so the generated document receives an opaque origin and cannot use same-origin access to the host page.

The host injects a restrictive CSP that denies external connections, workers, child frames, plugins/objects, forms, and arbitrary resource origins. Data/blob images are allowed so models can create procedural in-document assets.

## Host bridge

The only intended generated-code input is the read-only `window.VIZ` object injected before model code. Host frames arrive through `postMessage`. The sandbox may report `ready` and runtime errors back to the parent; other messages are ignored.

## Explicitly unavailable to generated code

Provider credentials, host cookies, host storage, IndexedDB library data, microphone/camera capture, clipboard, geolocation, arbitrary network requests, and top-level navigation privileges.

## Audio privacy

Audio analysis occurs in the trusted host page using Web Audio. The model provider receives the canonical visualizer prompt and bounded code-repair context only. Captured music, waveform, spectrum, track names, and live audio features are not sent to the model provider or a future gateway.

## Future hardening

Before moving to a dedicated public domain, serve generated visualizers from a dedicated sandbox origin in addition to iframe/CSP isolation, add production CSP response headers, provider-specific rate/abuse controls, generation size/time budgets, credential rotation/revocation, and sandbox-failure telemetry that contains no captured audio.
