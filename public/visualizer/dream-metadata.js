import { identityMarker } from './live-identity.js';
import { PROMPT_PRESETS } from './prompt.js';

export const MAX_DREAM_DISPLAY_TITLE_CHARS = 80;

function cleanText(value, maxLength = MAX_DREAM_DISPLAY_TITLE_CHARS) {
  let printable = '';
  for (const character of String(value ?? '')) {
    const codePoint = character.codePointAt(0);
    if (codePoint >= 32 && codePoint !== 127) printable += character;
    else if (character === '\t' || character === '\r' || character === '\n') printable += ' ';
  }
  return [...printable.replace(/\s+/g, ' ').trim()].slice(0, maxLength).join('');
}

export function editableDreamDisplayTitle(value) {
  const source = String(value ?? '');
  const title = cleanText(source);
  if (source.trim() && [...source.trim()].length > MAX_DREAM_DISPLAY_TITLE_CHARS) {
    throw new RangeError(`Dream titles must be ${MAX_DREAM_DISPLAY_TITLE_CHARS} characters or fewer.`);
  }
  if (source.trim() && !title) throw new TypeError('Dream title must contain visible text.');
  return title;
}

export function htmlDocumentTitle(html) {
  const match = String(html || '').match(/<title(?:\s[^>]*)?>([^<]{1,240})<\/title\s*>/i);
  return cleanText(match?.[1]);
}

export function dreamDisplayTitle(dream = {}) {
  for (const candidate of [
    dream.displayTitle,
    dream.curatedDisplayTitle,
    dream.artifactTitle,
    dream.title,
  ]) {
    const title = cleanText(candidate);
    if (title) return title;
  }
  const modelName = cleanText(dream.modelName || dream.modelId || 'Dream');
  const sourceId = String(dream.id || dream.generationId || dream.traceId || modelName);
  return `${modelName || 'Dream'} · #${identityMarker(sourceId)}`;
}

function promptHash(dream) {
  return String(
    dream.promptProfile?.briefHash
      || dream.modelFitConfiguration?.promptHash
      || dream.modelFitConfiguration?.promptProfileHash
      || '',
  );
}

export function dreamPromptLabel(dream = {}, { savedPrompts = [], presets = PROMPT_PRESETS } = {}) {
  const profileId = String(dream.promptProfileId || dream.promptProfile?.id || '').trim();
  const hash = promptHash(dream);
  const matchingSaved = savedPrompts.filter(entry => (
    String(entry?.profileId || '') === profileId
    && (!hash || !entry?.briefHash || String(entry.briefHash) === hash)
  ));
  const promptLibraryEntryId = String(dream.promptLibraryEntryId || '').trim();
  const saved = promptLibraryEntryId
    ? matchingSaved.find(entry => String(entry?.entryId || '') === promptLibraryEntryId)
    : matchingSaved.length === 1 ? matchingSaved[0] : null;
  const savedName = cleanText(saved?.name);
  if (savedName) return savedName;

  const preset = presets.find(entry => String(entry?.id || '') === profileId);
  const presetName = cleanText(preset?.name);
  if (presetName) return presetName;

  for (const candidate of [dream.promptProfileName, dream.promptProfile?.name]) {
    const name = cleanText(candidate);
    if (name && name !== profileId) return name;
  }

  if (profileId === 'not-applicable-host-authored') return 'Host-authored';
  if (profileId.startsWith('custom-')) return `Custom prompt · #${profileId.slice(7, 15) || 'unknown'}`;
  if (profileId && profileId !== 'not-captured') return `Prompt · ${cleanText(profileId, 60)}`;
  return 'Prompt not captured';
}
