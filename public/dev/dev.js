// Dev Center — vanilla ES module, no dependencies, no network.
import { projects, filters, heroStats, nowBuilding, buildLog, profile } from './projects.js';
import { mountDemo } from './demos.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (id) => `<svg class="i" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const pad = (n) => String(n).padStart(2, '0');
const isExternal = (href) => {
  try {
    return new URL(href, location.href).origin !== location.origin;
  } catch {
    return false;
  }
};

const byId = new Map(projects.map((p) => [p.id, p]));
const TOTAL = projects.length;
const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = reducedMQ.matches;
const EASE = 'cubic-bezier(.22,.8,.22,1)';

/* ---------- Local progress (optional; page works without storage) ---------- */
const KEY = 'ryo-dev-center:v1';
const saved = (() => {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && Array.isArray(d.seen)) return { seen: d.seen.filter((id) => byId.has(id)), last: byId.has(d.last) ? d.last : null };
  } catch {
    /* storage unavailable or corrupt */
  }
  return { seen: [], last: null };
})();
const seen = new Set(saved.seen);
let lastId = saved.last;
const returningTo = lastId;
const persist = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ seen: [...seen], last: lastId }));
  } catch {
    /* private mode, blocked storage: progress just won't stick */
  }
};

/* ---------- Scroll lock shared by dialogs ---------- */
let locks = 0;
const lock = () => {
  locks += 1;
  document.documentElement.classList.add('is-locked');
};
const unlock = () => {
  locks = Math.max(0, locks - 1);
  if (!locks) document.documentElement.classList.remove('is-locked');
};

/* ---------- Static bits ---------- */
$$('[data-total]').forEach((el) => {
  el.textContent = String(TOTAL);
});
const isApple = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
$$('[data-kbd]').forEach((el) => {
  el.textContent = isApple ? '⌘K' : 'Ctrl K';
});

$('[data-stats]').innerHTML = heroStats
  .map((s) => `<div><dt>${esc(s.label)}</dt><dd data-count="${esc(s.value)}">${esc(s.value)}</dd></div>`)
  .join('');

$('[data-ticker-items]').innerHTML = nowBuilding
  .map((n, i) => `${i ? '<span class="sep" aria-hidden="true">·</span>' : ''}<button type="button" data-open="${esc(n.id)}" aria-haspopup="dialog">${esc(n.label)}</button>`)
  .join('');

/* ---------- Filters ---------- */
let activeFilter = 'all';
const filterBar = $('[data-filters]');
filterBar.innerHTML = filters
  .map((f) => {
    const n = projects.filter(f.match).length;
    return `<button type="button" class="chip" data-filter="${f.id}" aria-pressed="${f.id === activeFilter}" aria-label="${esc(f.label)}, ${n} project${n === 1 ? '' : 's'}">${esc(f.label)}<span class="n" aria-hidden="true">${n}</span></button>`;
  })
  .join('');

/* ---------- Bento grid ---------- */
const grid = $('[data-grid]');
grid.innerHTML = projects
  .map((p) => {
    const tags = p.tags.slice(0, 4).map((t) => `<li>${esc(t)}</li>`).join('');
    return `<article class="card card--${p.size || 'std'} reveal" data-id="${p.id}" data-accent="${p.accent}">
      <div class="card-demo"><div class="demo-host" aria-hidden="true"></div><span class="card-seen" hidden>${icon('check')}Explored</span></div>
      <div class="card-body">
        <div class="card-meta">
          <span class="pill" data-status="${esc(p.status)}">${esc(p.status)}</span>
          <span class="card-go" aria-hidden="true">${icon('arrow')}</span>
        </div>
        <h3 class="card-title"><button type="button" class="card-link" data-open="${p.id}" aria-haspopup="dialog" aria-describedby="tl-${p.id}">${esc(p.name)}</button></h3>
        <p class="card-tagline" id="tl-${p.id}">${esc(p.tagline)}</p>
        <ul class="tags" aria-label="Stack">${tags}</ul>
      </div>
    </article>`;
  })
  .join('');
