export const PROMPT_VERSION = 'visualizer-prompt-v2';
export const LEGACY_PROMPT_VERSION = 'visualizer-prompt-v1';
export const AUDIO_API_VERSION = 'visualizer-audio-v1';
export const PROMPT_PROFILE_SCHEMA = 'visualizer-prompt-profile-v1';
export const PROMPT_STORAGE_KEY = 'ai-visualizer.prompt-profile.v1';
export const DEFAULT_PROMPT_PRESET_ID = 'neutral-v1';
export const MAX_CREATIVE_BRIEF_CHARS = 12000;

export const BASELINE_CREATIVE_BRIEF = `Create the most extraordinary real-time visual interpretation of music you are capable of making.

You do not know what music will be played. Your creation must respond meaningfully to arbitrary audio: anything from silence, ambient music, jazz, classical, hip-hop, pop, metal, electronic music, field recordings, or something nobody anticipated.

There are no aesthetic requirements. There is no prescribed style, subject, composition, color palette, dimensionality, visual metaphor, or interaction pattern. Do not imitate a generic audio visualizer unless that is genuinely your strongest artistic idea. You may create anything.

Optimize above all else for wow factor and for a relationship between sound and image that feels intentional. Make something someone would happily leave fullscreen for an entire listening session.

IMPORTANT FAIRNESS RULE:
You are not receiving a song, a genre, a reference image, or another model's output. Every model receives this same creative brief and the same host API. The point is to reveal your artistic interpretation, not to match a target style.`;

export const LEGACY_CANONICAL_VISUALIZER_PROMPT = `${BASELINE_CREATIVE_BRIEF}

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

export const NEUTRAL_CREATIVE_BRIEF = `Create a real-time visual interpretation of arbitrary music.

You have complete artistic freedom. Decide what music looks like.`;

export const FIXED_RUNTIME_CONTRACT = `RUNTIME CONTRACT — technical reference, not artistic direction:
- Return exactly one complete self-contained HTML document and nothing else. Do not wrap it in Markdown.
- The document runs in a sandboxed browser iframe. External network access and external assets are unavailable. Everything required by the result must exist in the returned HTML.
- You may use any browser-native capability available inside the sandbox. The host does not prefer or recommend any particular implementation or visual approach. Feature-detect optional or newer browser capabilities when needed.
- Do not access parent/top/opener, cookies, storage, credentials, camera, microphone, geolocation, clipboard, or the network. Do not produce sound.
- The result must fit arbitrary viewport sizes, remain responsive, and continue to render when audio is absent or silent.
- The result must respond meaningfully to the read-only music state supplied by window.VIZ. How you interpret that state is entirely up to you.

window.VIZ:
- VIZ.version -> "visualizer-audio-v1"
- VIZ.frame -> the most recent host frame
- VIZ.viewport -> { width, height, dpr }
- VIZ.onFrame(callback) -> subscribe to new host frames; returns an unsubscribe function

Each host frame contains:
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

