import { useEffect, useRef, useState } from 'react';
import DreamField from '../components/DreamField';
import './Home.css';

const GITHUB = 'https://github.com/rdilaz';

const SELECTED = [
  {
    id: 'visualizer',
    name: 'AI Visualizer',
    status: 'Live',
    tagline: 'Play any song, pick an AI, watch it invent a visualizer.',
    tags: ['Web Audio', 'Canvas/WebGL', 'LLMs'],
  },
  {
    id: 'ryodev',
    name: 'RyoDev',
    status: 'Beta',
    tagline: 'What needs me, where, and how fresh is that claim?',
    tags: ['PWA', 'Cloudflare Workers', 'Claude Code hooks'],
  },
  {
    id: 'mcb',
    name: 'Most Common Blunder',
    status: 'Live',
    tagline: 'Find the chess mistake you keep making, powered by Stockfish.',
    tags: ['Python', 'Stockfish', 'React'],
  },
  {
    id: 'dns',
    name: 'DNS Integrity Checker',
    status: 'Experiment',
    tagline: 'A Chrome extension that catches DNS spoofing with DNS-over-HTTPS cross-checks.',
    tags: ['Chrome MV3', 'DNS security', 'DoH'],
  },
];

const BUILDS = [
  'AI Visualizer',
  'RyoDev',
  'DNS Integrity Checker',
  'Riff',
  'Most Common Blunder',
  'RyoMap',
  'Agent Station',
  'Sadhana',
  'DreamField',
  'SpamShredder',
  'Slay the Spire bot',
  'Kensa',
];

// Monochrome spectrum, like the Visualizer's stage: white bars at different opacities.
const BARS = Array.from({ length: 60 }, (_, i) => ({
  r: `${(i / 60) * 360}deg`,
  a: (0.28 + (((i * 17) % 11) / 11) * 0.62).toFixed(2),
  d: `${1.1 + ((i * 7) % 9) / 9}s`,
  dl: `${-((i * 13) % 17) / 10}s`,
  s: 0.35 + (((i * 29) % 13) / 13) * 0.65,
}));

// Faint horizontal waves behind the hero (static), echoing the Visualizer's idle stage.
const WAVES = Array.from({ length: 11 }, (_, i) => {
  const y = 30 + i * 34;
  const a = 8 + (i % 4) * 7;
  return {
    d: `M-20 ${y} C 200 ${y - a}, 420 ${y + a}, 620 ${y} S 1000 ${y - a}, 1220 ${y + a * 0.4}`,
    o: (0.05 + ((i * 5) % 4) * 0.022).toFixed(3),
  };
});

function Mark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#fff" fillOpacity=".92" />
      <path d="M9 11.5 16 7.5l7 4-7 4Z" fill="#050506" fillOpacity=".92" />
      <path d="M9 11.5v8l7 4v-8Z" fill="#050506" fillOpacity=".64" />
      <path d="M23 11.5v8l-7 4v-8Z" fill="#050506" fillOpacity=".4" />
    </svg>
  );
}

function Waves() {
  return (
    <svg className="hero-waves" viewBox="0 0 1200 400" preserveAspectRatio="none" aria-hidden="true">
      {WAVES.map((w) => (
        <path key={w.d} d={w.d} strokeOpacity={w.o} />
      ))}
    </svg>
  );
}

function Arrow() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg className="icon icon-fill" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5a9.5 9.5 0 0 0-3 18.5c.5.1.6-.2.6-.5v-1.7c-2.6.6-3.2-1.2-3.2-1.2-.4-1.1-1-1.4-1-1.4-.9-.6 0-.6 0-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1 2.8.8.1-.6.3-1 .6-1.3-2.1-.2-4.3-1-4.3-4.7 0-1 .4-1.9 1-2.6-.1-.2-.4-1.2.1-2.5 0 0 .8-.3 2.6 1a9 9 0 0 1 4.8 0c1.8-1.3 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.5.6.7 1 1.6 1 2.6 0 3.7-2.2 4.5-4.3 4.7.3.3.6.9.6 1.8v2.7c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.5Z" />
    </svg>
  );
}

function Spectrum() {
  return (
    <div className="spectrum" aria-hidden="true">
      {BARS.map((b) => (
        <span key={b.r} style={{ '--r': b.r, '--a': b.a, '--d': b.d, '--dl': b.dl, '--s': b.s }}>
          <i />
        </span>
      ))}
      <div className="spectrum-core">
        <svg viewBox="0 0 24 24">
          <path d="M8 5.5v13l10.5-6.5z" />
        </svg>
      </div>
    </div>
  );
}

// Adds .is-in to .reveal elements as they scroll into view (DOM-only, no re-renders).
function useReveal(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const els = [...root.querySelectorAll('.reveal')];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('is-in'));
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        let i = 0;
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.style.setProperty('--i', String(i));
          i += 1;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        });
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.08 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [rootRef]);
}

