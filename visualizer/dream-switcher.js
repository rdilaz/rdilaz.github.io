import { dreamDisplayTitle, dreamPromptLabel } from './dream-metadata.js';
import { featuredDreamGuide } from './featured-dream-guide.js';

export const DREAM_SWITCHER_SCHEMA = 'visualizer-dream-switcher-v1';
export const RECENT_DREAM_LIMIT = 8;

const clone = value => structuredClone(value);

export function localDreamKey(generation) {
  return `local:${generation.id}`;
}

function usableLocalDream(generation) {
  if (!generation?.id || !generation?.html) return false;
  if (generation.healthStatus === 'failed-on-device' && generation.healthStatus !== 'ready') return false;
  return ['ready', 'verified'].includes(generation.healthStatus)
    || ['ready-to-open', 'verified-live', 'failed-to-open'].includes(generation.openStatus);
}

function localItem(generation, activeKey, savedPrompts) {
  const key = localDreamKey(generation);
  const state = generation.openStatus === 'ready-to-open'
    ? 'Ready'
    : generation.openStatus === 'failed-to-open'
      ? 'Needs attention'
      : key === activeKey
        ? 'LIVE'
        : 'Saved';
  return {
    key,
    source: 'local',
    id: generation.id,
    title: dreamDisplayTitle(generation),
    modelName: generation.modelName || generation.modelId,
    promptLabel: dreamPromptLabel(generation, { savedPrompts }),
    createdAt: Number(generation.readyAt || generation.createdAt || 0),
    favorite: Boolean(generation.favorite),
    active: key === activeKey,
    state,
    generation,
  };
}

export function buildDreamSwitcherGroups({
  featured = [],
  generations = [],
  activeKey = '',
  recentLimit = RECENT_DREAM_LIMIT,
  savedPrompts = [],
} = {}) {
  const featuredItems = featured
    .map(item => ({
      key: item.key || `featured:${item.id}`,
      source: 'featured',
      id: item.id,
      title: dreamDisplayTitle(item),
      modelName: item.provenance?.generatedByModel ? item.modelName : 'Built-in visual',
      promptLabel: dreamPromptLabel(item, { savedPrompts }),
      favorite: false,
      active: (item.key || `featured:${item.id}`) === activeKey,
      state: (item.key || `featured:${item.id}`) === activeKey ? 'LIVE' : 'Featured',
      guide: featuredDreamGuide(item.id),
      featured: item,
    }))
    .sort((a, b) => Number(a.featured.order) - Number(b.featured.order) || a.id.localeCompare(b.id));
  const locals = generations.filter(usableLocalDream).map(generation => localItem(generation, activeKey, savedPrompts));
  const newestFirst = (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id);
  return Object.freeze({
    schema: DREAM_SWITCHER_SCHEMA,
    featured: featuredItems.map(clone),
    favorites: locals.filter(item => item.favorite).sort(newestFirst).map(clone),
    recent: locals.sort(newestFirst).slice(0, Math.max(1, Number(recentLimit) || RECENT_DREAM_LIMIT)).map(clone),
  });
}

function groupLabel(name) {
  return ({ featured: 'Featured', favorites: 'Favorites', recent: 'Recent' })[name] || name;
}

