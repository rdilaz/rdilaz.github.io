# Canonical Generation Prompt

Authoritative implementation: `public/visualizer/prompt.js`.

Current version: `visualizer-prompt-v1`.

The prompt is intentionally sparse aesthetically. It tells models to create the most extraordinary real-time visual interpretation of music they can; they do not know what music will be played; arbitrary audio must work; there are no aesthetic requirements; no genre, song, reference image, or competitor output is supplied; every model receives the same creative brief and audio contract; the goal is wow factor and a meaningful relationship between sound and image; output is one self-contained HTML document; browser-native visual technologies are available; external network/assets are not; and `window.VIZ` is the standardized sensory interface.

## Fairness policy

Changes to the canonical prompt require a version bump. Old generations retain the prompt version used to create them. Aesthetic examples are not added to the prompt because examples become style anchors and undermine the point of the experiment.

## Repair policy

A malformed or immediately broken generation receives at most one automatic repair attempt in V0. The repair is sent back to the same selected model with the same canonical creative brief plus the concrete validation/runtime error. Repair should preserve the model's original visual idea when possible.
