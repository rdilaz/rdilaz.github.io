# Visualizer development

This guide is for working on the Visualizer product shell, reliability, and Dream transparency in VS Code on Windows. The normal product remains browser-only; Node and Vite are development tools, not part of the user flow.

## Windows setup

1. Open `C:\Users\Ryo\Documents\GitHub\rdilaz.github.io` in VS Code.
2. Open a PowerShell terminal with `Terminal` -> `New Terminal`.
3. Confirm that `git branch --show-current` prints your current milestone branch and not `main`.
4. Install the locked dependencies:

```powershell
npm.cmd ci
```

5. Start Vite:

```powershell
npm.cmd run dev
```

6. Open:

```text
http://localhost:5173/visualizer/index.html?dev=1
```

PowerShell can resolve `npm` to the `npm.ps1` shim. A restrictive script execution policy may block that unsigned PowerShell script even though Node and npm are installed correctly. Calling `npm.cmd` explicitly uses npm's Windows command shim and avoids weakening the PowerShell execution policy. Use `npx.cmd` for the same reason.

## Start reading here

Read these files in order for the shortest path through a Dream:

1. `public/visualizer/app.js` - composition, promotion/rollback orchestration, Library, and developer tools.
2. `public/visualizer/playback-state.js`, `dream-job.js`, and `dream-switcher.js` - focused product state and shell views.
3. `public/visualizer/featured-dreams.js` and `featured/manifest.js` - curated static Dream loading and pending-review export.
4. `public/visualizer/prompt.js` - the versioned generation and repair messages.
5. `public/visualizer/provider-runtime.js`, `openrouter-sse.js`, and `reasoning-settings.js` - provider normalization, private SSE assembly, exact reasoning choices, request construction, and HTML extraction.
6. `public/visualizer/cost-guard.js`, `completion-accounting.js`, `dream-transport.js`, and `generation-envelope.js` - request reservation/settlement, activity-aware transport deadlines, the quality-first envelope, and the last browser boundary before a paid request.
7. `public/visualizer/model-fit-evidence.js`, `model-product-catalog.js`, and `model-guide.js` - local evidence, operator approval input, and consumer/developer model discovery.
8. `public/visualizer/keyboard-transport.js` and `audio-sensitivity.js` - safe global arrows and the post-normalization host transform.
9. `public/visualizer/immersive-ui.js` and `render-quality.js` - host chrome visibility and local Full/Balanced/Saver playback cost.
10. `public/visualizer/dream-trace.js` - the local trace shape and lifecycle evidence.

## Architecture map

The main data flow is:

```text
prompt
  -> provider-runtime
  -> cost-guard final request
  -> OpenRouter SSE response
  -> private complete-stream assembly + non-blocking usage settlement
  -> extracted complete HTML
  -> candidate sandbox
  -> full reliability preflight
  -> durable ready artifact plus diagnostic record
  -> explicit user Open
  -> safe reopen and reversible launch watchdog
  -> LIVE commit or rollback
```

`prompt.js` creates the canonical messages. `provider-runtime.js` prepares the provider request. `cost-guard.js` applies the final budget decision and request limits, so the trace must describe the request at that final app boundary rather than an earlier draft.

OpenRouter returns SSE response material that `openrouter-sse.js` assembles privately. Keep-alive comments count as transport activity, final usage starts non-blocking reservation settlement, and `[DONE]` is required before the provider runtime can extract candidate HTML. Post-`[DONE]` events and contradictory generation ids fail closed. Partial content remains diagnostic-only. The candidate runs in the sandbox while `reliability.js` checks it. Passing HTML is saved with `ready-to-open` state and does not alter LIVE. Only a later explicit Open transaction may promote it.

Ready and opened visualizers are available in Recent and the full Library. Attempt evidence is kept in the generation diagnostic, while Open/reopen gets a separate local launch diagnostic. Dream Trace remains the request/response and lifecycle view rather than an unrelated provider record.

## File ownership

