# AI Visualizer Product Roadmap

Status: canonical product-direction document

This roadmap is the durable reference for turning the working AI Visualizer experiment into a simple, enjoyable product without weakening the core creative idea.

## Product thesis

**Play anything. Pick an AI. Watch what it thinks music looks like.**

The product should feel immediate and playful, not like a developer console. A new visitor should see excellent visual art before configuring anything, understand the main controls in seconds, and be able to generate, save, switch, pause, and revisit Dreams without learning the implementation.

The AI remains creatively unconstrained. The host defines only the technical/runtime boundary required for the work to run safely and react to music.

## Core invariants

These remain true through every milestone:

- The browser is the product.
- The user can play arbitrary audio through the existing system/tab-audio capture path.
- Audio stays local unless a future source integration explicitly requires otherwise.
- Generated visualizers remain isolated in the network-denied sandbox.
- Models receive the same music-state API and no song/genre/reference artwork.
- The host must not prescribe an aesthetic or rendering technology.
- A candidate never destroys the currently working visualizer before proving itself.
- At most one same-model repair is automatic.
- LIVE and NEXT remain separate truths.
- Dream traces remain available for debugging, but engineering detail stays out of the normal product path.
- BYO-provider/user-funded inference remains the default billing boundary until an explicit monetization milestone changes it.

## North-star normal experience

1. Open the Visualizer.
2. An excellent featured Dream is already running.
3. Connect audio, or optionally play audio in a future built-in player.
4. Switch instantly among Featured, Favorites, and Recent Dreams.
5. Pick a model and a prompt style.
6. Press Dream.
7. Keep using the current visualizer while the new Dream generates in the background.
8. See compact, trustworthy progress and a clear completion notification.
9. Open the result, compare it, favorite it, or leave the current visualizer untouched.
10. Pause/resume the visual experience at any time.

Everything else is progressive disclosure.

---

# Stage 1 — Product Shell / Core UX v1

Implementation is present on the current milestone branch, but deployment and product acceptance are not claimed. Repeated real-browser checks, operator model/catalog review, curated content, and mobile acceptance remain.

Goal: make the working system feel like a product rather than a lab.

## 1. Featured Dreams

Ship 2–3 curated, deterministic example Dreams with the site.

Requirements:

- At least one excellent Dream is live immediately on first visit.
- Featured examples are real accepted visualizer HTML, not screenshots or mockups.
- Featured items identify the model and prompt profile that created them.
- They do not require OpenRouter or audio connection to display.
- They can be switched instantly.
- They remain distinct from the user's local Favorites/Recent library.
- Featured content can be replaced editorially as better examples are discovered.

## 2. Fast Dream switcher

Replace the current library-heavy mental model with a compact media-style switcher.

Primary groups:

- Featured
- Favorites
- Recent

Desired behavior:

- one click/tap switches LIVE;
- optional thumbnail/preview where technically practical;
- keyboard arrows and mobile swipe can follow later;
- model + short Dream identity visible without opening diagnostics;
- full Library management moves behind secondary detail.

## 3. Background Dream jobs

Generation must not trap the user in a modal state.

Requirements:

- Existing LIVE Dream keeps running while generation occurs.
- User can close/dismiss the large generation surface and keep browsing the product.
- A small persistent job indicator remains visible.
- The job has clear states: sending, model working, receiving, checking, ready, failed safely.
- The user can reopen the job panel at any time.
- When complete, show an unmistakable in-app notification such as `Dream ready` with `Open`.
- A completed Dream does not automatically interrupt what the user is watching unless the user chose that behavior.
- Failure remains safe and inspectable.
- Optional browser/system notifications are a later enhancement and must remain opt-in.

## 4. Global PAUSE

Pause is a first-class product control.

### Visual pause

This must work regardless of the audio source.

Desired behavior:

- one obvious Play/Pause control;
- pause freezes generated animation as completely as the sandbox can safely enforce;
- host VIZ frame delivery stops while paused;
- sandbox requestAnimationFrame execution is suspended/resumed by the trusted injected bridge;
- CSS animations/transitions are paused where practical;
- pausing must not destroy WebGL/WebGPU/Canvas state;
- resuming continues the same Dream rather than reloading it;
- LIVE identity remains unchanged;
- paused state is visually obvious;
- optional tasteful blur/dim overlay can be enabled by product design, but blur is presentation, not the pause mechanism;
- generation jobs may continue in the background while the currently displayed Dream is paused.

Timers or unusual custom loops that do not use requestAnimationFrame may not be perfectly stoppable in v1; this should be treated as an instrumentation boundary, not a reason to constrain model creativity.

### Music pause

Music-source control is separate from visual pause.

The generic system/tab audio capture path is observational. The Visualizer cannot assume authority to pause arbitrary playback in another site, tab, desktop app, or DRM service.

Therefore:

- when audio is externally captured, global Pause pauses the visual experience/analysis but must not falsely claim to have paused the external music;
- source-control UI must truthfully indicate when the external player must be paused in its own app;
- when audio is owned by the Visualizer itself, the same transport control may pause both music and visuals.

## 5. Simplified chrome

Normal mode should expose only the controls needed for the main loop.

Target primary controls:

- LIVE identity
- Play/Pause
- Audio/source
- NEXT model
- Prompt
- Dream
- Featured/Favorites/Recent switcher
- Fullscreen

Move or hide behind secondary surfaces:

- spend details;
- diagnostics;
- trace internals;
- battle mechanics;
- provider details;
- advanced model catalog details;
- implementation terminology.

Spend protection remains active even when its UI is secondary.

---

# Stage 2 — Prompt Productization

Prompt Lab already proves custom creative briefs work. Convert that capability into a friendly product surface.

## Prompt presets

Start with a small set, not a giant gallery.

Candidate product presets:

- Blank Canvas — minimal creative direction.
- Cinematic — immersive/dramatic framing.
- Minimal — restrained interpretation.
- Experimental — unusual visual language encouraged.
- Custom — user-written creative brief.

The fixed technical runtime/VIZ contract stays separate and non-editable in normal use.

## Prompt library

Later:

- save custom prompts;
- rename prompts;
- reuse recent prompts;
- favorite prompt/model combinations;
- show which prompt created a saved Dream.

Prompt presets are creative choices, not hidden quality tiers.

---

# Stage 3 — Built-in Player / Source Controls

Goal: offer a clean music-player experience when the Visualizer actually owns playback.

## Local-first web player

The safest first source is user-selected local audio played entirely in the browser.

Potential capabilities:

- drag/drop or choose local audio files;
- local playlist/queue;
- play/pause;
- previous/next;
- seek/progress;
- volume;
- repeat/shuffle later;
- track title/metadata when available locally;
- Media Session integration so hardware/OS play-pause controls can control this page's playback.

Files should remain local by default and should not be uploaded merely to play them.

The UI may use a familiar compact music-player mental model, but should not copy protected brand assets or falsely imply Spotify/Apple affiliation.

## External capture mode

Keep the existing `Play anything` system/tab-capture path as a first-class mode.

In this mode:

- Visualizer observes audio;
- song metadata may be unknown;
- transport controls that require authority over the external source are disabled or clearly delegated to the source app.

## Service integrations

Do not add Spotify, Apple Music, YouTube, or another service simply because an API exists.

Each integration requires a separate review of:

- current developer terms;
- synchronization/visualization restrictions;
- commercial-use rights;
- OAuth/security requirements;
- subscription requirements;
- playback limitations;
- whether the integration compromises `Play anything` simplicity.

Spotify is specifically **not an assumed roadmap dependency**. Current Spotify developer documentation states restrictions on commercial streaming applications and synchronizing Spotify recordings with visual media, which is directly relevant to this product.

---

# Stage 4 — Interaction / Remix Controls

Goal: let users shape a Dream without turning every model into the same instrument.

Do not immediately force universal aesthetic sliders such as `colorfulness` or `particles`; those would bias model output and weaken the core experiment.

Preferred directions to investigate:

## A. Optional model-authored controls

