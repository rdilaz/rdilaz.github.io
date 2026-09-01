export const PROMPT_VERSION = 'visualizer-prompt-v1';
export const AUDIO_API_VERSION = 'visualizer-audio-v1';

export const CANONICAL_VISUALIZER_PROMPT = `Create the most extraordinary real-time visual interpretation of music you are capable of making.

You do not know what music will be played. Your creation must respond meaningfully to arbitrary audio: anything from silence, ambient music, jazz, classical, hip-hop, pop, metal, electronic music, field recordings, or something nobody anticipated.

There are no aesthetic requirements. There is no prescribed style, subject, composition, color palette, dimensionality, visual metaphor, or interaction pattern. Do not imitate a generic audio visualizer unless that is genuinely your strongest artistic idea. You may create anything.

Optimize above all else for wow factor and for a relationship between sound and image that feels intentional. Make something someone would happily leave fullscreen for an entire listening session.

IMPORTANT FAIRNESS RULE:
You are not receiving a song, a genre, a reference image, or another model's output. Every model receives this same creative brief and the same host API. The point is to reveal your artistic interpretation, not to match a target style.

RUNTIME:
Your work runs as one self-contained HTML document in a sandboxed browser iframe. Use browser-native HTML, CSS, JavaScript, Canvas 2D, SVG, WebGL/WebGL2, WebGPU when available, shaders, DOM, typography, procedural graphics, or any combination you choose. External network access and external assets are unavailable. Everything required by the visualizer must exist in the HTML you return.

The host injects a read-only global named window.VIZ before your code runs.

window.VIZ has:
- VIZ.version -> "visualizer-audio-v1"
- VIZ.frame -> the most recent host frame
- VIZ.viewport -> { width, height, dpr }
- VIZ.onFrame(callback) -> subscribe to new host frames; returns an unsubscribe function

A host frame has this shape:
{
  version: "visualizer-audio-v1",
  time: number,
  deltaTime: number,
  audio: {
    connected: boolean, silence: boolean, volume: number, peak: number, transient: number, beat: number,
    tempo: number, tempoConfidence: number, spectralFlux: number, spectralCentroid: number,
    bands: { subBass: number, bass: number, lowMid: number, mid: number, highMid: number, treble: number },
    stereo: { balance: number, width: number },
    waveform: number[], spectrum: number[]
  },
  pointer: { x: number, y: number, active: boolean, down: boolean },
  viewport: { width: number, height: number, dpr: number }
}

The host normalizes the easy audio features adaptively so quieter recordings can still have expressive dynamics. waveform and spectrum remain useful for deeper custom interpretation. Do not assume tempo is always available or that every song has a regular beat.

TECHNICAL REQUIREMENTS:
- Return exactly one complete HTML document and nothing else.
- Do not wrap the HTML in Markdown fences.
- Use requestAnimationFrame for continuous animation.
- Scale cleanly to arbitrary viewport sizes and device pixel ratios.
- Keep interaction responsive and avoid blocking the main thread for long periods.
- Treat missing/zero audio features gracefully; the visualizer should still feel alive before audio connects and during silence.
- Do not attempt to access parent/top/opener, cookies, storage, credentials, camera, microphone, geolocation, clipboard, or the network.
- Do not produce sound. This is a visual interpretation only.
- Prefer resilient feature detection when using WebGPU or newer APIs and provide a visual fallback when practical.

You have a blank canvas. Decide what music looks like.`;

export function buildGenerationMessages() {
  return [{ role: 'system', content: 'You are the sole artist and engineer of a real-time music visualizer. Follow the user brief exactly. Return only the requested self-contained HTML document.' }, { role: 'user', content: CANONICAL_VISUALIZER_PROMPT }];
}

export function buildRepairMessages(originalOutput, problem) {
  return [{ role: 'system', content: 'Repair the visualizer while preserving its artistic idea. Return only one complete self-contained HTML document and no Markdown.' }, { role: 'user', content: `${CANONICAL_VISUALIZER_PROMPT}\n\nYour previous attempt failed this validation/runtime check:\n${problem}\n\nRepair it. Preserve the visual concept as much as possible. Previous output follows:\n\n${originalOutput}` }];
}