- `public/visualizer/app.js`: owns top-level composition, LIVE/NEXT integration, candidate-slot serialization, promotion/rollback, Library wiring, diagnostic persistence, and `window.VIZ_DEV`.
- `public/visualizer/playback-state.js`: owns trusted visual playing/paused product state. Sandbox enforcement remains in `sandbox.js`.
- `public/visualizer/dream-job.js`: owns the single background-job lifecycle and the collapsible job panel/pill presentation.
- `public/visualizer/dream-switcher.js`: owns deterministic Featured/Favorites/Recent selection and keyboard navigation.
- `public/visualizer/dream-metadata.js`: owns human display-title precedence, editable-title validation, immutable HTML-title capture for new Dreams, and truthful prompt labels. These fields are presentation metadata, not artifact identity.
- `public/visualizer/diagnostic-details-state.js`: owns the single record-keyed Raw diagnostic JSON disclosure state retained across local list rerenders.
- `public/visualizer/featured-dreams.js` and `public/visualizer/featured/manifest.js`: own static Featured metadata/HTML loading and pending-operator-review curation export.
- `public/visualizer/prompt.js`: owns the canonical prompt version and generation/repair messages. Prompt changes require deliberate versioning.
- `public/visualizer/provider-runtime.js` and `openrouter-sse.js`: own the provider adapter contract, OpenRouter authentication/catalog calls, single-reader SSE normalization, privately assembled returned text, and complete HTML extraction.
- `public/visualizer/reasoning-settings.js`: owns catalog-exact reasoning metadata/options, per-model persistence, native Default omission, and stale fallback normalization.
- `public/visualizer/cost-guard.js` and `completion-accounting.js`: own browser-side estimates, confirmations, caps, final completion-request limits, request-scoped settlement, and bounded generation-metadata reconciliation. The spend guard never clones or reads a completion stream.
- `public/visualizer/generation-envelope.js` and `generation-failure.js`: own the quality-first request ceiling and evidence-based provider/artifact failure taxonomy.
- `public/visualizer/model-fit-evidence.js`, `model-product-catalog.js`, and `model-guide.js`: own bounded local configuration evidence, explicit operator-approved starting ids, and Recommended/Experimental disclosure.
- `public/visualizer/keyboard-transport.js` and `audio-sensitivity.js`: own safe global arrow routing and the local post-normalization sensitivity transform.
- `public/visualizer/dream-status.js` and `dream-transport.js`: own request-scoped fetch lifecycle, cancellation, body-activity idle timing, the secondary hard ceiling, and truthful connected/thinking/creating/checking events. `dream-job.js` owns product job state/UI.
- `public/visualizer/model-eligibility.js`: owns the pure live-Dream model eligibility rules used by catalogs and the final availability check.
- `public/visualizer/audio-engine.js`: owns local tab/window/system or explicit microphone capture and normalized audio features supplied to the trusted host. It does not own model requests.
- `public/visualizer/sandbox.js`: owns isolated generated-HTML execution, the injected `window.VIZ` bridge, trusted iframe-activity reporting, effective DPR/generated-RAF policy, CSP, runtime instrumentation, heartbeats, and probes.
- `public/visualizer/reliability.js`: owns deterministic synthetic VIZ stimulation, visible-output and VIZ-use evaluation, the real-viewport canary, watchdog checks, and repair diagnostics.
- `public/visualizer/diagnostics.js`: owns the general diagnostic record, timeline, bounded retained artifacts, redaction, status labels, copy helpers, and export helpers.
- `public/visualizer/dream-trace.js`: owns the nested, versioned Dream Trace representation and its attempt/lifecycle semantics.
- `public/visualizer/trace-bridge.js`: owns the narrow app-boundary handoff that associates the cost-guarded final request and the returned provider material with the correct trace.
- `public/visualizer/immersive-ui.js` and `render-quality.js`: own deterministic chrome inactivity state and persisted host render profiles. Neither is part of provider or artifact identity.
- `public/visualizer/trace-viewer.js`: owns Dream Trace rendering and trace-specific UI actions; it should not own provider, storage, or promotion policy.
- `public/visualizer/storage.js`: owns local IndexedDB access for Library generations and diagnostics, including their nested traces.
- `public/visualizer/index.html`: owns the static shell, LIVE/NEXT labels, active and candidate iframe slots, drawers, Dream Trace mount point, controls, and script loading order.

## LIVE and NEXT