export default function Home() {
  const [fieldOpen, setFieldOpen] = useState(false);
  const rootRef = useRef(null);
  useReveal(rootRef);

  return (
    <div className="home" ref={rootRef}>
      <a className="skip" href="#main">Skip to content</a>

      <header className="nav">
        <div className="wrap nav-in">
          <a className="brand" href="/" aria-label="Ryo Nagaki-DiLazzaro, home">
            <Mark />
            <span className="brand-text">Ryo</span>
          </a>
          <nav className="nav-links" aria-label="Primary">
            <a className="nav-link" href="#work">Work</a>
            <a className="nav-link" href="#experiments">Experiments</a>
            <a className="nav-cta" href="/dev/">
              Dev Center <Arrow />
            </a>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-name">
          <Waves />
          <div className="wrap hero-in">
            <p className="label rise" style={{ '--d': 0 }}>
              Software developer
            </p>
            <h1 className="hero-name rise" id="hero-name" style={{ '--d': 1 }} aria-label="Ryo Nagaki-DiLazzaro">
              <span className="hero-first">Ryo </span>
              <em>
                <span>Nagaki-</span>
                <span>DiLazzaro</span>
              </em>
            </h1>
            <div className="hero-foot rise" style={{ '--d': 2 }}>
              <p className="hero-lede">AI tools, security experiments, and things that make music move.</p>
              <div className="hero-cta">
                <a className="btn btn-primary" href="/dev/">
                  Enter the Dev Center <Arrow />
                </a>
                <a className="btn btn-ghost" href={GITHUB} rel="noopener">
                  <GitHubMark /> GitHub
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="featured-title">
          <div className="wrap">
            <article className="feature reveal">
              <div className="feature-copy">
                <p className="label">01 — Featured</p>
                <h2 className="feature-title" id="featured-title">
                  AI Visualizer
                </h2>
                <p className="feature-tagline">Play any song, pick an AI, watch it invent a visualizer.</p>
                <p className="feature-blurb">
                  Pick any model through OpenRouter and it writes a music-reactive visualizer on the spot, running
                  sandboxed while the current one keeps playing. Featured dreams work with just your mic, no account
                  needed.
                </p>
                <ul className="feature-facts">
                  <li>17 contract suites + Playwright e2e</li>
                  <li>Sandboxed iframe preflight</li>
                  <li>60 commits in 6 days</li>
                </ul>
                <div className="feature-cta">
                  <a className="btn btn-primary" href="/visualizer/">
                    Open the Visualizer <Arrow />
                  </a>
                  <a className="btn btn-ghost" href="/dev/#p=visualizer">
                    Project notes
                  </a>
                </div>
              </div>
              <div className="feature-art">
                <span className="pill feature-pill" data-status="Live">Live</span>
                <Spectrum />
              </div>
            </article>
          </div>
        </section>

        <section className="section" aria-labelledby="devcenter-title">
          <div className="wrap">
            <a className="devcta reveal" href="/dev/">
              <span className="label">02 — Dev Center</span>
              <span className="devcta-title" id="devcenter-title">
                Everything I’m building, <em>in one room.</em>
              </span>
              <span className="devcta-row">
                <span className="devcta-stats">
                  <span>
                    <b>12</b> builds
                  </span>
                  <span>
                    <b>3</b> live
                  </span>
                  <span>
                    <b>2,400+</b> automated tests written
                  </span>
                </span>
                <span className="devcta-go">
                  Enter the Dev Center
                  <span className="devcta-arrow">
                    <Arrow />
                  </span>
                </span>
              </span>
              <span className="devcta-list" aria-hidden="true">
                {BUILDS.map((name) => (
                  <span key={name}>{name}</span>
                ))}
              </span>
            </a>
          </div>
        </section>

        <section className="section" id="work" aria-labelledby="work-title">
          <div className="wrap">
            <div className="section-head reveal">
              <p className="label">03 — Selected work</p>
              <h2 className="section-title" id="work-title">
                Selected <em>work</em>
              </h2>
            </div>
            <ul className="work-grid">
              {SELECTED.map((p, i) => (
                <li key={p.id} className="work-card reveal">
                  <div className="work-top">
                    <span className="work-idx">{String(i + 1).padStart(2, '0')}</span>
                    <span className="pill" data-status={p.status}>
                      {p.status}
                    </span>
                  </div>
                  <h3 className="work-name">
                    <a href={`/dev/#p=${p.id}`}>{p.name}</a>
                  </h3>
                  <p className="work-tagline">{p.tagline}</p>
                  <div className="work-foot">
                    <ul className="tags" aria-label="Stack">
                      {p.tags.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                    <span className="work-go" aria-hidden="true">
                      <Arrow />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section" id="experiments" aria-labelledby="experiments-title">
          <div className="wrap">
            <div className="section-head reveal">
              <p className="label">04 — Experiments</p>
              <h2 className="section-title" id="experiments-title">
                A field that <em>dreams back</em>
              </h2>
            </div>
            <div className="experiment-card reveal">
              <div className="experiment-card__intro">
                <div>
                  <span className="experiment-kicker">Interactive experiment 001 · DreamField</span>
                  <p className="experiment-description">
                    A living generative universe written in code, with no video and nothing pre-rendered. Bend it with
                    touch, let nearby sound reshape its physics, or open it fullscreen and disappear into a universe
                    that is being drawn only for this moment.
                  </p>
                </div>
                <button
                  type="button"
                  className="experiment-toggle"
                  aria-expanded={fieldOpen}
                  aria-controls="dream-field-panel"
                  onClick={() => setFieldOpen((open) => !open)}
                >
                  {fieldOpen ? 'Close the field' : 'Enter the field'}
                  {!fieldOpen && <Arrow />}
                </button>
              </div>
              {fieldOpen && (
                <div className="experiment-panel" id="dream-field-panel">
                  <DreamField />
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-in">
          <div className="footer-brand">
            <Mark />
            <p>© 2026 Ryo Nagaki-DiLazzaro</p>
          </div>
          <nav className="footer-links" aria-label="Footer">
            <a href="/dev/">Dev Center</a>
            <a href={GITHUB} rel="noopener">
              <GitHubMark /> GitHub
            </a>
            <a href="/SpamShredder/privacy.html">SpamShredder privacy policy</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
