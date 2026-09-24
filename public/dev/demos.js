// Mini-demo renderers for the Dev Center. Each renderer builds a tiny, decorative
// scene inside `host` and returns { play, pause, destroy }. Nothing animates until
// play() is called; dev.js only plays demos that are on screen, and never under
// prefers-reduced-motion (the static frame is meaningful on its own).

const icon = (id) => `<svg class="i" aria-hidden="true"><use href="#i-${id}"/></svg>`;

// Step machine: sets host.dataset.step and lets CSS do the motion.
function stepper(host, durations, onStep, still = durations.length - 1) {
  let i = 0;
  let timer = 0;
  let on = false;
  const show = (k) => {
    host.dataset.step = String(k);
    if (onStep) onStep(k);
  };
  const tick = () => {
    show(i);
    const wait = durations[i];
    i = (i + 1) % durations.length;
    timer = setTimeout(tick, wait);
  };
  show(still);
  return {
    play() {
      if (on) return;
      on = true;
      host.dataset.state = 'play';
      tick();
    },
    pause() {
      on = false;
      clearTimeout(timer);
      host.dataset.state = 'pause';
    },
    destroy() {
      this.pause();
    },
  };
}

// Canvas loop that only runs between play() and pause().
function canvasLoop(host, draw, init) {
  const cv = document.createElement('canvas');
  host.prepend(cv);
  const ctx = cv.getContext('2d');
  const st = { w: 0, h: 0, dpr: 1 };
  let raf = 0;
  let on = false;
  const size = () => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    st.dpr = Math.min(window.devicePixelRatio || 1, 2);
    st.w = r.width;
    st.h = r.height;
    cv.width = Math.round(r.width * st.dpr);
    cv.height = Math.round(r.height * st.dpr);
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    if (init) init(st, ctx);
    return true;
  };
  const frame = (t) => {
    draw(ctx, st, t);
    if (on) raf = requestAnimationFrame(frame);
  };
  const ro = new ResizeObserver(() => {
    if (size() && !on) draw(ctx, st, 2400);
  });
  ro.observe(host);
  return {
    play() {
      if (on) return;
      on = true;
      raf = requestAnimationFrame(frame);
    },
    pause() {
      on = false;
      cancelAnimationFrame(raf);
    },
    destroy() {
      this.pause();
      ro.disconnect();
    },
  };
}