A future opt-in generation/repair contract could allow a Dream to declare a small safe control schema, for example sliders/toggles whose meaning the model chooses.

Examples could be `density`, `camera`, `memory`, `tension`, or something completely unexpected.

This must be optional because telling every model to produce sliders is itself creative priming.

## B. Post-generation Remix

The user can explicitly ask the same model to add controls to an already-loved Dream while preserving its concept.

This keeps the initial blank-canvas generation clean.

## C. Host-neutral parameters

Investigate truly generic parameters only if they do not impose a visual vocabulary.

No control scheme is approved yet.

---

# Stage 5 — Sharing / Social Product

After the single-user experience is excellent:

- share a Dream by link;
- portable Dream metadata + generated HTML;
- public/private visibility;
- creator attribution;
- prompt/model attribution where desired;
- public gallery;
- curated featured gallery;
- remix/fork lineage;
- likes/favorites only after the browsing experience is strong.

Generated code must continue to run inside the same sandbox boundary even when loaded from shared/cloud storage.

---

# Stage 6 — Accounts / Cloud Library

Only when local-first usage has proven demand:

- user accounts;
- cloud sync of Favorites/Recent;
- prompt library sync;
- cross-device access;
- larger history;
- backups;
- account deletion/export controls.

Local anonymous use should remain possible where practical.

---

# Stage 7 — Monetization

Do not optimize the current product around monetization before repeat usage is proven.

Likely business models to test later:

## Free / BYO provider

- user connects OpenRouter;
- local library;
- featured examples;
- core playback and visualization;
- limited/no cloud storage.

## Paid convenience

Potential value:

- site-funded model credits;
- cloud Dream history;
- cross-device sync;
- larger prompt library;
- advanced comparison/remix tools;
- premium curated model/prompt recommendations;
- higher storage/share limits.

## Creator/community value

Potential later paths:

- public galleries;
- paid creator packs/prompt packs only if they genuinely add value;
- commissioned/curated visual experiences;
- events/installations/licensing.

Never silently spend site/user money, and keep exact spend accounting visible wherever the product funds inference.

---

# Stage 8 — Advanced / Neat Features Backlog

These are explicitly below the core product path:

- model-authored sliders;
- visualizer battles/leaderboards;
- automated prompt tournaments;
- model personality statistics;
- generation streaming/code-progress visualization;
- optional browser notifications;
- hardware MIDI/controller input;
- projection/installation mode;
- multi-screen output;
- collaborative sessions;
- mobile remote control;
- live performance mode;
- visual recording/export;
- video rendering;
- reactive lyrics/text only where rights/privacy permit;
- service-specific playback connectors after terms review.

---

# Immediate milestone order

Unless new evidence changes the priority, close and validate milestones in this order:

1. **Product Shell / Core UX v1**
   - Featured Dreams
   - Featured/Favorites/Recent fast switcher
   - background Dream jobs + ready notification
   - global visual Play/Pause
   - simplified chrome

2. **Prompt Productization v1**
   - friendly preset picker
   - Custom prompt
   - prompt attribution in saved Dreams

3. **Built-in Local Player v1**
   - local files + queue + transport controls
   - Media Session support
   - clear source-mode distinction

4. **Core UX refinement**
   - mobile
   - accessibility
   - transitions
   - first-use onboarding
   - latency/progress wording

A later deep HCDD/UX polish pass should be driven by observed first-use, model-choice, spend-confirmation, and failed-Dream behavior after the evidence campaign; it is not a substitute for current milestone verification.

5. **Sharing discovery**

6. **Monetization discovery**

Model-authored controls remain a later experiment rather than a dependency for product launch.

---

# Current product acceptance target

The next meaningful product checkpoint is:

> A first-time visitor can open the site, immediately see beautiful working examples, connect music, switch among Dreams, pause/resume the visual experience, start a new Dream without being trapped waiting for it, know when it is ready, and reopen/favorite it without ever seeing developer machinery.

When this statement is true on desktop and mobile, the Visualizer has crossed from a successful technical experiment into an early usable product.