const cards = $$('.card', grid);
const cardById = new Map(cards.map((c) => [c.dataset.id, c]));

/* Mini-demos: play only while on screen, never under reduced motion. */
const demos = new Map();
const onScreen = new Set();
let gridHold = false;
const syncDemo = (host) => {
  const c = demos.get(host);
  if (!c) return;
  if (onScreen.has(host) && !reduced && !gridHold && !document.hidden) c.play();
  else c.pause();
};
const demoIO = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) onScreen.add(e.target);
      else onScreen.delete(e.target);
      syncDemo(e.target);
    });
  },
  { rootMargin: '60px 0px' },
);
cards.forEach((card) => {
  const host = $('.demo-host', card);
  demos.set(host, mountDemo(host, byId.get(card.dataset.id)));
  demoIO.observe(host);
});
const syncAllDemos = () => demos.forEach((_, host) => syncDemo(host));

/* Reveal on scroll, staggered per batch. */
const revealIO = new IntersectionObserver(
  (entries) => {
    entries
      .filter((e) => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left)
      .forEach((e, i) => {
        const el = e.target;
        revealIO.unobserve(el);
        el.style.setProperty('--i', String(i));
        el.classList.add('is-in');
        const settle = (ev) => {
          if (ev.target !== el || ev.propertyName !== 'opacity') return;
          el.removeEventListener('transitionend', settle);
          el.classList.remove('reveal', 'is-in');
          el.style.removeProperty('--i');
        };
        el.addEventListener('transitionend', settle);
      });
  },
  { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
);
const observeReveal = (root = document) => {
  $$('.reveal', root).forEach((el) => {
    if (reduced) el.classList.remove('reveal');
    else revealIO.observe(el);
  });
};

/* Filter with FLIP re-layout. */
const filterStatus = $('[data-filter-status]');
function applyFilter(id) {
  const f = filters.find((x) => x.id === id) || filters[0];
  activeFilter = f.id;
  $$('.chip', filterBar).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f.id)));
  const before = new Map(cards.filter((c) => !c.hidden).map((c) => [c, c.getBoundingClientRect()]));
  let shown = 0;
  cards.forEach((c) => {
    const keep = f.match(byId.get(c.dataset.id));
    c.hidden = !keep;
    if (keep) shown += 1;
  });
  filterStatus.textContent = `Showing ${shown} of ${TOTAL} projects${f.id === 'all' ? '' : `: ${f.label}`}.`;
  if (reduced) return;
  cards.forEach((c) => {
    if (c.hidden) return;
    c.classList.remove('reveal', 'is-in');
    const a = before.get(c);
    const b = c.getBoundingClientRect();
    if (!a) {
      c.animate([{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE });
      return;
    }
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 280, easing: EASE });
    }
  });
}
filterBar.addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (b && b.dataset.filter !== activeFilter) applyFilter(b.dataset.filter);
});

/* ---------- Build log ---------- */
$('[data-log]').innerHTML = buildLog
  .map(
    (m) => `<li class="log-month reveal"><h3>${esc(m.month)}</h3><ul>${m.items
      .map((it) => {
        const p = byId.get(it.id);
        if (!p) return '';
        return `<li><button type="button" class="log-item" data-open="${p.id}" data-accent="${p.accent}" aria-haspopup="dialog"><span class="sw" aria-hidden="true"></span><span class="txt"><b>${esc(p.name)}</b>${it.text ? `<span class="note">${esc(it.text)}</span>` : ''}</span>${icon('arrow')}</button></li>`;
      })
      .join('')}</ul></li>`,
  )
  .join('');
$('#log').setAttribute('tabindex', '-1');

/* ---------- Progress ---------- */
const progressLink = $('[data-progress-link]');
const finale = $('[data-finale]');
const toast = $('[data-toast]');
let toastTimer = 0;
function showToast(html) {
  toast.innerHTML = html;
  toast.classList.remove('is-on');
  void toast.offsetWidth;
  toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-on'), 3600);
}

