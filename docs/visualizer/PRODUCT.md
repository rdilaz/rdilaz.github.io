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

**Neutral creative brief status:** `neutral-v1` remains frozen and unchanged. Reasoning, spend, model-fit, transport, sensitivity, and documentation work must not rewrite it.

## Reliability without aesthetic censorship

Generated code is untrusted software, but unusual art is not a defect.

The host verifies engineering facts—boot, visible output, VIZ consumption, real viewport compatibility, runtime health, and reversible promotion—without requiring a particular renderer, brightness, amount of motion, composition, color, or visual metaphor.

A generated candidate becomes ready only after `dream-reliability-v3` preflight passes. It does not replace the last-known-good visualizer until the user chooses Open and the reversible launch watchdog succeeds. One same-model repair may use concrete diagnostics. Fatal post-launch failures roll back immediately; inferred heartbeat stalls require one bounded confirmation probe.

## Privacy sentence

**Your music stays on your device. The model creates the instrument; it never receives the song.**

Diagnostics are also local by default and never retain music, waveform/spectrum arrays, song names, or provider credentials.

## Current V0 definition of done

V0 is real only when a user can:

- open `/visualizer/` over HTTPS;
- explicitly choose shared tab/window/system audio, local microphone capture, or session-only local music files;
- authorize their own OpenRouter access using PKCE;
- choose a model from the live catalog;
- generate a new visualizer using the canonical prompt;
- see truthful streamed inference progress, cancellation, idle/hard timeout, and provider failures;
- keep the previous visualizer running while generation and testing happen;
- reject or repair malformed, silent-crashing, shader-broken, blank, non-VIZ, or immediately unstable output;
- promote healthy arbitrary Canvas/DOM/SVG/WebGL/WebGPU-capable art transactionally;
- receive host audio analysis from an independent 60 Hz target while generated VIZ delivery follows the selected local render profile;
- enter fullscreen;
- retain verified Dreams locally;
- distinguish the visualizer currently LIVE from the model selected for the NEXT Dream;
- favorite, reopen, delete, and battle saved Dreams;
- inspect versioned local Dream traces through a hidden developer mode when troubleshooting.

## Product Shell / Core UX v1

The normal product loop is now:

`LIVE Dream → visual Play/Pause → music source → Dreams switcher → NEXT AI → Prompt → Dream → explicit Open when ready`

- A first visit starts with working art and does not require provider authorization.
- Play/Pause is trusted host control over the visual experience. It stops active VIZ delivery and generated animation frames without reloading the Dream. External tab/system or microphone-heard music remains controlled by its source.
- A paid Dream is one background job at a time. Its detail panel can collapse while the request, optional same-model repair, and hidden preflight continue.
- OpenRouter completion transport is streamed privately. Network activity extends the idle deadline; a secondary hard ceiling remains. Only a normal `[DONE]` stream with a fully assembled response may enter artifact validation.
- Provider-complete, preflight-ready, and LIVE are separate truths. A ready artifact is saved locally before the UI offers Open; generation success never auto-interrupts LIVE.
- Passive viewing is immersive: host chrome and cursor fade after inactivity in normal or fullscreen viewing, and trusted host/iframe activity restores them without stealing the generated Dream's gesture.
- Full, Balanced, and Saver are host-owned render choices. They cap generated cadence and JavaScript-visible DPR locally without changing audio analysis, the prompt, model request, generated HTML, or saved artifact.
- Featured, Favorites, and Recent provide the fast media-style switcher. The full Library, spend controls, battles, traces, and diagnostic detail remain secondary.
- Normal mode keeps provider and reliability machinery out of the primary canvas loop. `?dev=1` retains local sanitized diagnostics and one-click debug material.
- Spend caps reserve the maximum dispatched request cost before network execution. Exact final-stream usage reconciles that reservation; cancellation or uncertain transport keeps the conservative reservation so repeated aborts cannot bypass session/daily protection. One bounded generation-metadata lookup may reconcile an existing reservation, but never creates another completion.
- Cost copy keeps three truths separate: compatible exact billed history (`No estimate yet`, `Last`, or median `Usually`), the enforced initial-request maximum, and a developer-only theoretical catalog ceiling. A confirmation names the strict whole-Dream maximum, including one possible repair, before expensive dispatch. Users may deliberately raise Spend protection and authorize an expensive Dream; the product prevents surprise spend rather than imposing a hidden low ceiling.
- Reasoning begins at native `Default` omission and exposes only choices advertised by the exact live model. Affordability blocks rather than silently lowering a chosen effort.
- `Recommended` is grounded only by an exact currently eligible model in the operator catalog or a compatible successful run in this browser. Automated live-catalog rankings are disclosed as `Experimental`, never promoted to recommendation; developer mode opens the broad eligible catalog and local evidence statuses without turning them into approval. The operator catalog is currently empty, so no operator-approved starting model is claimed.