`LIVE` identifies the visualizer currently on screen. It begins with embedded-safe `Calibration Bloom`; first-visit model-art startup is deferred because both reviewed model candidates materially destabilized the complete CI-class product corpus when kept continuously active. LIVE otherwise changes only after a saved/Featured artifact passes the explicit Open watchdog and commits.

`NEXT` identifies the selected model for the next Dream. Selecting another model changes NEXT only; it must not relabel the currently visible artwork. A Dream keeps the model identity captured when that Dream began, even if NEXT changes while the request is in flight. Failed candidates and rollbacks leave LIVE truthful.

## Featured Launch Set v1 provenance

The admitted model artifacts are immutable HTML from `visualizer-featured-export-v1` packages approved by the site operator on 2026-09-04. Manifest digests use UTF-8 SHA-256 after CRLF-to-LF normalization.

| Featured ID | Display / artifact title | Model / resolved model | Local generation | Provider generation | Trace | Prompt | Digest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `klangfiguren` | Klangfiguren — sand on a sounding plate | `z-ai/glm-5.3-flash` | `c4fa9760-0439-4c79-9f5e-af69bb12b18d` | `gen-1788390975-8pCRpNg4jGDQAMxCjV60` | `e2c0c6ad-80cb-4da8-945f-8cccda6fdbed` | `neutral-v1` / `visualizer-prompt-v2` | `176bc18463d8f379ba5877dbe0f20333fb5c9bb0f579d340227d8048ee110700` |
| `nexus-beam` | Nexus Beam / Kinetic Harmonic Astrolabe | `google/gemini-3.8-flash` | `dbeb41d5-411e-4964-af34-70ea48c8ddc6` | `gen-1788487061-Hz2FaGMJFxrfVhjEIWOF` | `f5240f15-ccf9-4f16-9f8a-84d35efea8cf` | `custom-784707e6` (Neutral Crisp V1) / `visualizer-prompt-v2` | `dd6ffcfe40fc2db07773144c55523db99d30521906bf08949b01663caf09d140` |

The export package intentionally stores only the eight-character local artifact marker in its generated manifest ID. Full local generation IDs above are operator-supplied source identities associated with exact marker, provider-generation, trace, and digest tuples. Historical traces are not rewritten. Calibration Bloom remains separately identified as host-created and is the last-known-safe no-network fallback.

## Dream display metadata

`displayTitle` is the only user-editable saved-Dream naming field and is persisted separately through `GenerationStore`. `curatedDisplayTitle` belongs to Featured editorial metadata. `artifactTitle`, existing legacy `title`, and deterministic model/generation fallback remain lower-precedence sources. Renaming never mutates `id`, HTML, digest, trace/diagnostic identity, prompt metadata/hash, model-fit configuration, provider identity, or Featured provenance. The LIVE identity may update only its `displayName` when its exact generation ID matches the renamed saved Dream.

Prompt labels resolve independently from prompt identity. A uniquely matched saved prompt records additive `promptLibraryEntryId`; that exact entry wins when it still matches the profile/hash, while ambiguous aliases fall back to the captured historical name. Known preset IDs use `PROMPT_PRESETS`, captured `promptProfileName` remains the historical saved-prompt label, and unknown custom IDs use a bounded deterministic marker. Switcher and Library details expose this label without changing profile ID, version, brief hash, or request messages.

The Raw diagnostic JSON disclosure keeps one record ID outside the replace-on-render list DOM. A periodic rerender reconciles that ID and recreates the open panel for the same record; selecting another trace or deleting/clearing the record resets it. Raw diagnostic data remains local and uses the existing redacted export projection.

### Removed Aural candidate evidence

`Aural Cymatics: Genesis of Harmonic Form` was removed editorially from Featured v1 without modifying its model output. GitHub's CI-class product path recorded `REOPEN_FAILED` because the authenticated `reopen-baseline` probe timed out. An independent run passed safe-reopen qualification but measured approximately 1 FPS, delivered one stimulation frame, and remained in the opening transaction at the 30-second product deadline. The removed candidate was local generation `d0f89126-9305-45cf-8556-824c7549d79e`, provider generation `gen-1788390875-DLmI28KK32b7ScgczxCG`, trace `4eabe50a-5457-45de-9bff-8c24b7fa9a59`, and digest `8950a3eb24c88d57a06f3adeff76d20d7fb4e1aa47d2fae3e61bb1e53011fd2f`. Its production HTML is intentionally absent; this evidence does not relabel the artifact as unreliable outside the failed CI-class product-open contract.

