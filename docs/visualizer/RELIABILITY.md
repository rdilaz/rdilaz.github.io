# Dream Reliability Harness

Version: `dream-reliability-v1`

## Product rule

Generated visualizers remain artistically unconstrained. They may use Canvas 2D, SVG, DOM/CSS, WebGL, WebGL2, WebGPU when available, typography, shaders, procedural simulations, static composition, slow motion, darkness, or combinations the host did not anticipate.

The host verifies behavior rather than prescribing appearance:

> A candidate may become visible only after there is credible evidence that it booted, rendered, consumed the standardized VIZ interface, survived deterministic music stimulation, handled the real viewport, and remained alive during a reversible launch window.

## Transactional promotion

The product owns two sandbox slots:

1. the active, last-known-good visualizer;
2. a hidden candidate visualizer.

The active slot keeps playing while a background candidate is generated and tested. Readiness and launch are separate transactions:

`model output → static compatibility → boot → synthetic VIZ exercise → visible-output proof → actual-viewport canary → persist ready artifact`

Nothing changes LIVE at this point. When the user chooses Open, the host performs a lighter actual-device safe reopen, makes the candidate visible with rollback armed, runs the post-launch watchdog, and commits LIVE only on success:

`ready artifact → safe reopen → candidate visible with rollback armed → watchdog → commit LIVE`

The previous slot remains warm throughout the post-launch watchdog. A fatal runtime error, context loss, probe failure, or heartbeat stall causes immediate rollback instead of a blank stage.

After the watchdog passes, high-frequency instrumentation is removed from the promoted iframe so the verification system does not become a permanent rendering tax.

Stored artifacts with current ready/verified evidence use the shorter safe-reopen probe instead of repeating the full generation preflight. They still execute only in the opaque-origin sandbox and still pass the visible launch watchdog. A failed Open preserves the prior LIVE Dream and keeps the ready artifact/evidence with `failed-to-open` state for later inspection.

The host inserts CSP and the trusted bridge structurally into the actual parsed document head. Host commands and sandbox evidence travel over a closure-private `MessageChannel`; generated code cannot read probe IDs or impersonate readiness, pause, or resume through window messages. All hidden candidate work, including developer retests, shares one serialized standby-slot lease. Active failures during Open/recovery are latched and processed afterward if that failed session is still LIVE.

## Trusted visual pause

Visual pause is enforced by the injected host bridge, not by generated-model cooperation and not by presentation blur:

- active host VIZ delivery stops before audio sampling;
- generated `requestAnimationFrame` callbacks are queued without destroying Canvas/WebGL/WebGPU state;
- RAF callback time excludes the paused duration so resume does not create a large artificial time jump;
- running CSS/Web Animations are paused where the browser exposes them, and only host-paused animations are resumed;
- trusted heartbeat and diagnostic timers continue, so intentional pause is not mistaken for renderer death;
- hidden generation preflight and deterministic synthetic candidate frames continue;
- a Dream opened or switched while globally paused becomes LIVE in the paused state.

Multiple pause/resume commands are idempotent. `Element.animate()` and replayed Web Animations are covered by the trusted pause layer. Timer and `setInterval` loops that do not use RAF may continue in v1; the host does not constrain generated art solely to make those loops perfectly freezable.

## What the injected flight recorder observes

The host injects the recorder before generated code. It records only engineering signals:

- uncaught errors and unhandled promise rejections;
- `console.error` and bounded `console.warn` messages;
- CSP violations;
- animation-frame and heartbeat health;
- VIZ frame reads, subscriptions, callbacks, and delivered host-frame count;
- Canvas 2D paint/clear activity;
- WebGL/WebGL2 context creation, shader compilation, program linking, draw calls, and context loss;
- WebGPU canvas configuration and queue submissions when available;
- bounded DOM/SVG/CSS visibility evidence;
- sparse, downsampled canvas fingerprints used only inside the browser.

It never records captured waveform or spectrum arrays, song names, audio content, OpenRouter credentials, authorization headers, cookies, or browser storage from generated code.

## Medium-agnostic visible-output proof

The harness does not require a canvas or animation style.

Canvas/WebGL/WebGPU candidates can prove life through current pixel evidence or successful rendering activity. DOM/SVG/CSS candidates can prove life through visible graphical/text elements, layout coverage, style state, and animation evidence.

A dominant full-screen canvas must prove itself; a tiny HUD cannot hide a failed renderer. Conversely, an intentionally black renderer is not automatically rejected when its graphics pipeline demonstrably compiled, linked, and drew. Lack of a large visual delta under synthetic music is a warning, not a failure, because subtle interpretations are valid.

## Deterministic music stimulation

Preflight never uses or stores the user's song. It supplies the same local synthetic sequence to every candidate:

- silence/near-silence;
- bass-heavy impact;
- mid-rich sustained material;
- treble/transient material;
- stereo and tempo changes;
- a mixed settling frame.

The sequence verifies that generated code remains healthy and consumes `VIZ`. It is not an aesthetic target and is not visible to the model during generation.

## Repair boundary

One Dream permits at most one same-model repair. Repair receives concrete machine diagnostics—failure code, viewport, renderer, VIZ usage, shader/link log, runtime error, and visible-output evidence—while being explicitly told to preserve the artistic concept.

There is never a second automatic repair. Provider timeouts or uncertain provider execution are not automatically retried.

## Failure taxonomy

Stable codes include:

- `INVALID_HTML`
- `BOOT_TIMEOUT`
- `RUNTIME_ERROR`
- `VIZ_CALLBACK_ERROR`
- `RENDER_CONTEXT_FAILED`
- `SHADER_COMPILE_FAILED`
- `PROGRAM_LINK_FAILED`
- `NO_VISIBLE_OUTPUT`
- `VIZ_NOT_CONSUMED`
- `RUNTIME_STALLED`
- `WEBGL_CONTEXT_LOST`
- `PERFORMANCE_COLLAPSE`
- provider-specific request failures supplied by the provider adapter

Heavy but functioning rendering is normally a warning (`HEAVY_RENDERER`), not an aesthetic veto.

## Local diagnostics and developer mode

Every attempt—including safe failures—gets a bounded local IndexedDB record under `dream-diagnostic-v1`. New records carry a nested `dream-trace-v1` conversation and attempt history containing the exact sanitized application-boundary request/response evidence when captured, while legacy records remain readable and explicitly label fields that older app versions did not capture. Records include provider/model/request identity when available, timings, token/cost metadata, generated HTML, static checks, renderer evidence, repair history, promotion/watchdog status, failure code, and rollback reason.

Developer mode is intentionally hidden from normal users:

- append `?dev=1` to `/visualizer/`;
- or press `Ctrl+Shift+D`;
- or call `window.VIZ_DEV.enable()` in DevTools.

`window.VIZ_DEV` can list/export diagnostics and traces, copy exact captured messages/output/HTML, report LIVE versus NEXT identity, run a no-cost transparency fixture, and deterministically retest stored HTML. Export is explicit, recursively redacted, and local-only by default.

## Regression corpus

CI runs real Chromium tests for Canvas 2D, DOM/SVG, broken WebGL shaders, a DOMContentLoaded-but-blank page, intentionally black valid WebGL, trusted visual pause/resume, shipped Calibration Bloom Featured art, explicit-Open failure, delayed post-launch failure, and the real Gemini 3.7 Flash `AETHERIA :: Resonant Topology` output that exposed the original blank-screen false positive.
