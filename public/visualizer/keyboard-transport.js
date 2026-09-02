export const KEYBOARD_TRANSPORT_VERSION = 'visualizer-keyboard-transport-v1';
export const KEYBOARD_TRANSPORT_SCHEMA = KEYBOARD_TRANSPORT_VERSION;

export const GLOBAL_ARROW_COMMANDS = Object.freeze({
  ArrowLeft: 'favorite-previous',
  ArrowRight: 'favorite-next',
  ArrowUp: 'sensitivity-increase',
  ArrowDown: 'sensitivity-decrease',
});

const FAVORITE_DIRECTIONS = Object.freeze({
  ArrowLeft: -1,
  ArrowRight: 1,
  'favorite-previous': -1,
  'favorite-next': 1,
});

const NATIVE_ARROW_OWNERS = new Set([
  'AUDIO',
  'IFRAME',
  'INPUT',
  'OPTION',
  'OPTGROUP',
  'SELECT',
  'TEXTAREA',
  'VIDEO',
]);

const ARIA_ARROW_OWNERS = new Set([
  'application',
  'combobox',
  'grid',
  'gridcell',
  'listbox',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'radiogroup',
  'row',
  'rowheader',
  'columnheader',
  'scrollbar',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'tab',
  'tablist',
  'textbox',
  'toolbar',
  'tree',
  'treegrid',
  'treeitem',
]);

const OPEN_OWNER_SELECTOR = [
  'dialog',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '.drawer',
  '#dreamSwitcherPanel',
  '.dream-switcher',
  '[data-switcher]',
  '[popover]',
  '.popover',
  '[data-popover]',
].join(', ');

function favoriteIdentifiers(value) {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [value];
  return ['key', 'id', 'generationId', 'artifactId']
    .filter(name => Object.hasOwn(value, name) && value[name] !== '' && value[name] !== null && value[name] !== undefined)
    .map(name => value[name]);
}

function isCurrentFavorite(favorite, currentFavorite) {
  if (favorite === currentFavorite) return true;
  const currentIdentifiers = favoriteIdentifiers(currentFavorite);
  if (!currentIdentifiers.length) return false;
  const favoriteIdentifiersSet = new Set(favoriteIdentifiers(favorite));
  return currentIdentifiers.some(identifier => favoriteIdentifiersSet.has(identifier));
}

/**
 * Selects from the supplied Favorites order without sorting or cloning it.
 * The return value is the original Favorite entry, or null when no route exists.
 */
export function favoriteTargetForArrow(favorites, currentFavorite, arrowOrCommand) {
  if (!Array.isArray(favorites) || favorites.length === 0) return null;
  const direction = FAVORITE_DIRECTIONS[arrowOrCommand];
  if (!direction) return null;

  const currentIndex = favorites.findIndex(favorite => isCurrentFavorite(favorite, currentFavorite));
  if (currentIndex < 0) return direction > 0 ? favorites[0] : favorites[favorites.length - 1];
  return favorites[(currentIndex + direction + favorites.length) % favorites.length];
}

function attribute(element, name) {
  if (!element || typeof element !== 'object') return null;
  if (typeof element.getAttribute === 'function') {
    try {
      const value = element.getAttribute(name);
      if (value !== null && value !== undefined) return String(value);
    } catch {
      // A partial DOM facade may not support every attribute.
    }
  }

  const propertyNames = {
    class: 'className',
    contenteditable: 'contentEditable',
    id: 'id',
    popover: 'popover',
    role: 'role',
    type: 'type',
  };
  const propertyName = propertyNames[name];
  const value = propertyName ? element[propertyName] : undefined;
  return value === null || value === undefined ? null : String(value);
}

function hasAttribute(element, name) {
  if (!element || typeof element !== 'object') return false;
  if (typeof element.hasAttribute === 'function') {
    try {
      return element.hasAttribute(name);
    } catch {
      // Fall through to the browser-neutral attribute lookup.
    }
  }
  return attribute(element, name) !== null;
}

function tagName(element) {
  return String(element?.tagName || element?.nodeName || '').toUpperCase();
}

function classTokens(element) {
  const value = attribute(element, 'class');
  return value ? value.toLowerCase().split(/\s+/).filter(Boolean) : [];
}

function roleTokens(element) {
  const value = attribute(element, 'role');
  return value ? value.toLowerCase().split(/\s+/).filter(Boolean) : [];
}

function hasNamedNavigationContext(element) {
  const id = String(element?.id || attribute(element, 'id') || '').toLowerCase();
  const classes = classTokens(element);
  const promptLab = id.startsWith('promptlab')
    || classes.some(name => name === 'prompt-lab' || name.startsWith('prompt-lab__'));
  const dreamSwitcher = id.startsWith('dreamswitcher')
    || classes.some(name => name === 'dream-switcher' || name.startsWith('dream-switcher__'));
  const modelNavigation = [
    'modeldrawer',
    'modelsearch',
    'modellist',
    'modelguidepicks',
    'allmodelspanel',
  ].includes(id) || classes.some(name => (
    name === 'model-list'
    || name === 'model-option'
    || name === 'model-guide'
    || name === 'model-pick'
    || name === 'all-models-panel'
    || name.startsWith('model-list__')
    || name.startsWith('model-option__')
    || name.startsWith('model-guide__')
    || name.startsWith('model-pick__')
  ));

  return promptLab || dreamSwitcher || modelNavigation;
}