Klangfiguren passed focused cold-start, mobile Saver, microphone, qualification, pause/reopen, and backpressure checks. With Klangfiguren as startup, however, the complete local Chromium corpus produced 11 failures across otherwise independent generation, spend, immersive, cancellation, and reopen paths and expanded to 17.9 minutes. Calibration therefore remains startup without changing Klangfiguren, the reliability boundary, or render-quality semantics.

## Quality-first controls

- Reasoning `Default` is native omission. Explicit choices come only from the exact refreshed model's `reasoning.supported_efforts`; a stale saved choice visibly falls back to Default for a new generation, while a repair blocks if its snapshotted explicit effort disappears. Insufficient spend also blocks without lowering effort. Generation and the optional same-model repair share immutable Dream-start reasoning intent and prompt snapshots, each revalidated against its fresh catalog row.
- Left/Right selects the previous/next Favorite in the supplied display order and wraps. From a non-Favorite, Right selects the first and Left the last; zero Favorites is a safe no-op. Reopen uses the standby sandbox and commits LIVE only after validation/watchdog success, including while a separate Dream request remains in flight.
- Up/Down adjusts `visualizer-audio-sensitivity-v1` from 50% through 200% in 10% steps; 100% is the default. The About range/Reset provides pointer, touch, and native keyboard control. Global arrows stand down for inputs, sliders, Prompt Lab, model navigation, the Dream switcher, dialogs, drawers, popovers, modifiers, composition, and repeats.
- Sensitivity runs after `AudioEngine` adaptive normalization and before host-frame composition. It scales/clamps volume, peak, transient, beat, spectral flux, named bands, spectrum, and symmetric waveform amplitude without changing tempo, tempo confidence, centroid, stereo, connection/silence truth, time, schema, or the source sample. It never changes the creative brief, model request, generated HTML, stored artifact, or VIZ pointer coordinates.
- Render quality is separate from generation quality. Full uses up to 60 FPS/2× DPR, Balanced 45 FPS/1.5× DPR, and Saver 30 FPS/1× DPR, but no profile increases a sub-1 native DPR. Audio analysis retains its independent 60 Hz target; only generated VIZ delivery, generated `requestAnimationFrame`, and JavaScript-visible DPR are capped. Switching or moving across native DPRs sends a private host message and a resize signal without replacing `srcdoc` or the sandbox session. Cadence recovery skips missed intervals in constant time rather than replaying them.
- `visualizer-runtime-v2` stabilizes only a verified fixed/all-edge canvas whose authored CSS width and height are both `auto`, preventing DPR-backed intrinsic dimensions from changing its viewport layout. Explicit, partial, nested, transformed, and offscreen canvases are not coerced. Marker authority remains closure-private; coalesced DOM checks plus a bounded observed-canvas check on the existing heartbeat keep live CSSOM changes and detachments truthful without scanning the document.
- `dream-reliability-v2` treats stale heartbeat age as suspicion rather than proof. It performs one bounded authenticated probe, permits at most one short retry only when heartbeat evidence advances, and still rolls back deterministically when both heartbeat and probe remain unresponsive. Fatal events bypass this confirmation.
- Reliability stages can update a visible generation job only when the harness carries that job's exact captured job/trace owner and it still matches the active executing job. Saved reopen, Featured, retest, and recovery harnesses remain diagnostic-only.
- Model search derives ephemeral normalized tokens from displayed name, exact ID, and provider. It ignores punctuation/spacing differences without rewriting catalog objects, selected IDs, cache data, or provider requests.
- Desired pause state is stored independently of iframe readiness and injected at bootstrap, so an intentionally paused load cannot render frames before its private bridge connects. Clearing a retired/standby slot resets that intent, and candidate preflight explicitly runs unpaused before the selected global pause state is applied for presentation.
- Immersive chrome hides after three seconds of unblocked inactivity. Drawers/dialogs and keyboard navigation pin it; background job expansion and pointer-created button focus do not. Trusted activity from an active/promoting sandbox wakes the host over the private port without forwarding key values or stealing the iframe event.