const renderers = {
  visualizer(host) {
    host.innerHTML = '<span class="d-chip"><i></i>120 BPM · demo signal</span>';
    // Monochrome, like the Visualizer's stage: white bars whose brightness follows their length.
    const N = 64;
    const bars = new Float32Array(N).fill(0.3);
    return canvasLoop(host, (ctx, { w, h }, t) => {
      const phase = (t % 500) / 500;
      const beat = Math.exp(-phase * 5);
      const m = Math.min(w, h);
      const cx = w / 2;
      const cy = h / 2 - (h > 200 ? 6 : 0);
      const r0 = m * 0.2 * (1 + beat * 0.05);
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, ((Math.PI * 2 * r0) / N) * 0.4);
      for (let i = 0; i < N; i += 1) {
        const k = i < N / 2 ? i : N - i;
        const f = k / (N / 2);
        const target =
          0.18 +
          0.34 * Math.sin(f * 7 + t * 0.0021) ** 2 +
          0.22 * Math.sin(f * 13 - t * 0.0037) ** 2 +
          beat * 0.55 * (1 - f) ** 1.6;
        bars[i] += (target - bars[i]) * 0.22;
        const a = (i / N) * Math.PI * 2 - Math.PI / 2;
        const len = bars[i] * m * 0.28;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.9, 0.14 + bars[i] * 0.9).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(cx + cos * r0, cy + sin * r0);
        ctx.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r0 * 0.78, 0, Math.PI * 2);
      ctx.fillStyle = '#050506';
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.12 + beat * 0.26})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  },

  ryodev(host) {
    const machines = [
      ['Mac', 'Claude Code'],
      ['Dell', 'Codex'],
      ['HP', 'Claude Code'],
      ['Aero', 'Codex'],
    ];
    const label = { wait: 'Needs you', run: 'Running', done: 'Finished', stale: 'Stale · 14m' };
    const frames = [
      ['wait', 'run', 'done', 'stale'],
      ['run', 'run', 'wait', 'stale'],
      ['run', 'done', 'wait', 'run'],
      ['done', 'wait', 'run', 'run'],
    ];
    host.innerHTML = `<div class="rd-phone"><div class="rd-screen">
      <div class="rd-status"><span>9:41</span><span class="rd-island"></span><span>100%</span></div>
      <div class="rd-head"><b>RyoDev</b><span class="rd-need" data-need>1 needs you</span></div>
      <ul class="rd-list">${machines
        .map(([m, a]) => `<li class="rd-row"><i class="dot"></i><b>${m} <small>${a}</small></b><span></span></li>`)
        .join('')}</ul>
      <p class="rd-fresh">Synced 2s ago · 4 machines</p>
    </div></div>`;
    const rows = [...host.querySelectorAll('.rd-row')];
    const need = host.querySelector('[data-need]');
    return stepper(
      host,
      [2000, 2000, 2000, 2000],
      (k) => {
        const f = frames[k];
        rows.forEach((row, j) => {
          if (row.dataset.s === f[j]) return;
          row.dataset.s = f[j];
          row.lastElementChild.textContent = label[f[j]];
          row.classList.remove('flash');
          void row.offsetWidth;
          row.classList.add('flash');
        });
        const n = f.filter((s) => s === 'wait').length;
        need.textContent = `${n} needs you`;
      },
      0,
    );
  },

  mcb(host) {
    // White at the bottom. x = file (a=0), y = 8 - rank.
    const pieces = [
      ['K', 6, 7], ['R', 5, 7], ['P', 0, 6], ['P', 1, 6], ['P', 5, 6], ['P', 6, 6], ['P', 7, 6],
      ['N', 2, 5, 'mc-n'],
      ['K', 6, 0, 'b'], ['R', 5, 0, 'b'], ['Q', 3, 0, 'b'], ['P', 0, 1, 'b'], ['P', 5, 1, 'b'],
      ['P', 6, 1, 'b'], ['P', 7, 1, 'b'], ['P', 4, 2, 'b mc-e6'],
    ];
    host.innerHTML = `<div class="mc-wrap"><div class="mc-board">
      <span class="mc-sq mc-from" style="--x:2;--y:5"></span>
      <span class="mc-sq mc-to" style="--x:3;--y:3"></span>
      ${pieces.map(([p, x, y, c = '']) => `<span class="mc-pc ${c}" data-p="${p}" style="--x:${x};--y:${y}"></span>`).join('')}
      <span class="mc-sq mc-ring" style="--x:3;--y:3"></span>
      <svg class="mc-arrow" viewBox="0 0 8 8"><path d="M4.29 2.71 3.99 3.01"/><polygon points="3.78,3.22 4.10,3.12 3.88,2.90"/></svg>
      <span class="mc-lost">−3</span>
    </div>
    <div class="mc-side"><span class="mc-k">Blunder scan</span><span class="mc-move">Nd5<b>??</b></span><span class="mc-verdict">${icon('spark')}Hanging a piece</span></div></div>`;
    return stepper(host, [900, 1200, 1500, 1300, 2400], null, 2);
  },

  dns(host) {
    const rows = [
      ['Your resolver', '203.0.113.66'],
      ['DoH resolver A', '198.51.100.24'],
      ['DoH resolver B', '198.51.100.24'],
    ];
    host.innerHTML = `<div class="dn">
      <p class="dn-q"><span>A?</span><b>bank.example</b></p>
      ${rows
        .map(([n, a]) => `<div class="dn-r"><span class="dn-n">${n}</span><span class="dn-flag">mismatch</span><span class="dn-a"><b>${a}</b></span></div>`)
        .join('')}
    </div>
    <span class="d-verdict">${icon('spark')}Spoof detected</span>`;
    const els = [...host.querySelectorAll('.dn-r')];
    const verdict = host.querySelector('.d-verdict');
    const order = [1, 2, 0];
    return stepper(host, [900, 500, 500, 700, 2800], (k) => {
      els.forEach((el, j) => {
        el.classList.toggle('ok', k >= 1 + order.indexOf(j));
        el.classList.toggle('bad', k >= 4 && j === 0);
        el.classList.toggle('match', k >= 4 && j !== 0);
      });
      verdict.classList.toggle('on', k >= 4);
    });
  },

  riff(host) {
    const songs = [
      ['Neon Skyline', 97],
      ['Glass Harbor', 91],
      ['Static Bloom', 84],
      ['Paper Moons', 38],
    ];
    host.innerHTML = `<div class="rf">
      <p class="rf-h"><b>Spotify</b>${icon('arrow')}<strong>Clone Hero</strong></p>
      ${songs
        .map(([t, s]) => `<div class="rf-row${s < 60 ? ' low' : ''}" style="--s:${s}"><span class="rf-t">${t}</span><span class="rf-bar"><i></i></span><b class="rf-n">${s}</b></div>`)
        .join('')}
    </div>
    <span class="d-verdict">${icon('check')}Setlist ready</span>`;
    const rows = [...host.querySelectorAll('.rf-row')];
    const verdict = host.querySelector('.d-verdict');
    return stepper(host, [800, 450, 450, 450, 700, 2600], (k) => {
      rows.forEach((r, j) => r.classList.toggle('on', k > j));
      verdict.classList.toggle('on', k >= 5);
    });
  },

  ryomap(host) {
    const tree = [
      ['src/auth/', 'refresh.py', 1],
      ['src/auth/', 'session.py', 0],
      ['src/api/', 'routes.py', 0],
      ['tests/', 'test_refresh.py', 2],
      ['docs/', 'AUTH.md', 3],
    ];
    host.innerHTML = `<div class="rm">
      <p class="rm-q">query <b>"token refresh"</b></p>
      ${tree
        .map(([dir, n, r]) => `<div class="rm-f"${r ? ` data-r="${r}"` : ''}><span><i>${dir}</i>${n}</span>${r ? `<span class="fr">fresh</span><span class="rk">${r}</span>` : ''}</div>`)
        .join('')}
    </div>
    <span class="d-verdict">${icon('check')}Read these first</span>`;
    const hits = [...host.querySelectorAll('[data-r]')];
    const verdict = host.querySelector('.d-verdict');
    return stepper(host, [900, 600, 600, 700, 2600], (k) => {
      hits.forEach((h) => {
        h.classList.toggle('hit', k >= Number(h.dataset.r));
        h.classList.toggle('fresh', k >= 4);
      });
      verdict.classList.toggle('on', k >= 4);
    });
  },

  'agent-station'(host) {
    host.innerHTML = `<div class="as">
      <svg class="as-lines" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M16 34H84"/><path d="M50 34V70"/></svg>
      <div class="as-node" data-n="r" style="--x:16;--y:34"><i>R</i><span>Researcher</span></div>
      <div class="as-node" data-n="m" style="--x:50;--y:34"><i>M</i><span>Manager</span></div>
      <div class="as-node" data-n="c" style="--x:84;--y:34"><i>C</i><span>Critic</span></div>
      <span class="as-msg m1" style="--x:16;--y:18">new print idea</span>
      <span class="as-msg m2" style="--x:84;--y:18">check margins</span>
      <span class="as-msg m3" style="--x:50;--y:50">proposal</span>
      <div class="as-ok"><b>Awaiting approval</b><span>Approve</span><span>Hold</span></div>
    </div>`;
    const nodes = Object.fromEntries([...host.querySelectorAll('.as-node')].map((n) => [n.dataset.n, n]));
    const lit = [[], ['r'], ['c', 'm'], ['m'], []];
    return stepper(host, [700, 1200, 1200, 1000, 2600], (k) => {
      Object.entries(nodes).forEach(([key, n]) => n.classList.toggle('on', lit[k].includes(key)));
    });
  },

  sadhana(host) {
    host.innerHTML = `<div class="sd"><span class="sd-ring"></span><span class="sd-orb"></span>
      <span class="sd-lab"><span class="in">in</span><span class="out">out</span></span></div>
      <span class="d-chip"><i></i>4s in · ½s · 4s out · ½s</span>`;
    // Pure CSS timing (9s cycle); play/pause toggles animation-play-state.
    return {
      play() { host.dataset.state = 'play'; },
      pause() { host.dataset.state = 'pause'; },
      destroy() {},
    };
  },

  dreamfield(host) {
    // White dust at a few brightnesses (the real DreamField keeps its colours).
    const INK = [0.9, 0.62, 0.4, 0.26];
    let parts = [];
    return canvasLoop(
      host,
      (ctx, { w, h }, t) => {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';
        const cx = w / 2;
        const cy = h / 2;
        const m = Math.min(w, h);
        for (const p of parts) {
          const a = p.a + t * 0.00035 * p.s;
          const r = m * p.r * (1 + 0.06 * Math.sin(t * 0.0012 + p.a * 3));
          const x = cx + Math.cos(a) * r * 1.35;
          const y = cy + Math.sin(a) * r * 0.78;
          ctx.fillStyle = p.c;
          ctx.fillRect(x, y, p.z, p.z);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(255,255,255,0.018)';
        ctx.beginPath();
        ctx.arc(cx, cy, m * 0.07, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1.5, m * 0.012), 0, Math.PI * 2);
        ctx.fill();
      },
      () => {
        parts = Array.from({ length: 110 }, (_, i) => {
          const a = INK[i % INK.length];
          return {
            a: Math.random() * Math.PI * 2,
            r: 0.08 + Math.random() ** 0.8 * 0.4,
            s: (0.6 + Math.random()) * (Math.random() < 0.85 ? 1 : -1),
            z: Math.random() < 0.2 ? 2 : 1.3,
            c: `rgba(255,255,255,${a})`,
          };
        });
      },
    );
  },

  spamshredder(host) {
    const senders = [
      ['deals@shop.example', 92],
      ['news@brand.example', 68],
      ['promo@app.example', 47],
      ['hello@store.example', 28],
    ];
    host.innerHTML = `<div class="ss">
      <p class="ss-h">Loudest senders <span class="ss-btn">Shred</span></p>
      ${senders.map(([s, w]) => `<div class="ss-row" style="--w:${w}"><span>${s}</span><span class="ss-b"><i></i></span></div>`).join('')}
      <span class="ss-done">1 sender shredded</span>
    </div>`;
    return stepper(host, [1100, 900, 700, 2400], null, 3);
  },

  sts(host) {
    const cards = [
      ['Bash', 'atk', 2, -5.2, -9],
      ['Strike', 'atk', 1, -1.8, -3],
      ['Strike', 'atk', 1, 1.8, 3],
      ['Defend', 'skl', 1, 5.2, 9],
    ];
    host.innerHTML = `<div class="st">
      <div class="st-energy">3</div>
      <p class="st-rule">rule: <b data-rule>lethal check</b></p>
      <div class="st-enemy"><span class="st-blob"></span><span class="st-hp"><i></i></span><span class="st-tag" data-tag>Intent: attack</span></div>
      <div class="st-hand">${cards
        .map(([n, c, cost, tx, r]) => `<div class="st-card ${c}" style="--tx:${tx}em;--r:${r}deg"><span class="cost">${cost}</span><span>${n}<br><small>${c === 'atk' ? 'attack' : 'skill'}</small></span></div>`)
        .join('')}</div>
    </div>`;
    const els = [...host.querySelectorAll('.st-card')];
    const blob = host.querySelector('.st-blob');
    const hp = host.querySelector('.st-hp i');
    const rule = host.querySelector('[data-rule]');
    const tag = host.querySelector('[data-tag]');
    const energy = host.querySelector('.st-energy');
    // [lifted card, flown cards, hp %, rule text, energy, tag]
    const frames = [
      [-1, [], 100, 'lethal check', 3, 'Intent: attack'],
      [0, [], 100, 'vulnerable first', 3, 'Intent: attack'],
      [-1, [0], 78, 'vulnerable first', 1, 'Vulnerable'],
      [1, [0], 78, 'spend on damage', 1, 'Vulnerable'],
      [-1, [0, 1], 52, 'spend on damage', 0, 'Vulnerable'],
      [-1, [0, 1], 52, 'out of energy', 0, 'End turn'],
    ];
    return stepper(host, [900, 800, 900, 800, 900, 1800], (k) => {
      const [lift, flown, pct, text, en, t] = frames[k];
      els.forEach((el, j) => {
        el.classList.toggle('lift', j === lift);
        el.classList.toggle('fly', flown.includes(j));
      });
      if (hp.style.getPropertyValue('--hp') !== `${pct}%` && pct < 100) {
        blob.classList.remove('hit');
        void blob.offsetWidth;
        blob.classList.add('hit');
      }
      hp.style.setProperty('--hp', `${pct}%`);
      rule.textContent = text;
      tag.textContent = t;
      energy.textContent = String(en);
    }, 1);
  },

  kensa(host) {
    host.innerHTML = `<div class="ks">
      <p class="ks-h"><b>PR</b><span>agent/retry-fetch · written by an agent</span></p>
      <div class="ks-code">
        <span class="ks-l">  def fetch(url):</span>
        <span class="ks-l del">-     return get(url)</span>
        <span class="ks-l add">+     for _ in range(3):</span>
        <span class="ks-l add">+         try: return get(url)</span>
        <span class="ks-l add">+         except: pass</span>
      </div>
      <p class="ks-c"><b>K</b>Bare except hides the real error.</p>
      <p class="ks-c"><b>K</b>No test covers the retry path.</p>
    </div>
    <span class="d-verdict">${icon('spark')}Changes requested</span>`;
    const cs = [...host.querySelectorAll('.ks-c')];
    const verdict = host.querySelector('.d-verdict');
    return stepper(host, [1000, 1100, 1000, 2600], (k) => {
      cs.forEach((c, j) => c.classList.toggle('on', k > j));
      verdict.classList.toggle('on', k >= 3);
    });
  },
};

// `host` becomes the size container; the renderer draws into an inner stage so
// the stage's own font-size can scale with the container (cqi/cqh).
export function mountDemo(host, project) {
  host.classList.add('demo');
  host.dataset.accent = project.accent;
  const stage = document.createElement('div');
  stage.className = `demo-stage d-${project.demo}`;
  host.replaceChildren(stage);
  const make = renderers[project.demo];
  if (!make) return { play() {}, pause() {}, destroy() {} };
  return make(stage);
}
