import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GLOBAL_ARROW_COMMANDS,
  KEYBOARD_TRANSPORT_SCHEMA,
  commandForGlobalArrowShortcut,
  favoriteTargetForArrow,
  shouldIgnoreGlobalArrowShortcut,
} from '../public/visualizer/keyboard-transport.js';

function fakeElement({
  tag = 'div',
  id = '',
  classes = [],
  attributes = {},
  parent = null,
  hidden = false,
  inert = false,
  open = false,
  popoverOpen = false,
  isContentEditable = false,
} = {}) {
  const values = new Map(Object.entries({
    ...(id ? { id } : {}),
    ...(classes.length ? { class: classes.join(' ') } : {}),
    ...attributes,
  }).map(([name, value]) => [name.toLowerCase(), String(value)]));
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id,
    className: classes.join(' '),
    parentElement: parent,
    hidden,
    inert,
    open,
    popoverOpen,
    isContentEditable,
    style: {},
    getAttribute(name) {
      return values.get(String(name).toLowerCase()) ?? null;
    },
    hasAttribute(name) {
      return values.has(String(name).toLowerCase());
    },
    matches(selector) {
      return (selector === ':popover-open' && popoverOpen)
        || (selector === ':modal' && open && this.tagName === 'DIALOG');
    },
  };
}

function fakeDocument({ activeElement = null, openOwners = [] } = {}) {
  return {
    activeElement,
    designMode: 'off',
    querySelectorAll() {
      return openOwners;
    },
  };
}