function nextProject(fromId) {
  const i = projects.findIndex((p) => p.id === fromId);
  for (let k = 1; k <= TOTAL; k += 1) {
    const p = projects[(i + k + TOTAL) % TOTAL];
    if (!seen.has(p.id) && p.id !== fromId) return p;
  }
  return projects[(i + 1 + TOTAL) % TOTAL];
}

function renderProgress() {
  const n = seen.size;
  const off = String(100 - (n / TOTAL) * 100);
  $$('.ring-fill').forEach((r) => {
    r.style.setProperty('--off', off);
    r.style.opacity = n ? '1' : '0';
  });
  $$('[data-seen-count]').forEach((el) => {
    el.textContent = String(n);
  });
  progressLink.setAttribute('aria-label', `Explored ${n} of ${TOTAL} projects`);
  progressLink.classList.toggle('is-done', n === TOTAL);
  cards.forEach((c) => {
    $('.card-seen', c).hidden = !seen.has(c.dataset.id);
  });

  const done = n === TOTAL;
  finale.classList.toggle('is-done', done);
  const title = $('[data-finale-title]');
  const text = $('[data-finale-text]');
  const actions = $('[data-finale-actions]');
  if (done) {
    title.innerHTML = 'You’ve seen <em>everything</em>.';
    text.textContent = `All ${TOTAL} builds, explored. Thanks for looking around. The code lives on GitHub, and new things land here first.`;
    actions.innerHTML = `<a class="btn btn-primary" href="${esc(profile.github)}" rel="noopener">${icon('gh')}Follow along on GitHub</a>
      <a class="btn btn-ghost" href="${esc(profile.home)}">Back to ryo-nd.com ${icon('arrow')}</a>
      <button type="button" class="text-btn" data-reset>Start over</button>`;
  } else {
    const nx = nextProject(lastId);
    title.innerHTML = n ? 'Keep <em>exploring</em>' : 'Start <em>exploring</em>';
    text.textContent = n
      ? `${TOTAL - n} to go. Next up: ${nx.name}. ${nx.tagline}`
      : 'Open a project to mark it explored. Progress stays on this device only: no accounts, no cookies.';
    actions.innerHTML = `<button type="button" class="btn btn-primary" data-open="${nx.id}" aria-haspopup="dialog">${n ? 'Open' : 'Start with'} ${esc(nx.name)} ${icon('arrow')}</button>${
      n ? '<button type="button" class="text-btn" data-reset>Reset progress</button>' : ''
    }`;
  }
}

function markSeen(id) {
  lastId = id;
  const fresh = !seen.has(id);
  seen.add(id);
  persist();
  if (!fresh) return;
  renderProgress();
  if (!reduced) {
    progressLink.classList.remove('is-bump');
    void progressLink.offsetWidth;
    progressLink.classList.add('is-bump');
  }
  if (seen.size === TOTAL) showToast(`${icon('spark')}You’ve seen everything. Nice.`);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-reset]')) return;
  seen.clear();
  lastId = null;
  persist();
  renderProgress();
  showToast('Progress reset. Fresh eyes.');
});

/* Continue where you left off */
const continueBtn = $('[data-continue]');
if (returningTo && byId.has(returningTo)) {
  const p = byId.get(returningTo);
  continueBtn.innerHTML = `<span class="dot" aria-hidden="true">${icon('play')}</span><span>Continue: <b>${esc(p.name)}</b></span>`;
  continueBtn.dataset.open = p.id;
  continueBtn.setAttribute('aria-haspopup', 'dialog');
  continueBtn.hidden = false;
}

