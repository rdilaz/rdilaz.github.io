# Generated Visualizer Security Boundary

Generated HTML is untrusted code. Artistic freedom exists inside a strict browser boundary.

## Credential boundary

OpenRouter PKCE creates user-controlled access stored in `sessionStorage`. The trusted host uses it for model generation. Generated visualizer code never receives the key, authorization headers, billing state, cookies, or host storage.

## Execution boundary

Generated HTML runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`. It therefore receives an opaque origin and cannot obtain same-origin access to the host.

The injected CSP denies network connections, workers, child frames, plugins, forms, base-URL changes, and arbitrary resource origins. Data/blob media needed for self-contained procedural art remain available.

## Dual-slot promotion boundary

The visible, last-known-good iframe remains active while an isolated candidate iframe is tested. Candidate code cannot replace the live experience until it passes boot, synthetic VIZ exercise, visible-output, actual-viewport, and post-launch watchdog checks. Promotion failure restores the previous slot.

## Diagnostic instrumentation

The injected bridge may observe runtime errors, bounded console messages, renderer/context/compiler activity, VIZ use, DOM/SVG visibility, sparse downsampled canvas fingerprints, heartbeat timing, and rollback status.

High-frequency draw/RAF/mutation instrumentation is removed after the launch watchdog to avoid becoming a permanent performance tax. Error, CSP, context-loss, VIZ, pointer, and heartbeat boundaries remain available for runtime recovery.

## Diagnostic privacy

`dream-diagnostic-v1` records are local IndexedDB data and are pruned to a bounded history. They may contain generated model output and technical metadata, but never intentionally contain:

- captured music or song metadata;
- waveform or spectrum arrays;
- microphone/camera data;
- OpenRouter/API keys;
- authorization headers;
- cookies or generated-frame access to host storage.

Copy/export is always an explicit user/developer action. Export applies a defensive redaction pass for credential and audio-field names.

## Host bridge

The intended generated-code input is the read-only `window.VIZ` API supplied through authenticated per-load host messages. The iframe may report ready, heartbeat, pointer, probe, and bounded diagnostic events to the parent; the parent accepts only messages from the exact iframe window and current random session identifier.

## Explicitly unavailable to generated code

Provider credentials, host cookies, host local/session storage, IndexedDB library/diagnostics, microphone/camera capture, clipboard, geolocation, arbitrary network requests, and top-level navigation privileges.

## Audio privacy

Audio analysis occurs only in the trusted host page using Web Audio. Model requests contain the canonical generation prompt and, at most, generated code plus technical repair diagnostics. Captured music and live audio features are never sent to the model provider.
