# AI Visualizer — Product Constitution

Working title only. Naming and branding are intentionally deferred.

## Product sentence

**Play anything. Pick an AI. Watch what it thinks music looks like.**

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

A person opens the visualizer, connects whatever audio their browser can safely share, chooses an AI model, presses **Dream**, and continues listening while that model creates a new visual world. The new world takes over when ready. The person can leave it fullscreen, reroll the same model, switch to another model, favorite a generation, return to previous generations, or casually battle two saved generations.

## Privacy sentence

**Your music stays on your device. The model creates the instrument; it never receives the song.**

## V0 definition of done

V0 is real only when a user can open `/visualizer/` over HTTPS; connect shared tab/window/system audio without microphone capture; authorize model access using OpenRouter PKCE; choose a model from the live model catalog; generate a brand-new visualizer live using the canonical prompt; keep the previous visualizer running while generation happens; automatically repair one malformed/broken generation attempt; run generated code in an isolated, network-denied sandbox; see it respond through `visualizer-audio-v1`; enter fullscreen; retain every successful dream locally; and favorite, reopen, delete, or casually battle saved dreams.

## Public V1 definition of done

Public V1 extends V0 with a dedicated domain/repository, production observability, polished browser capability guidance, durable account/library sync if it improves the experience, abuse/cost controls, and a desktop/system-audio companion path. None of those are permitted to obscure the visualizer itself.

## Deliberately deferred

Final naming/logo, pricing, social feeds, serious leaderboard science, mobile-native apps, complicated model routing, community moderation, and any redesign that makes the primary canvas feel like an admin dashboard.