`neutral-v1` remains frozen and unchanged. These host controls and quality policies do not modify its creative brief.

## Model-fit evidence v1

`visualizer-model-fit-v1` records compact local observations by an exact configuration identity: model id, reasoning choice, prompt profile id, prompt version, prompt hash, generation-envelope major version, Audio API version, reliability version, and runtime version. Evidence from any changed identity dimension stays in a separate bucket; model-level status aggregates configurations but does not imply that every reasoning choice is proven.

Status meanings are strict:

- `UNTESTED`: no compatible provider attempt exists.
- `TESTED`: at least one compatible provider attempt exists without a qualifying Ready or LIVE/Open success. Length exhaustion, ordinary failures, and timeouts stay TESTED.
- `PROVEN`: at least one compatible Ready or LIVE/Open success exists.
- `KNOWN_INCOMPATIBLE`: an explicit deterministic model/configuration capability mark, never an inference from an ordinary observed failure.

Default retention is bounded to 96 configurations, 80 global recent observations, 12 recent observations per configuration, 31 samples per metric, and 512 seen observation ids. The store is local under `ai-visualizer.model-fit.v1`; it keeps counts, categories, latency, token usage, artifact bytes, exact billed costs, repairs, and dates, not music or generated artifacts.

Normal mode labels exact operator-catalog or locally PROVEN eligible models as Recommended/Worked here before and keeps automated catalog signals behind Experimental disclosure. Developer mode opens the broad live eligible catalog and shows local statuses. The static `visualizer-model-product-catalog-v1` is intentionally empty until an operator approves exact ids, so local proof alone does not populate the product starting catalog.

In developer mode, `Copy model test matrix` and `window.VIZ_DEV.copyModelTestMatrix()` produce a bounded `visualizer-model-fit-matrix-v1` block. It retains configuration/status/metric evidence but recursively removes credentials, authorization/cookies, music/song/track fields, waveform/spectrum/audio data, raw provider bodies/output, assistant text, and generated HTML. Copying is explicit and moves that sanitized copy outside local storage.

## Developer mode and Dream Trace

`?dev=1` enables developer mode when the page loads. `Ctrl+Shift+D` toggles it while the page is open. In developer mode, click `DEV` to open Dream diagnostics.

To open a trace in the UI, find the relevant Dream or diagnostic and choose its `Dream Trace` action. The viewer keeps generation and repair attempts distinct. Conversations and generated HTML are rendered as inert text when viewed; opening a trace does not execute model output. Click `Close` to hide the viewer without deleting anything.

The trace actions are:

- `Copy trace`: copies the complete sanitized trace JSON, including the evidence available at the app boundary.
- `Copy prompt`: copies all captured request messages for the displayed attempt.
- `Copy response`: copies the provider response material retained at the app boundary. It is not a packet-level HTTP capture.
- `Copy HTML`: copies the HTML extracted for that candidate.
- `Export trace`: downloads the sanitized trace as local JSON.
- `Retest trace`: runs the stored extracted HTML through the local candidate sandbox and reliability checks without sending a model request.
- `Close`: closes the Dream Trace viewer.

The same trace can be opened from DevTools:

```js
const trace = await window.VIZ_DEV.latestTrace();
await window.VIZ_DEV.openTrace(trace.id);
```

Reasoning is reported literally, not inferred. A trace can show only reasoning text or token counts that the provider exposed in response material observed by the app. Missing reasoning text means it was not exposed; the app must not reconstruct or claim hidden chain-of-thought.

### VIZ_DEV contract

Dream transparency extends `window.VIZ_DEV`; it does not replace the older diagnostics API. Preserve these existing methods:

```text
enable
disable
latest
list
copyLatest
copyCurrentHtml
retestCurrent
testHtml
replay
exportAll
open
state
```

The transparency additions are:

