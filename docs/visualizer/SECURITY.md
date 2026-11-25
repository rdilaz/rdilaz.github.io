# Generated Visualizer Security Boundary

Generated HTML is untrusted code. Artistic freedom exists inside a strict browser boundary.

## Credential boundary

OpenRouter PKCE creates user-controlled access stored in `sessionStorage`. The trusted host uses it for model generation. Generated visualizer code never receives the key, authorization headers, billing state, cookies, or host storage.

## Audio data boundary

Audio capture, media decoding, V1 analysis, and V2 expressive analysis remain entirely in the trusted browser host. A model/provider receives the versioned technical schema while generating the instrument, but never receives a song, audio bytes, waveform or spectrum history, filename, MIME declaration, object URL, queue state, source identity, metadata, or live feature value. Those values also remain outside traces, model-fit exports, diagnostics exports, and generated-art provenance.

Generated code receives only the normalized current frame selected for its artifact contract. Frames are fixed-shape and bounded; they are not persisted. Developer-mode audio evidence may inspect one current sanitized expressive snapshot without source identity or history.

## Execution boundary

Generated HTML runs in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`. It therefore receives an opaque origin and cannot obtain same-origin access to the host.

The injected CSP denies network connections, workers, child frames, plugins, forms, base-URL changes, and arbitrary resource origins. Data/blob media needed for self-contained procedural art remain available.

Music Reactivity v2 does not add sandbox authority. `VisualizerSandbox.load()` pins a closure-private resolved contract identity to each opaque-origin session. Exact V1 or V2 metadata is honored; absent, malformed, and unsupported metadata fails safely to V1. This changes only the normalized frame projection and `VIZ.version`, not CSP, permissions, origin behavior, message authentication, navigation, lifecycle, credential, storage, media, or device access.

## Dual-slot promotion boundary

The visible, last-known-good iframe remains active while an isolated candidate iframe is tested. Candidate code cannot replace the live experience until it passes boot, synthetic VIZ exercise, visible-output, actual-viewport, and post-launch watchdog checks. Promotion failure restores the previous slot.

## Diagnostic instrumentation

The injected bridge may observe runtime errors, bounded console messages, renderer/context/compiler activity, VIZ use, DOM/SVG visibility, sparse downsampled canvas fingerprints, heartbeat timing, and rollback status.

High-frequency draw/RAF/mutation instrumentation is removed after the launch watchdog to avoid becoming a permanent performance tax. Error, CSP, context-loss, VIZ, pointer, and heartbeat boundaries remain available for runtime recovery.

## Diagnostic privacy

`dream-diagnostic-v1` records and their nested `dream-trace-v1` data are local IndexedDB data and are pruned to a bounded history. They may contain exact prompts, generated model output, provider-visible reasoning, and technical metadata, but never intentionally contain:

- captured music or song metadata;
- waveform or spectrum arrays;
- expressive feature values or history;
- audio source identity, filenames, MIME declarations, object URLs, or queue state;
- microphone/camera data;
- OpenRouter/API keys;
- authorization headers;
- cookies or generated-frame access to host storage.

Copy/export is always an explicit user/developer action. Capture, display, copy, and export apply defensive recursive redaction for credentials and audio data. Provider text and generated HTML are rendered as inert text in the trusted trace viewer and execute only through the existing isolated sandbox/reliability path when explicitly retested.

After the sandbox has received any audio frame, generated `console` arguments, runtime exception text, callback errors, shader/linker text, blocked URLs, mutable element identifiers, and similar generated-controlled strings are replaced with fixed categorical or boot-captured metadata before persistence. Boot-time engineering text remains available before any audio delivery so one bounded repair can still use concrete startup failures. Contract identity remains exportable; nested audio shape metadata and feature values are recursively removed from persisted diagnostics.

## Host bridge

The intended generated-code input is the read-only `window.VIZ` API supplied through authenticated per-load host messages. The iframe may report ready, heartbeat, pointer, probe, and bounded diagnostic events to the parent; the parent accepts only messages from the exact iframe window and current random session identifier.

## Explicitly unavailable to generated code

Provider credentials, host cookies, host local/session storage, IndexedDB library/diagnostics, microphone/camera capture, clipboard, geolocation, arbitrary network requests, and top-level navigation privileges.

## Audio privacy

Audio analysis occurs only in the trusted host page using Web Audio. Model requests contain the canonical generation prompt and, at most, generated code plus technical repair diagnostics. Captured music, local files, filenames, MIME declarations, File objects, object URLs, bytes, queue state, source identity, waveform/spectrum history, and live feature values are never sent to the model provider. Generated code receives only the normalized current V1 or V2 frame, never source identity or retained history.

Local Player v1 uses a trusted HTML media element and a MediaElementAudioSourceNode. Its primary analyser has exactly one destination connection so user-requested local playback is audible once. Display/system and microphone MediaStream source graphs have no destination connection, preventing host monitoring and feedback. Local object URLs are session-only and revoked on removal, replacement, clear, disconnect, or page exit. Browser decoding remains the file-content authority; names and declared MIME types are treated as untrusted inert text.

## Commercial hosting review pending

GitHub Pages is the incubation host, not an approved commercial SaaS trust boundary. Before accounts, paid features, or public artifact delivery, a separate review must isolate untrusted artifact delivery from the trusted account origin; evaluate direct navigation to artwork URLs and navigation/network boundaries; harden credentials, headers, dependencies, and secret handling; and enforce reviewed main-branch CI. This milestone performs none of those migrations or audits.

Known inherited browser limitation: `sandbox="allow-scripts"` prevents generated code from navigating the parent/top context and CSP blocks fetch/connect/subresource channels, but Chromium still permits an opaque child document to initiate navigation of its own iframe. The host detects the lost bridge and fails or rolls back, but the browser may already have initiated that document request. The milestone's explicit navigation/CSP boundary forbids changing this behavior here, so commercial or security acceptance remains blocked on a separate architecture review rather than being claimed by Better Ears.

Managed paid generation is also deferred. It requires server-enforced authentication, budgets, idempotent accounting, abuse controls, and a clear failure/refund policy. Current client-only spend caps protect a user-funded browser session; they are not authority for site-funded billing. Cloud library/sharing and community features remain gated on separate trust, rights, moderation, and privacy work.