/* ---------- Dialog helpers ---------- */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
function trapTab(dlg, e) {
  if (e.key !== 'Tab') return;
  const f = $$(FOCUSABLE, dlg).filter((el) => el.getClientRects().length);
  if (!f.length) return;
  const first = f[0];
  const last = f[f.length - 1];
  const a = document.activeElement;
  if (e.shiftKey && (a === first || !dlg.contains(a))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (a === last || !dlg.contains(a))) {
    e.preventDefault();
    first.focus();
  }
}
function animateClose(dlg) {
  if (!dlg.open || dlg.hasAttribute('data-closing')) return;
  if (reduced) {
    dlg.close();
    return;
  }
  dlg.setAttribute('data-closing', '');
  setTimeout(() => {
    dlg.removeAttribute('data-closing');
    if (dlg.open) dlg.close();
  }, 210);
}
const refocus = (el) => {
  if (el && el.isConnected && el.getClientRects().length) el.focus({ preventScroll: true });
};

/* ---------- Project sheet ---------- */
const sheet = $('[data-sheet]');
const panel = $('.sheet-panel', sheet);
const sheetScroll = $('[data-sheet-scroll]');
const sheetTitle = $('[data-sheet-title]');
const sheetDemoWrap = $('[data-sheet-demo]');
let sheetDemo = null;
let current = null;
let sheetReturn = null;
let sheetEntry = false;
let closingViaHistory = false;
let ignorePop = false;