The easy audio features are normalized adaptively. waveform and spectrum remain available for any interpretation you choose. Tempo may be unavailable and music may have no regular beat.`;

export const PROMPT_PRESETS = Object.freeze([
  Object.freeze({
    id: 'neutral-v1',
    name: 'Neutral blank canvas',
    description: 'Minimal creative direction. The runtime contract is appended separately.',
    creativeBrief: NEUTRAL_CREATIVE_BRIEF,
    legacy: false,
  }),
  Object.freeze({
    id: 'baseline-v1',
    name: 'Original baseline',
    description: 'The exact prompt used for the first successful Grok experiment and earlier runs.',
    creativeBrief: BASELINE_CREATIVE_BRIEF,
    legacy: true,
  }),
]);

const NEW_SYSTEM_MESSAGE = 'Return exactly one complete self-contained HTML document that satisfies the supplied creative brief and runtime contract. Do not add commentary or Markdown.';
const LEGACY_SYSTEM_MESSAGE = 'You are the sole artist and engineer of a real-time music visualizer. Follow the user brief exactly. Return only the requested self-contained HTML document.';
const REPAIR_SYSTEM_MESSAGE = 'Repair the visualizer only enough to satisfy the supplied runtime failure while preserving its existing artistic concept. Return exactly one complete self-contained HTML document and no Markdown.';

function storageOrNull(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function hashText(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function presetById(id) {
  return PROMPT_PRESETS.find(preset => preset.id === id) || null;
}

function cleanCreativeBrief(value) {
  const brief = String(value ?? '').trim();
  if (!brief) throw new TypeError('Creative brief cannot be empty.');
  if (brief.length > MAX_CREATIVE_BRIEF_CHARS) {
    throw new RangeError(`Creative brief must be ${MAX_CREATIVE_BRIEF_CHARS.toLocaleString()} characters or fewer.`);
  }
  return brief;
}

export function promptPreset(id = DEFAULT_PROMPT_PRESET_ID) {
  const preset = presetById(id) || presetById(DEFAULT_PROMPT_PRESET_ID);
  return Object.freeze({
    schema: PROMPT_PROFILE_SCHEMA,
    id: preset.id,
    name: preset.name,
    source: 'preset',
    creativeBrief: preset.creativeBrief,
    legacy: preset.legacy,
    briefHash: hashText(preset.creativeBrief),
  });
}

export function customPromptProfile(creativeBrief, name = 'Custom prompt') {
  const brief = cleanCreativeBrief(creativeBrief);
  const briefHash = hashText(brief);
  return Object.freeze({
    schema: PROMPT_PROFILE_SCHEMA,
    id: `custom-${briefHash}`,
    name: String(name || 'Custom prompt').trim().slice(0, 80) || 'Custom prompt',
    source: 'custom',
    creativeBrief: brief,
    legacy: false,
    briefHash,
  });
}

export function normalizePromptProfile(profile) {
  if (!profile || typeof profile !== 'object') return promptPreset();
  const preset = presetById(profile.id || profile.presetId);
  if (preset && profile.source !== 'custom') return promptPreset(preset.id);
  if (typeof profile.creativeBrief === 'string' && profile.creativeBrief.trim()) {
    return customPromptProfile(profile.creativeBrief, profile.name);
  }
  return promptPreset();
}

export function loadPromptProfile(storage = null) {
  const target = storageOrNull(storage);
  if (!target?.getItem) return promptPreset();
  try {
    const parsed = JSON.parse(target.getItem(PROMPT_STORAGE_KEY) || 'null');
    if (!parsed || parsed.schema !== PROMPT_PROFILE_SCHEMA) return promptPreset();
    return normalizePromptProfile(parsed);
  } catch {
    return promptPreset();
  }
}

export function savePromptProfile(profile, storage = null) {
  const normalized = normalizePromptProfile(profile);
  const target = storageOrNull(storage);
  if (target?.setItem) {
    try {
      target.setItem(PROMPT_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Prompt selection still works for this page even when browser persistence is unavailable.
    }
  }
  return normalized;
}

export function selectPromptPreset(id, storage = null) {
  return savePromptProfile(promptPreset(id), storage);
}

export function profileForCreativeBrief(creativeBrief, preferredPresetId = '') {
  const brief = cleanCreativeBrief(creativeBrief);
  const preferred = presetById(preferredPresetId);
  if (preferred && brief === preferred.creativeBrief.trim()) return promptPreset(preferred.id);
  const exactPreset = PROMPT_PRESETS.find(preset => brief === preset.creativeBrief.trim());
  return exactPreset ? promptPreset(exactPreset.id) : customPromptProfile(brief);
}

export function composeVisualizerUserPrompt(profile = loadPromptProfile()) {
  const normalized = normalizePromptProfile(profile);
  if (normalized.legacy && normalized.id === 'baseline-v1') return LEGACY_CANONICAL_VISUALIZER_PROMPT;
  return `${normalized.creativeBrief}\n\n${FIXED_RUNTIME_CONTRACT}`;
}

export const CANONICAL_VISUALIZER_PROMPT = composeVisualizerUserPrompt(promptPreset(DEFAULT_PROMPT_PRESET_ID));

export function buildGenerationMessages(profile = loadPromptProfile()) {
  const normalized = normalizePromptProfile(profile);
  return [
    { role: 'system', content: normalized.legacy ? LEGACY_SYSTEM_MESSAGE : NEW_SYSTEM_MESSAGE },
    { role: 'user', content: composeVisualizerUserPrompt(normalized) },
  ];
}

export function buildRepairMessages(originalOutput, problem, profile = loadPromptProfile()) {
  const normalized = normalizePromptProfile(profile);
  if (normalized.legacy && normalized.id === 'baseline-v1') {
    return [
      { role: 'system', content: 'Repair the visualizer while preserving its artistic idea. Return only one complete self-contained HTML document and no Markdown.' },
      { role: 'user', content: `${LEGACY_CANONICAL_VISUALIZER_PROMPT}\n\nYour previous attempt failed this validation/runtime check:\n${problem}\n\nRepair it. Preserve the visual concept as much as possible. Previous output follows:\n\n${originalOutput}` },
    ];
  }
  return [
    { role: 'system', content: REPAIR_SYSTEM_MESSAGE },
    { role: 'user', content: `${composeVisualizerUserPrompt(normalized)}\n\nREPAIR CONTEXT:\nThe previous HTML failed this validation/runtime check:\n${problem}\n\nRepair the failure without redesigning the concept merely because a repair is required. Previous output follows:\n\n${originalOutput}` },
  ];
}

function mountPromptLabAfterHostReady() {
  const mount = () => {
    setTimeout(() => {
      void import('./prompt-lab.js')
        .then(module => module.mountPromptLab?.())
        .catch(error => console.warn('Prompt Lab could not be initialized:', error));
    }, 0);
  };
  if (document.readyState === 'complete') mount();
  else window.addEventListener('load', mount, { once: true });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  mountPromptLabAfterHostReady();
}