Host controls remain outside model authorship. In a safe canvas context, Left/Right wraps through Favorites in their displayed order; from a non-Favorite, Right opens the first and Left the last. A Favorite loads in the standby sandbox and becomes LIVE only after its open watchdog commits, so an absent or failed target leaves current LIVE intact and a background Dream may continue. Up/Down changes host audio sensitivity, while the persisted range and Reset support pointer/touch control from 50% to 200% in 10% steps with a 100% default. Sensitivity is a post-normalization host transform: it changes reactive values delivered through VIZ but not the canonical prompt, provider request, stored/generated artifact, model identity, pointer state, or non-reactive audio facts.

The Featured set contains two operator-approved model-generated artifacts plus the host-created Calibration Bloom fallback: Klangfiguren from GLM 5.3 Flash, Nexus Beam from Gemini 3.8 Flash, and Calibration Bloom. Nexus Beam is editorial display metadata over the immutable model title `Kinetic Harmonic Astrolabe`; generated HTML is not rewritten for naming. Calibration remains the sole startup. Every loadable entry requires a repository-local HTML path, content digest, CI reliability evidence, and accepted curation record. Developer export creates a pending-review package that cannot enter Featured until an operator supplies approval and complete model/request/prompt/trace provenance. No regression fixture or hand-authored substitute is presented as model output.

Dream presentation metadata is separate from artifact identity. Featured titles come from operator curation, while a saved local Dream can receive one short user-edited display title from its Library row. Clearing that title returns to the captured artifact title or deterministic model/generation fallback without changing HTML, trace, prompt hash, model-fit identity, or provenance. Dream switcher, Library details, and READY presentation show a human prompt label: an exact saved Prompt Library name when available, a known built-in preset name, a captured prompt name, or a deterministic truthful fallback.

## First Session v1

**Implementation status:** Implemented and CI-verified in PR #36; production desktop and real-iPhone acceptance remain pending.

The bounded first-session journey is:

`working Calibration Bloom startup → understand Dream + privacy boundary → connect external/microphone audio or choose local files → explore Featured guidance → control playback → favorite and revisit a Dream`

- The compact first-run story says: **AI creates the visual instrument. Your music stays on this device.** It defines a Dream as a reusable visual instrument rather than a song-specific uploaded video, distinguishes host-created Calibration Bloom from AI-generated Featured art, and opens the existing audio chooser or Featured switcher without requiring provider authorization.
- Only `ai-visualizer.first-session.v1` completion is persisted. Storage denial falls back to an in-memory dismissal; the story can be reopened from About and does not take focus on a fresh visit.
- Featured guidance is host-owned editorial metadata outside immutable artwork. Klangfiguren is described as a Chladni-inspired artistic interpretation, Nexus Beam retains the immutable artifact title `Kinetic Harmonic Astrolabe`, and Calibration Bloom remains explicitly host-created.
- Local Player v1 uses user-selected browser-decodable files, a trusted media element, and one audible MediaElementAudioSource graph feeding the existing normalized analysis. Its session-only queue is bounded to 24 files, 512 MiB per file, and 2 GiB total; object URLs are revoked when entries are replaced, removed, cleared, or disconnected.
- Selecting files never autoplays. With local music, primary Play/Pause controls music and visuals together from actual media state; external shared/microphone sources retain visual-only Pause and are never routed to speakers by the host.
- Filenames, MIME declarations, File objects, object URLs, metadata, and bytes remain outside VIZ, provider requests, diagnostics, traces, and debug exports. Generated code receives no additional authority.
- A fresh reduced-motion visit starts the existing trusted visual playback controller paused. This is a host default, not a claim that arbitrary generated motion is certified safe.

## Commercial hypotheses

Repeat listening and creator value are hypotheses to validate, not proven demand. Potential later paid value includes reusable custom Dreams, validated recording/export, curated collections, and optional managed generation with explicitly bounded credits. Basic privacy, accessibility, safety, and user control remain core product responsibilities rather than paid upgrades.

## Deliberately deferred

Accounts, billing, public sharing, video export, marketplaces, site-funded inference, monetization, final branding/domain, social feeds, serious leaderboards, native apps, service-specific audio integrations, consumer-subscription tunneling, community moderation, persistent audio storage, remote audio URLs, and any redesign that makes the primary canvas feel like an admin dashboard.