function isContentEditable(element) {
  if (element?.isContentEditable === true) return true;
  const value = attribute(element, 'contenteditable');
  if (value === null) return false;
  return value === '' || value.toLowerCase() === 'true' || value.toLowerCase() === 'plaintext-only';
}

function ownsArrowSemantics(element) {
  const tag = tagName(element);
  if (NATIVE_ARROW_OWNERS.has(tag) || tag === 'DIALOG') return true;
  if (isContentEditable(element) || hasNamedNavigationContext(element)) return true;

  const roles = roleTokens(element);
  if (roles.some(role => ARIA_ARROW_OWNERS.has(role) || role === 'dialog' || role === 'alertdialog')) return true;
  if (attribute(element, 'aria-activedescendant')) return true;
  if (
    hasAttribute(element, 'popover')
    || hasAttribute(element, 'data-popover')
    || hasAttribute(element, 'data-arrow-navigation')
    || hasAttribute(element, 'data-keyboard-navigation')
    || hasAttribute(element, 'data-roving-tabindex')
  ) return true;

  const classes = classTokens(element);
  return classes.includes('drawer') || classes.includes('popover');
}

function parentElement(element) {
  const parent = element?.parentElement || element?.parentNode || element?.host || null;
  return parent === element ? null : parent;
}

function elementOrAncestorOwnsArrows(element) {
  const seen = new Set();
  let current = element;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (ownsArrowSemantics(current)) return true;
    current = parentElement(current);
  }
  return false;
}

function isHiddenTree(element) {
  const seen = new Set();
  let current = element;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const ariaHidden = attribute(current, 'aria-hidden')?.toLowerCase();
    const style = current.style || {};
    const styleText = attribute(current, 'style') || '';
    if (
      current.hidden === true
      || current.inert === true
      || hasAttribute(current, 'hidden')
      || hasAttribute(current, 'inert')
      || ariaHidden === 'true'
      || style.display === 'none'
      || style.visibility === 'hidden'
      || /(?:^|;)\s*display\s*:\s*none\b/i.test(styleText)
      || /(?:^|;)\s*visibility\s*:\s*hidden\b/i.test(styleText)
    ) return true;
    current = parentElement(current);
  }
  return false;
}

function matchesState(element, selector) {
  if (typeof element?.matches !== 'function') return false;
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function stateIsOpen(element) {
  const value = name => attribute(element, name)?.toLowerCase();
  const classes = classTokens(element);
  return element?.open === true
    || element?.popoverOpen === true
    || hasAttribute(element, 'open')
    || matchesState(element, ':modal')
    || matchesState(element, ':popover-open')
    || classes.includes('is-open')
    || classes.includes('open')
    || value('aria-hidden') === 'false'
    || value('aria-expanded') === 'true'
    || value('data-open') === 'true'
    || value('data-popover-open') === 'true'
    || value('data-state') === 'open';
}

function isOpenSemanticOwner(element) {
  if (!element || isHiddenTree(element)) return false;
  const tag = tagName(element);
  const roles = roleTokens(element);
  const classes = classTokens(element);
  const id = String(element.id || attribute(element, 'id') || '').toLowerCase();
  const isDialog = tag === 'DIALOG' || roles.includes('dialog') || roles.includes('alertdialog');
  const isDrawer = classes.includes('drawer') || hasAttribute(element, 'data-drawer');
  const isSwitcher = id.startsWith('dreamswitcher')
    || classes.includes('dream-switcher')
    || hasAttribute(element, 'data-switcher');
  const isPopover = hasAttribute(element, 'popover')
    || hasAttribute(element, 'data-popover')
    || classes.includes('popover');
  if (isDialog && tag !== 'DIALOG') return true;
  return (isDialog || isDrawer || isSwitcher || isPopover) && stateIsOpen(element);
}

function documentHasOpenSemanticOwner(documentRef) {
  if (!documentRef || typeof documentRef.querySelectorAll !== 'function') return false;
  try {
    return Array.from(documentRef.querySelectorAll(OPEN_OWNER_SELECTOR)).some(isOpenSemanticOwner);
  } catch {
    return false;
  }
}

function eventPath(event) {
  if (typeof event?.composedPath !== 'function') return [];
  try {
    return event.composedPath();
  } catch {
    return [];
  }
}

export function shouldIgnoreGlobalArrowShortcut(event, options = {}) {
  const key = event?.key;
  if (!Object.hasOwn(GLOBAL_ARROW_COMMANDS, key)) return true;
  if (
    event.defaultPrevented
    || event.repeat
    || event.isComposing
    || event.keyCode === 229
    || event.which === 229
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
  ) return true;

  const documentRef = options?.document ?? globalThis.document ?? null;
  if (String(documentRef?.designMode || '').toLowerCase() === 'on') return true;

  const candidates = [event.target, ...eventPath(event), documentRef?.activeElement].filter(Boolean);
  if (candidates.some(elementOrAncestorOwnsArrows)) return true;
  return documentHasOpenSemanticOwner(documentRef);
}

export function globalArrowCommand(event, options = {}) {
  if (shouldIgnoreGlobalArrowShortcut(event, options)) return null;
  return GLOBAL_ARROW_COMMANDS[event.key];
}

export const commandForGlobalArrowShortcut = globalArrowCommand;