export function mountDreamSwitcher({
  root = document,
  onOpen = () => {},
  onFavorite = () => {},
  onVisibilityChange = () => {},
} = {}) {
  const panel = root.getElementById('dreamSwitcherPanel');
  const groupsRoot = root.getElementById('dreamSwitcherGroups');
  const toggle = root.getElementById('switcherButton');
  const close = root.getElementById('dreamSwitcherClose');
  let current = buildDreamSwitcherGroups();
  let open = false;

  function isOpen() {
    return open;
  }

  function setOpen(next, { restoreFocus = false } = {}) {
    open = Boolean(next);
    if (panel) {
      panel.hidden = !open;
      panel.setAttribute('aria-hidden', String(!open));
    }
    toggle?.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('switcher-open', open);
    onVisibilityChange(open);
    if (open) {
      document.body.classList.remove('ui-hidden');
      panel?.focus({ preventScroll: true });
    }
    else if (restoreFocus) toggle?.focus();
  }

  function renderGroup(name, items) {
    const section = document.createElement('section');
    section.className = 'dream-switcher__group';
    section.dataset.switcherGroup = name;
    const heading = document.createElement('h3');
    heading.textContent = groupLabel(name);
    const list = document.createElement('div');
    list.className = 'dream-switcher__items';
    list.setAttribute('role', 'list');
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'dream-switcher__empty';
      empty.textContent = name === 'favorites' ? 'Save a Dream to keep it here.' : 'Your ready and opened Dreams appear here.';
      list.appendChild(empty);
    }
    for (const item of items) {
      const row = document.createElement('article');
      row.className = 'dream-switcher__item';
      row.dataset.dreamKey = item.key;
      row.setAttribute('role', 'listitem');
      if (item.active) row.classList.add('is-active');
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'dream-switcher__choose';
      choose.dataset.switcherChoose = item.key;
      choose.dataset.switcherAction = 'choose';
      choose.setAttribute('aria-label', `${item.active ? 'Current Dream' : 'Open Dream'}: ${item.title}, ${item.modelName}, prompt ${item.promptLabel}`);
      if (item.active) choose.setAttribute('aria-current', 'true');
      const title = document.createElement('strong');
      title.textContent = item.title;
      const model = document.createElement('small');
      model.textContent = item.modelName;
      const prompt = document.createElement('small');
      prompt.className = 'dream-switcher__prompt';
      prompt.textContent = `Prompt: ${item.promptLabel}`;
      const state = document.createElement('span');
      state.textContent = item.state;
      choose.append(title, model, prompt, state);
      choose.addEventListener('click', () => onOpen(item));
      row.appendChild(choose);
      if (item.source === 'local') {
        const favorite = document.createElement('button');
        favorite.type = 'button';
        favorite.className = 'dream-switcher__favorite';
        favorite.dataset.switcherAction = 'favorite';
        favorite.textContent = item.favorite ? '♥' : '♡';
        favorite.setAttribute('aria-label', item.favorite ? `Remove ${item.title} from favorites` : `Save ${item.title} to favorites`);
        favorite.setAttribute('aria-pressed', String(item.favorite));
        favorite.addEventListener('click', () => onFavorite(item));
        row.appendChild(favorite);
      }
      if (item.guide) {
        const guide = document.createElement('details');
        guide.className = 'dream-switcher__guide';
        guide.dataset.dreamGuide = item.id;
        const summary = document.createElement('summary');
        summary.textContent = 'About this Dream';
        const description = document.createElement('p');
        description.textContent = item.guide.description;
        guide.append(summary, description);
        if (item.guide.interactionHint) {
          const hint = document.createElement('p');
          hint.className = 'dream-switcher__guide-hint';
          hint.textContent = item.guide.interactionHint;
          guide.appendChild(hint);
        }
        const explanation = document.createElement('p');
        explanation.className = 'dream-switcher__guide-detail';
        explanation.textContent = item.guide.explanation;
        guide.appendChild(explanation);
        row.appendChild(guide);
      }
      list.appendChild(row);
    }
    section.append(heading, list);
    return section;
  }

  function render(groups = current) {
    current = groups;
    const focused = groupsRoot?.contains(document.activeElement) ? document.activeElement : null;
    const focusedKey = focused?.closest('[data-dream-key]')?.dataset.dreamKey || '';
    const focusedAction = focused?.dataset.switcherAction || '';
    groupsRoot?.replaceChildren(
      renderGroup('featured', groups.featured),
      renderGroup('favorites', groups.favorites),
      renderGroup('recent', groups.recent),
    );
    if (focusedKey && focusedAction) {
      const matchingRow = [...groupsRoot.querySelectorAll('[data-dream-key]')].find(row => row.dataset.dreamKey === focusedKey);
      matchingRow?.querySelector(`[data-switcher-action="${focusedAction}"]`)?.focus({ preventScroll: true });
    }
  }

  toggle?.addEventListener('click', () => setOpen(!open, { restoreFocus: open }));
  close?.addEventListener('click', () => setOpen(false, { restoreFocus: true }));
  panel?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false, { restoreFocus: true });
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const buttons = [...panel.querySelectorAll('[data-switcher-choose]')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0 || !buttons.length) return;
    event.preventDefault();
    const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
    buttons[(index + direction + buttons.length) % buttons.length].focus();
  });

  render(current);
  return Object.freeze({
    render,
    isOpen,
    open: ({ group = '' } = {}) => {
      setOpen(true);
      if (group) {
        queueMicrotask(() => {
          const target = groupsRoot?.querySelector(`[data-switcher-group="${group}"] [data-switcher-choose]`);
          target?.focus({ preventScroll: true });
          target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        });
      }
    },
    close: options => setOpen(false, options),
    toggle: () => setOpen(!open),
  });
}