- `identity()` returns the current LIVE and NEXT identity snapshot.
- `latestTrace()` returns the newest available Dream Trace.
- `listTraces()` lists available local traces.
- `openTrace(id)` opens a trace in the Dream Trace viewer.
- `copyTrace(id)` copies the full sanitized trace.
- `copyPrompt(id, attemptNumber)` copies the selected attempt's captured request messages.
- `copyResponse(id, attemptNumber)` copies the selected attempt's retained provider response material.
- `copyHtml(id, attemptNumber)` copies the selected attempt's extracted candidate HTML.
- `exportTrace(id)` downloads that trace as JSON.
- `retestTrace(id)` locally retests its extracted HTML.
- `runTransparencySelfTest()` runs the no-cost local transparency demo.
- `modelFit()` returns the bounded local `visualizer-model-fit-v1` snapshot.
- `modelTestMatrix()` returns the sanitized matrix object; `copyModelTestMatrix()` copies the framed matrix block.
- `theoreticalModelCeilings()` returns developer-only catalog-ceiling diagnostics, never an expected-cost estimate.
- `playback()` and `setPaused(value)` inspect/control trusted visual playback for local testing.
- `quality()` and `setQuality(mode)` inspect/control the persisted local render profile; `immersive()` reports hidden state and any legitimate blocker.
- `probeActive(label)` requests a sanitized trusted probe from the active sandbox.
- `exportFeatured(generationId)` downloads a local candidate package marked pending operator review.

`exportFeatured()` is packaging, not approval. Before adding an exported Dream to `featured/manifest.js`, an operator must review the art, place its HTML under `featured/`, assign a positive order, record exact model/request/prompt/trace provenance, add an approval record, and run the real reliability corpus. The loader rejects pending packages, missing evidence, digest drift, external paths, and regression-fixture paths.

Use an ID returned by `latestTrace()` or `listTraces()` for the ID-based methods.

## No-cost self-test

The self-test exercises trace display and local reliability without OpenRouter inference:

1. Start the app with `npm.cmd run dev` and open the `?dev=1` URL above.
2. Click `DEV`, then `Load no-cost trace demo`. The DevTools equivalent is:

```js
await window.VIZ_DEV.runTransparencySelfTest();
```

3. Open the resulting Dream Trace with its UI action or with `latestTrace()` and `openTrace()`.
4. Exercise `Copy trace`, `Copy prompt`, `Copy response`, `Copy HTML`, `Export trace`, and `Retest trace`.
5. In the browser Network panel, confirm that this sequence made no `POST` to `https://openrouter.ai/api/v1/chat/completions`. Catalog or key-status reads are not model generation.

No OpenRouter connection or balance is required. The demo and retest use local material, the candidate sandbox, and deterministic reliability input.

## No-cost quality browser campaign

The quality-first browser spec mocks the catalog, key status, and completion endpoint. It exercises reasoning, the generation envelope, exact DeepSeek length exhaustion, model-fit statuses/matrix privacy, grounded model discovery, Favorite standby opens, sensitivity ownership, and mobile disclosure without a real key or paid request.

After installing Chromium as shown below, run the exact Windows commands from the repository root:

```powershell
npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx.cmd playwright test tests/quality-first-controls.spec.mjs --config=playwright.config.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx.cmd playwright test tests/streaming-immersive-quality.spec.mjs --config=playwright.config.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

This fixture campaign is no-cost because Playwright intercepts `https://openrouter.ai/**`; it is contract evidence, not live-provider acceptance.

## Manual 20-30 Dream campaign

The operator-funded campaign is separate from the no-cost suite and does not by itself claim deployment or acceptance:

1. Open `http://localhost:5173/visualizer/index.html?dev=1`, keep `neutral-v1` selected, and copy a baseline model test matrix. The Neutral creative brief remains frozen and unchanged throughout the campaign.
2. Define 20-30 authorized Dreams across exact live model ids and only their displayed Default/effort choices. Treat each configuration identity separately; record the catalog timestamp and do not substitute a disappeared model.
3. Set explicit per-Dream, session, and day caps in Spend protection, check the provider key remainder, and approve only the displayed enforced maximum. A real campaign costs the connected operator account.
4. Run one Dream at a time to a terminal state. Explicitly Open healthy Ready results to collect LIVE/Open evidence; retain safe failures as their exact categories and do not retry merely to turn a failure green.
5. Copy the sanitized matrix at checkpoints and at completion. Review counts, exact costs, latency, tokens including reasoning, repairs, result categories, and identity versions alongside qualitative art review.
6. Populate the static operator catalog only through a deliberate reviewed code change after the campaign. `PROVEN` local evidence is an input, not automatic approval; one timeout or output-budget exhaustion is never `KNOWN_INCOMPATIBLE`.

