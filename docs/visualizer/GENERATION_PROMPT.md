# Canonical Generation Prompt

Authoritative implementation: `public/visualizer/prompt.js`.

Current version: `visualizer-prompt-v3`.

The current default is the unchanged `neutral-v1` creative brief: create a real-time visual interpretation of arbitrary music, with complete artistic freedom. The fixed technical contract is appended separately. It describes one self-contained HTML document, the opaque network-denied sandbox, and `visualizer-audio-v2` without prescribing renderer, composition, color, dimensionality, or metaphor. The model never receives the song or live analysis.

`pulse-spice-v1` / Pulse + Spice is one optional built-in creative preset for stronger musical causality, distinct quiet/impact/spectral roles, precise recovery, clarity, and restrained haze/blur. It is not the default. The preserved legacy canonical prompt remains historical V1 evidence and is not used for new generation; even the Original baseline creative brief receives the current prompt/runtime contract when selected for a new Dream.

## Fairness policy

Changes to the canonical prompt require a version bump. Old generations retain the prompt version used to create them. Aesthetic examples are not added to the prompt because examples become style anchors and undermine the point of the experiment.

Prompt, audio contract, creative profile ID/hash, generation envelope, reliability, and runtime remain separate model-fit identity dimensions. A V1 and V2 observation cannot share a compatibility bucket.

## Repair policy

A malformed or immediately broken generation receives at most one automatic repair attempt in V0. The repair is sent back to the same selected model with the same prompt profile, prompt version, and exact audio-contract identity plus the concrete validation/runtime error. Repair should preserve the model's original visual idea when possible.
