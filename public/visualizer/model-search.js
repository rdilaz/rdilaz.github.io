export function normalizeModelSearch(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decimalSearchShape(value) {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
  const characters = [...normalized];
  return characters.map((character, index) => {
    if (/^[\p{L}\p{N}]$/u.test(character)) return character;
    if (character === '.' && /^\p{N}$/u.test(characters[index - 1] || '') && /^\p{N}$/u.test(characters[index + 1] || '')) return '.';
    return ' ';
  }).join('').replace(/\s+/g, ' ').trim();
}

export function modelSearchMatches(model, query, { provider = model?.provider || '' } = {}) {
  const normalizedQuery = normalizeModelSearch(query);
  if (!normalizedQuery) return true;
  const fields = [model?.name || model?.id || '', model?.id || '', provider]
    .map(normalizeModelSearch)
    .filter(Boolean);
  const searchable = [...fields, ...fields.map(field => field.replaceAll(' ', ''))];
  const tokens = [...new Set(normalizedQuery.split(' ').filter(Boolean))];
  if (!tokens.every(token => searchable.some(field => field.includes(token)))) return false;
  const queryShape = decimalSearchShape(query);
  if (!/\p{N}\.\p{N}/u.test(queryShape)) return true;
  const compactQueryShape = queryShape.replaceAll(' ', '');
  return [model?.name || model?.id || '', model?.id || '', provider]
    .map(decimalSearchShape)
    .some(field => field.replaceAll(' ', '').includes(compactQueryShape));
}
