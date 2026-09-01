# Generated Visualizer Security Boundary

Generated HTML is untrusted code.

## Credential boundary

V0 uses OpenRouter's PKCE authorization flow. The resulting user-controlled API key is stored in `sessionStorage`, so it disappears when the browser session ends. The key is used only by the trusted host page to request model generations. Generated visualizer code never receives this key.

## Execution boundary

Generated HTML runs in an iframe with `sandbox="allow-scripts"`. Critically, `allow-same-origin` is not granted. The generated document therefore receives an opaque origin and cannot use same-origin access to the host page.

The host also injects a restrictive CSP that denies external connections, workers, child frames, plugins/objects, forms, and arbitrary resource origins. Data/blob images are allowed so models can create procedural in-document assets.

## Host bridge

The only intended input is the read-only `window.VIZ` object injected before model code. Host frames arrive through `postMessage`. The sandbox may report `ready` and runtime errors back to the parent; other messages are ignored.

## Explicitly unavailable to generated code

OpenRouter/API credentials, host cookies, host storage, IndexedDB library data, microphone/camera capture, clipboard, geolocation, arbitrary network requests, and top-level navigation privileges.

## Audio privacy

Audio analysis occurs in the trusted host page using Web Audio. The model API receives the visualizer prompt and code-repair context only. Captured music, waveform, spectrum, track names, and audio features are not sent to the model provider.

## Future hardening

Before moving to a dedicated public domain, serve generated visualizers from a dedicated sandbox origin in addition to iframe/CSP isolation, add production CSP response headers, abuse/rate controls, generation size/time budgets, and telemetry for sandbox failures that contains no captured audio.