const hashId = () => {
  const m = /(?:^#|&)p=([\w-]+)/.exec(location.hash);
  return m ? m[1] : null;
};
const cleanUrl = () => location.pathname + location.search;

function fillSheet(p) {
  const idx = projects.indexOf(p);
  sheet.dataset.accent = p.accent;
  $('[data-sheet-count]').textContent = `Project ${pad(idx + 1)} / ${pad(TOTAL)}`;
  $('[data-sheet-meta]').innerHTML = `<span class="pill" data-status="${esc(p.status)}">${esc(p.status)}</span><span class="year">${esc(p.year)}</span>`;
  sheetTitle.textContent = p.name;
  $('[data-sheet-tagline]').textContent = p.tagline;
  $('[data-sheet-blurb]').textContent = p.blurb;
  $('[data-sheet-facts]').innerHTML = p.facts.map((f) => `<li>${icon('check')}<span>${esc(f)}</span></li>`).join('');
  $('[data-sheet-tags]').innerHTML = p.tags.map((t) => `<li>${esc(t)}</li>`).join('');
  $('[data-sheet-links]').innerHTML = p.links.length
    ? p.links
        .map((l, i) => {
          const ext = isExternal(l.href);
          return `<a class="btn ${i ? 'btn-ghost' : 'btn-primary'}" href="${esc(l.href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)}${icon(ext ? 'out' : 'arrow')}${ext ? '<span class="sr-only"> (opens in a new tab)</span>' : ''}</a>`;
        })
        .join('')
    : `<p class="sheet-private">${icon('lock')}${p.status === 'Private' ? 'Private for now, so there is no public link yet.' : 'No public link yet.'}</p>`;

  const willSee = new Set(seen).add(p.id);
  const n = willSee.size;
  let nx = null;
  for (let k = 1; k <= TOTAL; k += 1) {
    const q = projects[(idx + k) % TOTAL];
    if (!willSee.has(q.id)) {
      nx = q;
      break;
    }
  }
  const allDone = !nx;
  if (!nx) nx = projects[(idx + 1) % TOTAL];
  $('[data-sheet-next]').innerHTML = `<div class="sheet-progress"><span>Explored ${n}/${TOTAL}</span><span class="bar"><i style="--p:${(n / TOTAL) * 100}%"></i></span>${
    allDone ? '<span>All seen</span>' : ''
  }</div>
    <button type="button" class="next-btn" data-next="${nx.id}"><span class="t"><span class="k">${allDone ? 'Next project' : 'Up next'}</span><b>${esc(nx.name)}</b></span><span class="go">${icon('arrow')}</span></button>`;

  sheetDemo?.destroy();
  const host = document.createElement('div');
  sheetDemoWrap.replaceChildren(host);
  sheetDemo = mountDemo(host, p);
  if (!reduced) sheetDemo.play();
}

function openSheet(id, { fromHash = false, returnTo = null } = {}) {
  const p = byId.get(id);
  if (!p) return;
  if (palette.open) palette.close();
  const wasOpen = sheet.open;
  current = id;
  fillSheet(p);
  if (!wasOpen) {
    sheetReturn = returnTo || (document.activeElement !== document.body ? document.activeElement : null);
    sheet.showModal();
    lock();
    gridHold = true;
    syncAllDemos();
  }
  sheetScroll.scrollTop = 0;
  sheetTitle.focus({ preventScroll: true });
  const h = `#p=${id}`;
  if (!fromHash && location.hash !== h) {
    if (!wasOpen) {
      history.pushState({ devSheet: id }, '', h);
      sheetEntry = true;
    } else {
      history.replaceState(history.state, '', h);
    }
  }
  markSeen(id);
}

sheet.addEventListener('close', () => {
  sheetDemo?.destroy();
  sheetDemo = null;
  unlock();
  gridHold = false;
  syncAllDemos();
  if (!closingViaHistory) {
    if (sheetEntry) {
      ignorePop = true;
      history.back();
    } else if (hashId()) {
      history.replaceState(null, '', cleanUrl());
    }
  }
  sheetEntry = false;
  closingViaHistory = false;
  const back = sheetReturn || cardById.get(current)?.querySelector('.card-link');
  current = null;
  refocus(back);
  renderProgress();
});
sheet.addEventListener('cancel', (e) => {
  e.preventDefault();
  animateClose(sheet);
});
sheet.addEventListener('click', (e) => {
  if (e.target === sheet) animateClose(sheet);
  if (e.target.closest('[data-sheet-close]')) animateClose(sheet);
  const nx = e.target.closest('[data-next]');
  if (nx) openSheet(nx.dataset.next);
});
sheet.addEventListener('keydown', (e) => trapTab(sheet, e));

function syncFromHash() {
  const id = hashId();
  if (id && byId.has(id)) {
    if (current !== id) openSheet(id, { fromHash: true, returnTo: cardById.get(id)?.querySelector('.card-link') });
  } else if (sheet.open) {
    closingViaHistory = true;
    animateClose(sheet);
  }
}
window.addEventListener('popstate', () => {
  if (ignorePop) {
    ignorePop = false;
    return;
  }
  syncFromHash();
});
window.addEventListener('hashchange', syncFromHash);

/* Drag the sheet down to dismiss (touch + mouse on the grab area). */
(() => {
  let y0 = 0;
  let t0 = 0;
  let dy = 0;
  let dragging = false;
  const start = (e) => {
    if (e.target.closest('button') || matchMedia('(min-width: 900px)').matches) return;
    dragging = true;
    y0 = e.clientY;
    t0 = performance.now();
    dy = 0;
    panel.style.transition = 'none';
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - y0);
    panel.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const v = dy / Math.max(1, performance.now() - t0);
    panel.style.transition = `transform 220ms ${EASE}`;
    if (dy > 110 || (v > 0.6 && dy > 24)) {
      panel.style.transform = 'translateY(100%)';
      setTimeout(() => {
        sheet.close();
        panel.style.transform = '';
        panel.style.transition = '';
      }, 200);
    } else {
      panel.style.transform = '';
    }
  };
  $$('[data-sheet-grab], .sheet-top', sheet).forEach((el) => {
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  });
})();

/* ---------- Command palette ---------- */
const palette = $('[data-palette]');
const pInput = $('[data-palette-input]');
const pList = $('[data-palette-list]');
const pEmpty = $('[data-palette-empty]');
let paletteReturn = null;
let results = [];
let active = 0;

const entries = [
  ...projects.map((p) => ({
    kind: 'project',
    id: p.id,
    name: p.name,
    sub: p.tagline,
    hay: [p.name, p.tagline, p.status, ...p.tags].join(' ').toLowerCase(),
    p,
  })),
  { kind: 'jump', id: 'log', name: 'Build log', sub: 'What moved recently, month by month', hay: 'build log timeline recent', target: '#log', ico: 'arrow' },
  { kind: 'jump', id: 'progress', name: 'Your progress', sub: 'See what you have explored', hay: 'progress explored seen', target: '#progress', ico: 'check' },
  { kind: 'link', id: 'github', name: 'GitHub', sub: 'github.com/rdilaz', hay: 'github code source profile', href: profile.github, ico: 'gh' },
];

