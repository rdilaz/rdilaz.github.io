# AI Visualizer — Product Constitution

Working title only. Naming and branding are intentionally deferred.

## Product sentence

**Play anything. Pick an AI. Watch what it thinks music looks like.**

## Browser-only product boundary

The normal product is a website:

**open the site → connect your own model provider → choose a model → Dream**

No terminal, localhost service, desktop companion, browser extension, or downloaded executable may be required. A small hosted backend or serverless gateway is allowed only when it remains invisible infrastructure for provider authorization, credential protection, or browser compatibility.

For the current phase, model inference is funded entirely by the user's connected provider account. The Visualizer does not silently spend from a site-owned model account. Monetization and optional site-funded credits are deferred until the experience is excellent.

## Product hierarchy

1. The visualizer is the product.
2. The model comparison is the playful engine underneath it.
3. Technical benchmark information may exist, but it must never dominate the experience.

## Non-negotiable creative rules

- Every model receives the same canonical generation prompt version.
- Every model receives the same Visualizer Audio API version.
- Models do not receive the current song, a genre label, reference art, competitor output, or aesthetic examples.
- The canonical prompt does not prescribe particles, 3D, colors, darkness, futurism, geometry, or any other visual metaphor.
- Models may create any browser-native visual experience that stays inside the sandbox/runtime contract.
- The primary qualitative criterion is **wow factor**: beauty, originality, and a meaningful relationship between arbitrary music and image.

## User story

A person opens the visualizer in a browser, connects whatever audio the browser can safely share, connects a model provider they already pay for, chooses an AI model, presses **Dream**, and continues listening while that model creates a new visual world. The new world takes over when ready. The person can leave it fullscreen, reroll the same model, switch to another model, favorite a generation, return to previous generations, or casually battle two saved generations.

## Privacy sentence

**Your music stays on your device. The model creates the instrument; it never receives the song.**

## Browser Provider Reset v1 definition of done

The local/desktop experiment is fully removed from the product and deployment. OpenRouter is the sole reference provider behind a versioned browser-provider contract. Its PKCE connection, catalog, generation, repair, cost accounting, failure handling, cancellation, and Dream lifecycle remain functional. CI fails if terminal, localhost, OpenCode, companion-executable, or desktop-runtime assumptions return to the normal browser experience.

## V0 definition of done

V0 is real only when a user can open `/visualizer/` over HTTPS; connect shared tab/window/system audio without microphone capture; authorize user-funded model access; choose a model from a live catalog; generate a brand-new visualizer using the canonical prompt; keep the previous visualizer running while generation happens; automatically repair one malformed/broken attempt; run generated code in an isolated, network-denied sandbox; see it respond through `visualizer-audio-v1`; enter fullscreen; retain every successful Dream locally; and favorite, reopen, delete, or casually battle saved Dreams.

## Public V1 definition of done

Public V1 extends V0 with a dedicated domain/repository, production observability, polished browser capability guidance, a secure hosted provider gateway where needed, durable account/library sync only if it improves the experience, abuse/cost controls, and shareable generations. None of those are permitted to obscure the visualizer itself.

## Deliberately deferred

Final naming/logo, monetization, site-funded inference, social feeds, serious leaderboard science, mobile-native apps, desktop/native companions, local provider bridges, community moderation, and any redesign that makes the primary canvas feel like an admin dashboard.