## Windows verification

Run the milestone checks from the repository root in PowerShell. Stop on the first failure.

```powershell
$syntaxFiles = @(
  Get-ChildItem -LiteralPath "public/visualizer" -Filter "*.js"
  Get-ChildItem -LiteralPath "tests" -Filter "*.mjs"
  Get-Item -LiteralPath "scripts/visualizer-static-check.mjs"
  Get-Item -LiteralPath "playwright.config.mjs"
)

foreach ($file in $syntaxFiles) {
  node --check $file.FullName
  if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $($file.FullName)" }
}

node scripts/visualizer-static-check.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node tests/model-eligibility.spec.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node --test --test-concurrency=1 tests/reasoning-settings.contract.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node --test --test-concurrency=1 tests/generation-envelope.contract.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node --test --test-concurrency=1 tests/provider-quality.contract.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node --test --test-concurrency=1 tests/model-fit-evidence.contract.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node --test --test-concurrency=1 tests/keyboard-transport.contract.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node --test --test-concurrency=1 tests/audio-sensitivity.contract.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node --test --test-concurrency=1 tests/streaming-transport.contract.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node --test --test-concurrency=1 tests/render-quality.contract.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node --test --test-concurrency=1 tests/immersive-ui.contract.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node --test --test-concurrency=1 tests/dream-transparency.contract.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node --test --test-concurrency=1 tests/product-shell.contract.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node --test --test-concurrency=1 tests/debug-bundle.contract.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm.cmd install --no-save --no-package-lock @playwright/test@1.55.0
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx.cmd playwright install chromium
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx.cmd playwright test --config=playwright.config.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

The final Playwright command runs the full configured browser suite, not only one transparency test.

## Safe Git workflow

Never develop, commit, or push directly on `main`. Use the milestone branch and merge through a pull request.

1. Before editing, verify the branch and inspect existing work:

```powershell
git switch milestone/streaming-immersive-render-quality-v1
git branch --show-current
git status --short --branch
```

2. If the worktree is clean and the branch tracks the remote, update without a merge commit:

```powershell
git pull --ff-only
```

3. Make focused changes and run the complete verification sequence above.
4. Review `git status`, `git diff --check`, and `git diff`. In VS Code Source Control, stage only files that belong to the milestone; do not use a blanket stage when unrelated work is present.
5. Review the exact staged patch, then commit:

```powershell
git diff --cached --check
git diff --cached
git commit -m "Streaming immersive playback and render quality v1"
```

6. Push only the milestone branch and open a PR into `main`:

```powershell
git push --set-upstream origin milestone/streaming-immersive-render-quality-v1
gh pr create --base main --head milestone/streaming-immersive-render-quality-v1 --fill
```

7. Let the required checks pass and merge through the PR. Never run `git push origin main` for this work.

## Privacy and truth boundaries

Stored locally:

- ready and opened Library visualizer HTML and its model/prompt/version/health/open metadata;
- diagnostic and nested trace evidence such as the final app-boundary request, retained provider response material, provider-exposed reasoning when returned, extracted HTML, timings, usage/cost when available, validation, reliability, promotion, and rollback results;
- a session-scoped OpenRouter credential in trusted host `sessionStorage`, separate from Library, diagnostics, and traces.

Not intentionally stored in diagnostics or traces:

- captured music, song names, song metadata, waveform arrays, spectrum arrays, or audio content;
- OpenRouter/API keys, authorization headers, cookies, or generated-frame access to host storage;
- hidden model chain-of-thought, provider-internal processing, server logs, or a wire-level HTTP transcript.

Copy and export are explicit actions. Once copied to the clipboard or downloaded, that copy is outside the app's local storage boundary.

Browser-only means the trusted host performs provider access and audio analysis in the browser. Generated HTML does not share that trust: it runs with scripts in an opaque-origin sandbox, without same-origin host access or network access, and without credentials or host storage.

A Dream Trace is local, best-effort app-boundary evidence. It records what this application could observe around its final request, returned response material, extraction, checks, and launch lifecycle. It is not hidden chain-of-thought, a wire-level capture, a provider-side log, or a tamper-proof audit. Generated HTML is an artifact returned by the model, not proof of the model's private reasoning.