function fuzzy(q, s) {
  const i = s.indexOf(q);
  if (i >= 0) {
    const hits = Array.from({ length: q.length }, (_, k) => i + k);
    return { score: 60 + q.length * 4 - i + (i === 0 || s[i - 1] === ' ' ? 25 : 0), hits };
  }
  if (q.length < 3) return null;
  const hits = [];
  let from = 0;
  let score = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const f = s.indexOf(ch, from);
    if (f < 0) return null;
    score += f === prev + 1 ? 5 : 1;
    if (f === 0 || s[f - 1] === ' ') score += 4;
    hits.push(f);
    prev = f;
    from = f + 1;
  }
  return { score, hits };
}

function search(raw) {
  const q = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return entries.map((it) => ({ it, hits: [] }));
  const terms = q.split(' ');
  return entries
    .map((it) => {
      const nm = fuzzy(q, it.name.toLowerCase());
      const all = terms.every((t) => ` ${it.hay}`.includes(` ${t}`) || (t.length > 3 && it.hay.includes(t)));
      if (!nm && !all) return null;
      return { it, hits: nm ? nm.hits : [], score: (nm ? nm.score * 2 : 0) + (all ? 30 : 0) + (it.kind === 'project' ? 3 : 0) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

const mark = (name, hits) => {
  if (!hits.length) return esc(name);
  const set = new Set(hits);
  return [...name].map((ch, i) => (set.has(i) ? `<mark>${esc(ch)}</mark>` : esc(ch))).join('');
};

function renderPalette() {
  results = search(pInput.value);
  active = Math.min(active, Math.max(0, results.length - 1));
  const opt = ({ it, hits }, i) => {
    const seenMark = it.kind === 'project' && seen.has(it.id) ? `${icon('check')}<span class="sr-only">(explored)</span>` : '';
    const ico = it.kind === 'project' ? esc(it.name[0]) : icon(it.ico);
    const pill = it.kind === 'project' ? `<span class="pill" data-status="${esc(it.p.status)}">${esc(it.p.status)}</span>` : '';
    return `<div role="option" class="palette-opt" id="opt-${it.id}" data-i="${i}" aria-selected="${i === active}">
      <span class="palette-ico" aria-hidden="true">${ico}</span>
      <span class="palette-txt"><span class="palette-name"><span>${mark(it.name, hits)}</span>${seenMark}</span><span class="palette-sub">${esc(it.sub)}</span></span>${pill}</div>`;
  };
  const q = pInput.value.trim();
  if (!results.length) {
    pList.innerHTML = '';
    pEmpty.hidden = false;
    pEmpty.textContent = `Nothing matches “${q}”. Try “chess”, “security” or “AI”.`;
    pInput.removeAttribute('aria-activedescendant');
    return;
  }
  pEmpty.hidden = true;
  if (!q) {
    const proj = results.filter((r) => r.it.kind === 'project');
    const rest = results.filter((r) => r.it.kind !== 'project');
    results = [...proj, ...rest];
    pList.innerHTML = `<li role="group" aria-label="Projects"><span class="palette-group" aria-hidden="true">Projects</span>${proj
      .map((r, i) => opt(r, i))
      .join('')}</li><li role="group" aria-label="Jump to"><span class="palette-group" aria-hidden="true">Jump to</span>${rest
      .map((r, i) => opt(r, i + proj.length))
      .join('')}</li>`;
  } else {
    pList.innerHTML = `<li role="group" aria-label="Results">${results.map(opt).join('')}</li>`;
  }
  setActive(active, false);
}

function setActive(i, scroll = true) {
  if (!results.length) return;
  active = (i + results.length) % results.length;
  $$('[role="option"]', pList).forEach((o) => o.setAttribute('aria-selected', String(Number(o.dataset.i) === active)));
  const el = $(`[data-i="${active}"]`, pList);
  if (el) {
    pInput.setAttribute('aria-activedescendant', el.id);
    if (scroll) el.scrollIntoView({ block: 'nearest' });
  }
}

function choose(i) {
  const r = results[i];
  if (!r) return;
  const { it } = r;
  const back = paletteReturn;
  if (it.kind === 'project') {
    palette.close();
    openSheet(it.id, { returnTo: back });
  } else if (it.kind === 'jump') {
    palette.close();
    const t = $(it.target);
    t.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    t.focus({ preventScroll: true });
  } else if (it.href) {
    palette.close();
    location.assign(it.href);
  }
}

function openPalette() {
  if (palette.open) return;
  paletteReturn = document.activeElement !== document.body ? document.activeElement : null;
  pInput.value = '';
  active = 0;
  renderPalette();
  palette.showModal();
  lock();
  pInput.focus();
  pList.scrollTop = 0;
}

palette.addEventListener('close', () => {
  unlock();
  if (!sheet.open) refocus(paletteReturn);
});
palette.addEventListener('cancel', (e) => {
  e.preventDefault();
  animateClose(palette);
});
palette.addEventListener('click', (e) => {
  if (e.target === palette || e.target.closest('[data-palette-close]')) {
    animateClose(palette);
    return;
  }
  const o = e.target.closest('[role="option"]');
  if (o) choose(Number(o.dataset.i));
});
pList.addEventListener('pointermove', (e) => {
  const o = e.target.closest('[role="option"]');
  if (o && Number(o.dataset.i) !== active) setActive(Number(o.dataset.i), false);
});
pInput.addEventListener('input', () => {
  active = 0;
  renderPalette();
  pList.scrollTop = 0;
});
palette.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setActive(active + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setActive(active - 1);
  } else if (e.key === 'Enter' && e.target === pInput) {
    e.preventDefault();
    choose(active);
  } else {
    trapTab(palette, e);
  }
});

/* ---------- Global wiring ---------- */
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-palette]')) {
    openPalette();
    return;
  }
  const o = e.target.closest('[data-open]');
  if (o && !palette.contains(o) && !sheet.contains(o)) openSheet(o.dataset.open, { returnTo: o });
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (palette.open) animateClose(palette);
    else openPalette();
    return;
  }
  const t = e.target;
  const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if (e.key === '/' && !typing && !palette.open && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    openPalette();
  }
});

