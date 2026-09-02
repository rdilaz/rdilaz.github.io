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
5. `public/visualizer/provider-runtime.js` - provider contract, OpenRouter request, response normalization, and HTML extraction.
6. `public/visualizer/cost-guard.js` - the last browser boundary before a paid request is sent.
7. `public/visualizer/dream-trace.js` - the local trace shape and lifecycle evidence.

## Architecture map

The main data flow is:

```text
prompt
  -> provider-runtime
  -> cost-guard final request
  -> OpenRouter response
  -> extracted HTML
  -> candidate sandbox
  -> full reliability preflight
  -> durable ready artifact plus diagnostic record
  -> explicit user Open
  -> safe reopen and reversible launch watchdog
  -> LIVE commit or rollback
```

`prompt.js` creates the canonical messages. `provider-runtime.js` prepares the provider request. `cost-guard.js` applies the final budget decision and request limits, so the trace must describe the request at that final app boundary rather than an earlier draft.

OpenRouter returns response material that the browser app can observe, and the provider runtime extracts the candidate HTML. The candidate runs in the sandbox while `reliability.js` checks it. Passing HTML is saved with `ready-to-open` state and does not alter LIVE. Only a later explicit Open transaction may promote it.

Ready and opened visualizers are available in Recent and the full Library. Attempt evidence is kept in the generation diagnostic, while Open/reopen gets a separate local launch diagnostic. Dream Trace remains the request/response and lifecycle view rather than an unrelated provider record.

## File ownership

- `public/visualizer/app.js`: owns top-level composition, LIVE/NEXT integration, candidate-slot serialization, promotion/rollback, Library wiring, diagnostic persistence, and `window.VIZ_DEV`.
- `public/visualizer/playback-state.js`: owns trusted visual playing/paused product state. Sandbox enforcement remains in `sandbox.js`.
- `public/visualizer/dream-job.js`: owns the single background-job lifecycle and the collapsible job panel/pill presentation.
- `public/visualizer/dream-switcher.js`: owns deterministic Featured/Favorites/Recent selection and keyboard navigation.
- `public/visualizer/featured-dreams.js` and `public/visualizer/featured/manifest.js`: own static Featured metadata/HTML loading and pending-operator-review curation export.
- `public/visualizer/prompt.js`: owns the canonical prompt version and generation/repair messages. Prompt changes require deliberate versioning.
- `public/visualizer/provider-runtime.js`: owns the provider adapter contract, OpenRouter authentication/catalog calls, live request/response normalization, returned text, and HTML extraction.
- `public/visualizer/cost-guard.js`: owns browser-side estimates, confirmations, caps, final completion-request limits, and usage/cost accounting. It is the final request boundary before OpenRouter.
- `public/visualizer/dream-status.js`: observes the fetch lifecycle and emits truthful sent, model-working, response-started, body-complete, cancellation, and timeout events. `dream-job.js` owns product job state/UI.
- `public/visualizer/model-eligibility.js`: owns the pure live-Dream model eligibility rules used by catalogs and the final availability check.
- `public/visualizer/audio-engine.js`: owns local tab/window/system audio capture and normalized audio features supplied to the trusted host. It does not own model requests.
- `public/visualizer/sandbox.js`: owns isolated generated-HTML execution, the injected `window.VIZ` bridge, CSP, runtime instrumentation, heartbeats, and probes.
- `public/visualizer/reliability.js`: owns deterministic synthetic VIZ stimulation, visible-output and VIZ-use evaluation, the real-viewport canary, watchdog checks, and repair diagnostics.
- `public/visualizer/diagnostics.js`: owns the general diagnostic record, timeline, bounded retained artifacts, redaction, status labels, copy helpers, and export helpers.
- `public/visualizer/dream-trace.js`: owns the nested, versioned Dream Trace representation and its attempt/lifecycle semantics.
- `public/visualizer/trace-bridge.js`: owns the narrow app-boundary handoff that associates the cost-guarded final request and the returned provider material with the correct trace.
- `public/visualizer/trace-viewer.js`: owns Dream Trace rendering and trace-specific UI actions; it should not own provider, storage, or promotion policy.
- `public/visualizer/storage.js`: owns local IndexedDB access for Library generations and diagnostics, including their nested traces.
- `public/visualizer/index.html`: owns the static shell, LIVE/NEXT labels, active and candidate iframe slots, drawers, Dream Trace mount point, controls, and script loading order.

## LIVE and NEXT

`LIVE` identifies the visualizer currently on screen. It begins as the built-in Featured `Calibration Bloom` and changes only after a saved/Featured artifact passes the explicit Open watchdog and commits.

`NEXT` identifies the selected model for the next Dream. Selecting another model changes NEXT only; it must not relabel the currently visible artwork. A Dream keeps the model identity captured when that Dream began, even if NEXT changes while the request is in flight. Failed candidates and rollbacks leave LIVE truthful.

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
- `playback()` and `setPaused(value)` inspect/control trusted visual playback for local testing.
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
git switch milestone/product-shell-core-ux-v1
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
git commit -m "Product Shell Core UX v1"
```

6. Push only the milestone branch and open a PR into `main`:

```powershell
git push --set-upstream origin milestone/product-shell-core-ux-v1
gh pr create --base main --head milestone/product-shell-core-ux-v1 --fill
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