function keyEvent(key, target, overrides = {}) {
  return {
    key,
    target,
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

const FAVORITES = Object.freeze([
  Object.freeze({ key: 'local:newest', id: 'newest' }),
  Object.freeze({ key: 'local:middle', id: 'middle' }),
  Object.freeze({ key: 'local:oldest', id: 'oldest' }),
]);

test('transport contract is versioned and maps only the four global arrows', () => {
  assert.equal(KEYBOARD_TRANSPORT_SCHEMA, 'visualizer-keyboard-transport-v1');
  assert.deepEqual(GLOBAL_ARROW_COMMANDS, {
    ArrowLeft: 'favorite-previous',
    ArrowRight: 'favorite-next',
    ArrowUp: 'sensitivity-increase',
    ArrowDown: 'sensitivity-decrease',
  });
});

test('milestone 89: Left selects the previous Favorite and wraps in supplied order', () => {
  assert.strictEqual(favoriteTargetForArrow(FAVORITES, 'local:middle', 'ArrowLeft'), FAVORITES[0]);
  assert.strictEqual(favoriteTargetForArrow(FAVORITES, { id: 'newest' }, 'favorite-previous'), FAVORITES[2]);
});

test('milestone 90: Right selects the next Favorite and wraps in supplied order', () => {
  assert.strictEqual(favoriteTargetForArrow(FAVORITES, 'middle', 'ArrowRight'), FAVORITES[2]);
  assert.strictEqual(favoriteTargetForArrow(FAVORITES, FAVORITES[2], 'favorite-next'), FAVORITES[0]);
});

test('milestone 91: current non-Favorite plus Right selects the first Favorite', () => {
  assert.strictEqual(favoriteTargetForArrow(FAVORITES, 'featured:calibration-bloom', 'ArrowRight'), FAVORITES[0]);
});

test('milestone 92: current non-Favorite plus Left selects the last Favorite', () => {
  assert.strictEqual(favoriteTargetForArrow(FAVORITES, 'featured:calibration-bloom', 'ArrowLeft'), FAVORITES[2]);
});

test('milestone 93: zero Favorites is safe and resolves to null', () => {
  assert.equal(favoriteTargetForArrow([], 'anything', 'ArrowLeft'), null);
  assert.equal(favoriteTargetForArrow([], 'anything', 'ArrowRight'), null);
  assert.equal(favoriteTargetForArrow(FAVORITES, 'middle', 'ArrowUp'), null);
});

test('milestone 94: input consumes arrows without a global command', () => {
  const input = fakeElement({ tag: 'input', attributes: { type: 'text' } });
  const event = keyEvent('ArrowLeft', input);
  const document = fakeDocument({ activeElement: input });
  assert.equal(shouldIgnoreGlobalArrowShortcut(event, { document }), true);
  assert.equal(commandForGlobalArrowShortcut(event, { document }), null);
});

test('milestone 95: textarea consumes arrows without a global command', () => {
  const textarea = fakeElement({ tag: 'textarea' });
  const event = keyEvent('ArrowDown', textarea);
  assert.equal(commandForGlobalArrowShortcut(event, { document: fakeDocument({ activeElement: textarea }) }), null);
});

test('milestone 96: Prompt Lab editor and descendants consume arrows', () => {
  const promptLab = fakeElement({ tag: 'form', classes: ['prompt-lab'] });
  const editorSurface = fakeElement({ id: 'promptLabEditor', parent: promptLab });
  const child = fakeElement({ tag: 'span', parent: editorSurface });
  const event = keyEvent('ArrowRight', child);
  assert.equal(commandForGlobalArrowShortcut(event, { document: fakeDocument({ activeElement: editorSurface }) }), null);
});

test('milestone 97: model search and model navigation consume arrows', () => {
  const drawer = fakeElement({ id: 'modelDrawer', classes: ['drawer', 'is-open'], attributes: { 'aria-hidden': 'false' } });
  const search = fakeElement({ tag: 'input', id: 'modelSearch', attributes: { type: 'search' }, parent: drawer });
  const event = keyEvent('ArrowDown', search);
  assert.equal(commandForGlobalArrowShortcut(event, { document: fakeDocument({ activeElement: search, openOwners: [drawer] }) }), null);
});

test('milestone 98: Dream switcher retains ownership of its arrow navigation', () => {
  const switcher = fakeElement({ id: 'dreamSwitcherPanel', classes: ['dream-switcher'], attributes: { 'aria-hidden': 'false' } });
  const switcherChoice = fakeElement({ tag: 'button', classes: ['dream-switcher__choose'], parent: switcher });
  const event = keyEvent('ArrowRight', switcherChoice);
  assert.equal(shouldIgnoreGlobalArrowShortcut(event, { document: fakeDocument({ activeElement: switcherChoice, openOwners: [switcher] }) }), true);
});

test('milestone 99: native range and ARIA slider controls consume arrows', () => {
  const range = fakeElement({ tag: 'input', attributes: { type: 'range' } });
  const slider = fakeElement({ attributes: { role: 'slider' } });
  assert.equal(commandForGlobalArrowShortcut(keyEvent('ArrowUp', range), { document: fakeDocument({ activeElement: range }) }), null);
  assert.equal(commandForGlobalArrowShortcut(keyEvent('ArrowDown', slider), { document: fakeDocument({ activeElement: slider }) }), null);
});

test('milestone 100: dialog, drawer, and open popover state prevent global shortcuts', () => {
  const body = fakeElement({ tag: 'body' });
  const dialog = fakeElement({ tag: 'dialog', open: true, parent: body });
  const dialogButton = fakeElement({ tag: 'button', parent: dialog });
  assert.equal(commandForGlobalArrowShortcut(keyEvent('ArrowLeft', dialogButton), {
    document: fakeDocument({ activeElement: dialogButton, openOwners: [dialog] }),
  }), null);

  const drawer = fakeElement({ classes: ['drawer', 'is-open'], attributes: { 'aria-hidden': 'false' }, parent: body });
  const drawerFocus = fakeElement({ tag: 'button', parent: drawer });
  assert.equal(commandForGlobalArrowShortcut(keyEvent('ArrowRight', body), {
    document: fakeDocument({ activeElement: drawerFocus, openOwners: [drawer] }),
  }), null);

  const popover = fakeElement({ attributes: { popover: 'auto' }, popoverOpen: true, parent: body });
  assert.equal(commandForGlobalArrowShortcut(keyEvent('ArrowUp', body), {
    document: fakeDocument({ activeElement: body, openOwners: [popover] }),
  }), null);
});

test('safe normal context returns each command exactly', () => {
  const body = fakeElement({ tag: 'body' });
  const document = fakeDocument({ activeElement: body });
  for (const [key, command] of Object.entries(GLOBAL_ARROW_COMMANDS)) {
    const event = keyEvent(key, body);
    assert.equal(shouldIgnoreGlobalArrowShortcut(event, { document }), false, key);
    assert.equal(commandForGlobalArrowShortcut(event, { document }), command, key);
  }
});

test('non-arrows, consumed/repeated/composing events, and every modifier are ignored', () => {
  const body = fakeElement({ tag: 'body' });
  const document = fakeDocument({ activeElement: body });
  assert.equal(commandForGlobalArrowShortcut(keyEvent('Enter', body), { document }), null);
  for (const override of [
    { defaultPrevented: true },
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
  ]) {
    assert.equal(commandForGlobalArrowShortcut(keyEvent('ArrowRight', body, override), { document }), null);
  }
});

test('select, contenteditable, and composite ARIA controls retain arrow ownership', () => {
  const body = fakeElement({ tag: 'body' });
  const controls = [
    fakeElement({ tag: 'select', parent: body }),
    fakeElement({ attributes: { contenteditable: 'true' }, parent: body }),
    fakeElement({ attributes: { role: 'listbox' }, parent: body }),
    fakeElement({ attributes: { role: 'menu' }, parent: body }),
    fakeElement({ attributes: { role: 'tree' }, parent: body }),
    fakeElement({ attributes: { role: 'grid' }, parent: body }),
  ];
  for (const control of controls) {
    assert.equal(commandForGlobalArrowShortcut(keyEvent('ArrowLeft', control), {
      document: fakeDocument({ activeElement: control }),
    }), null, `${control.tagName}:${control.getAttribute('role') || ''}`);
  }
});