const topbar = $('.topbar');
const onScroll = () => topbar.classList.toggle('is-stuck', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* Count-up for hero stats. */
function countUp() {
  if (reduced) return;
  $$('[data-count]').forEach((el) => {
    const target = el.dataset.count;
    const num = Number(target.replace(/[^\d]/g, ''));
    if (!num) return;
    const suffix = target.replace(/[\d,]/g, '');
    const fmt = (v) => (target.includes(',') ? v.toLocaleString('en-US') : String(v)) + suffix;
    const t0 = performance.now() + 200;
    const dur = 900;
    const step = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / dur));
      el.textContent = fmt(Math.round(num * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(step);
      else el.textContent = target;
    };
    el.textContent = fmt(0);
    requestAnimationFrame(step);
  });
}

/* ---------- Hero flow field (monochrome: white at three depths) ---------- */
const hero = (() => {
  const host = $('.hero');
  const cv = $('.hero-canvas');
  const ctx = cv.getContext('2d');
  const inks = ['rgba(255,255,255,0.4)', 'rgba(255,255,255,0.22)', 'rgba(255,255,255,0.11)'];
  let w = 0;
  let h = 0;
  let parts = [];
  let raf = 0;
  let running = false;
  let inView = true;
  let last = 0;
  let t = 0;
  const ptr = { x: -1e4, y: -1e4, kick: 0 };

  const spawn = (p) => {
    p.x = Math.random() * w;
    p.y = Math.random() * h;
    p.age = 0;
    p.max = 90 + Math.random() * 220;
    const r = Math.random();
    p.c = r < 0.22 ? 0 : r < 0.58 ? 1 : 2;
    p.sp = 0.35 + Math.random() * 0.7;
    return p;
  };
  const resize = () => {
    const r = host.getBoundingClientRect();
    const nw = Math.round(r.width);
    const nh = Math.round(r.height);
    if (!nw || !nh || (nw === w && nh === h)) return;
    const widthChanged = nw !== w;
    w = nw;
    h = nh;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (widthChanged || !parts.length) {
      const n = Math.round(Math.min(380, Math.max(130, (w * h) / 3200)));
      parts = Array.from({ length: n }, () => spawn({}));
    }
  };
  const frame = (now) => {
    const dt = Math.min(2.5, (now - last) / 16.67 || 1);
    last = now;
    t += dt;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.2, 0.036 * dt)})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1;
    const R = Math.min(240, Math.max(120, w * 0.3));
    const R2 = R * R;
    for (let c = 0; c < 3; c += 1) {
      ctx.strokeStyle = inks[c];
      ctx.beginPath();
      for (const p of parts) {
        if (p.c !== c) continue;
        const ox = p.x;
        const oy = p.y;
        const a =
          (Math.sin(p.x * 0.0046 + t * 0.0036) + Math.cos(p.y * 0.0054 - t * 0.0027) + Math.sin((p.x - p.y) * 0.0021 + t * 0.0015)) * 1.45;
        let vx = Math.cos(a) * p.sp;
        let vy = Math.sin(a) * p.sp;
        const dx = p.x - ptr.x;
        const dy = p.y - ptr.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 1;
          const f = 1 - d / R;
          const push = 0.5 + ptr.kick * 5;
          vx += ((-dy / d) * 2.6 + (dx / d) * push) * f;
          vy += ((dx / d) * 2.6 + (dy / d) * push) * f;
        }
        p.x += vx * dt;
        p.y += vy * dt;
        p.age += dt;
        if (p.age > p.max || p.x < -8 || p.x > w + 8 || p.y < -8 || p.y > h + 8) {
          spawn(p);
          continue;
        }
        ctx.moveTo(ox, oy);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ptr.kick *= 0.93;
    if (running) raf = requestAnimationFrame(frame);
  };
  const sync = () => {
    const should = inView && !document.hidden && !reduced;
    if (should && !running) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!should && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
    if (reduced) ctx.clearRect(0, 0, w, h);
  };
  new ResizeObserver(() => resize()).observe(host);
  new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    sync();
  }).observe(host);
  const setPtr = (e) => {
    const r = host.getBoundingClientRect();
    ptr.x = e.clientX - r.left;
    ptr.y = e.clientY - r.top;
  };
  host.addEventListener('pointermove', setPtr, { passive: true });
  host.addEventListener('pointerdown', (e) => {
    setPtr(e);
    ptr.kick = 1;
  }, { passive: true });
  host.addEventListener('pointerleave', () => {
    ptr.x = -1e4;
    ptr.y = -1e4;
  });
  resize();
  return { sync };
})();

document.addEventListener('visibilitychange', () => {
  hero.sync();
  syncAllDemos();
});
reducedMQ.addEventListener('change', (e) => {
  reduced = e.matches;
  hero.sync();
  syncAllDemos();
  if (sheetDemo) {
    if (reduced) sheetDemo.pause();
    else sheetDemo.play();
  }
  if (reduced) $$('.reveal').forEach((el) => el.classList.remove('reveal', 'is-in'));
});

/* ---------- Boot ---------- */
renderProgress();
observeReveal();
hero.sync();
countUp();
filterStatus.textContent = `Showing all ${TOTAL} projects.`;
const deep = hashId();
if (deep && byId.has(deep)) {
  openSheet(deep, { fromHash: true, returnTo: cardById.get(deep)?.querySelector('.card-link') });
} else if (deep) {
  history.replaceState(null, '', cleanUrl());
}
