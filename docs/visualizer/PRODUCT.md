# AI Visualizer — Product Constitution

Working title only. Naming and branding are intentionally deferred.

## Product sentence

**Play anything. Pick an AI. Watch what it thinks music looks like.**

## Product hierarchy

1. The visualizer is the product.
2. Model comparison is the playful engine underneath it.
3. Technical benchmark and diagnostic information may exist, but must never dominate the normal experience.

## Browser-only operator boundary

The normal product is a website:

`open site → connect user-funded model access → choose model → Dream`

No terminal, localhost service, browser extension, unsigned helper, desktop companion, or computer-specific runtime is permitted in the normal flow. Hosted HTTPS/serverless infrastructure is allowed when it is invisible to the user and preserves user-funded provider access.

## Creative freedom

- Every model receives the same canonical generation prompt version.
- Every model receives the same Visualizer Audio API version.
- Models do not receive the current song, genre, reference art, competitor output, or aesthetic examples.
- The prompt does not prescribe particles, 3D, colors, darkness, futurism, geometry, or any other visual metaphor.
- Models may use any allowed browser-native visual technique.
- The primary qualitative criterion is wow factor and an intentional relationship between arbitrary music and image.

## Reliability without aesthetic censorship

Generated code is untrusted software, but unusual art is not a defect.

The host verifies engineering facts—boot, visible output, VIZ consumption, real viewport compatibility, runtime health, and reversible promotion—without requiring a particular renderer, brightness, amount of motion, composition, color, or visual metaphor.

A candidate never replaces the last-known-good visualizer until `dream-reliability-v1` passes. One same-model repair may use concrete diagnostics. Immediate post-launch failure rolls back automatically.

## Privacy sentence

**Your music stays on your device. The model creates the instrument; it never receives the song.**

Diagnostics are also local by default and never retain music, waveform/spectrum arrays, song names, or provider credentials.

## Current V0 definition of done

V0 is real only when a user can:

- open `/visualizer/` over HTTPS;
- connect shared tab/window/system audio without microphone capture;
- authorize their own OpenRouter access using PKCE;
- choose a model from the live catalog;
- generate a new visualizer using the canonical prompt;
- see truthful inference progress, cancellation, and provider failures;
- keep the previous visualizer running while generation and testing happen;
- reject or repair malformed, silent-crashing, shader-broken, blank, non-VIZ, or immediately unstable output;
- promote healthy arbitrary Canvas/DOM/SVG/WebGL/WebGPU-capable art transactionally;
- receive host audio frames at a 60 Hz target;
- enter fullscreen;
- retain verified Dreams locally;
- distinguish the visualizer currently LIVE from the model selected for the NEXT Dream;
- favorite, reopen, delete, and battle saved Dreams;
- inspect versioned local Dream traces through a hidden developer mode when troubleshooting.

## Deliberately deferred

Site-funded inference, monetization, final branding/domain, social feeds, serious leaderboards, native apps, desktop audio, consumer-subscription tunneling, community moderation, and any redesign that makes the primary canvas feel like an admin dashboard.
