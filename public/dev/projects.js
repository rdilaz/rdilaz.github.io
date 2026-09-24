// Dev Center data. Edit freely: the page renders everything from this file.
//
// Project fields
//   id       short slug, used for deep links: <dev-center-url>#p=<id>
//   status   "Live" | "Beta" | "Private" | "Paused" | "In the lab" | "Experiment"
//   year     latest year of activity
//   links    [{ label, href }]; hrefs are used exactly as written. Root-relative
//            links ("/visualizer/") only work while the folder is served from
//            ryo-nd.com; use full https:// URLs if you copy it elsewhere.
//   facts    2-4 short, honest stat strings
//   accent   "ember" | "rose" | "violet" | "live" | "info" | "wait"
//   demo     mini-demo renderer key from demos.js
//   size     bento size: "xl" | "tall" | "wide" | undefined (standard)

export const projects = [
  {
    id: 'visualizer',
    name: 'AI Visualizer',
    tagline: 'Play any song, pick an AI, watch it invent a visualizer.',
    blurb:
      'Pick any model through OpenRouter and it writes a music-reactive visualizer on the spot, running sandboxed while the current one keeps playing. Featured dreams work with just your mic, no account needed.',
    status: 'Live',
    year: 2026,
    tags: ['JavaScript', 'Web Audio', 'Canvas/WebGL', 'LLMs'],
    links: [{ label: 'Open the Visualizer', href: '/visualizer/' }],
    facts: ['17 contract suites + Playwright e2e', 'Sandboxed iframe preflight', '60 commits in 6 days'],
    accent: 'rose',
    demo: 'visualizer',
    size: 'xl',
  },
  {
    id: 'ryodev',
    name: 'RyoDev',
    tagline: 'What needs me, where, and how fresh is that claim?',
    blurb:
      'A phone command center for AI coding sessions running across four laptops (Mac, Dell, HP and Aero): who is waiting on me, what finished, what is stale. It is honest about freshness, so stale never pretends to be offline. Now gaining a live mode fed by Claude Code and Codex hooks through a Cloudflare Worker.',
    status: 'Beta',
    year: 2026,
    tags: ['Vanilla JS', 'PWA', 'Cloudflare Workers', 'Claude Code hooks'],
    links: [{ label: 'Try the demo', href: 'https://rdilaz.github.io/ryodev/' }],
    facts: ['44 model tests', '30 demo scenarios', 'Installable on iPhone'],
    accent: 'live',
    demo: 'ryodev',
    size: 'tall',
  },
  {
    id: 'dns',
    name: 'DNS Integrity Checker',
    tagline: 'A Chrome extension that catches DNS spoofing with DNS-over-HTTPS cross-checks.',
    blurb:
      'Security research: it compares your resolver’s answer against independent DoH resolvers, with CDN allowlisting and IP-range heuristics. It ships with a local spoofing lab (a fake HTTPS server plus a custom root CA) to prove it works.',
    status: 'Experiment',
    year: 2026,
    tags: ['Chrome MV3', 'DNS security', 'DoH', 'Python'],
    links: [{ label: 'Source on GitHub', href: 'https://github.com/rdilaz/dns_integrity_checker' }],
    facts: ['Local spoofing lab included', '/16 + /48 range heuristics'],
    accent: 'info',
    demo: 'dns',
    size: 'wide',
  },
  {
    id: 'riff',
    name: 'Riff',
    tagline: 'Turn your Spotify library into a playable Clone Hero setlist.',
    blurb:
      'Reads Spotify, iTunes or CSV libraries, finds community charts for your songs, scores every match from 0 to 100 and builds a ready-to-play song folder.',
    status: 'Private',
    year: 2026,
    tags: ['Python', 'Flask', 'OAuth PKCE', 'Fuzzy matching', 'Docker'],
    links: [],
    facts: ['660+ tests', 'Match confidence 0–100'],
    accent: 'ember',
    demo: 'riff',
    size: 'wide',
  },
  {
    id: 'mcb',
    name: 'Most Common Blunder',
    tagline: 'Find the chess mistake you keep making, powered by Stockfish.',
    blurb:
      'Enter a Chess.com username and it analyzes your recent games with a pool of Stockfish engines, then tells you your most common blunder type (hanging pieces, missed forks, allowed mates) game by game.',
    status: 'Live',
    year: 2026,
    tags: ['Python', 'Flask', 'Stockfish', 'React', 'Cloud Run'],
    links: [{ label: 'Analyze your games', href: 'https://mcb.ryo-nd.com' }],
    facts: ['Stockfish engine pool', 'Game-by-game breakdown'],
    accent: 'violet',
    demo: 'mcb',
  },
  {
    id: 'ryomap',
    name: 'RyoMap',
    tagline: 'A “read these files first” map of any repo, for AI coding agents.',
    blurb:
      'Indexes a git repo (files, symbols, tests and docs) into SQLite FTS and serves ranked, freshness-checked context over MCP or the CLI.',
    status: 'Private',
    year: 2026,
    tags: ['Python', 'tree-sitter', 'SQLite FTS5', 'MCP'],
    links: [],
    facts: ['v0.1.1', 'Strict mypy + ruff'],
    accent: 'info',
    demo: 'ryomap',
  },
  {
    id: 'agent-station',
    name: 'Agent Station',
    tagline: 'A small team of AI agents that researches and runs a print shop, with a human on approval.',
    blurb:
      'Researcher, manager and critic agents propose actions for an Etsy print-on-demand shop. Nothing ships on its own: Ryo approves from a phone “Mission Control”.',
    status: 'Paused',
    year: 2026,
    tags: ['Python', 'React', 'three.js', 'Cloudflare Tunnel'],
    links: [],
    facts: ['1,600+ tests', 'Phone approval flow'],
    accent: 'violet',
    demo: 'agent-station',
    size: 'wide',
  },
  {
    id: 'sadhana',
    name: 'Sadhana',
    tagline: 'A quiet, installable breath pacer for morning practice.',
    blurb:
      'One steady cycle: four seconds in, a half-second pause, four seconds out, a half-second pause. It installs to your home screen and stays out of the way.',
    status: 'Experiment',
    year: 2026,
    tags: ['React', 'TypeScript', 'PWA'],
    links: [{ label: 'Open app', href: 'https://ryo-nd.com/sadhana-app/' }],
    facts: ['4s in · ½s · 4s out · ½s', 'Installable PWA', 'One-evening build'],
    accent: 'live',
    demo: 'sadhana',
  },
  {
    id: 'dreamfield',
    name: 'DreamField',
    tagline: 'A generative universe that bends to touch and breathes with sound.',
    blurb:
      'A living universe written in code, with no video and nothing pre-rendered. Bend it with touch, let nearby sound reshape its physics, or open it fullscreen.',
    status: 'Experiment',
    year: 2026,
    tags: ['Canvas', 'Web Audio', 'Generative'],
    links: [{ label: 'Enter the field', href: '/#experiments' }],
    facts: ['Drawn live, never pre-rendered', 'Optional mic response'],
    accent: 'violet',
    demo: 'dreamfield',
  },
  {
    id: 'spamshredder',
    name: 'SpamShredder',
    tagline: 'Find your loudest promo senders and shred them in one click.',
    blurb:
      'A client-side Chrome extension that ranks the senders flooding your Gmail with promotions and clears them out in one click.',
    status: 'Paused',
    year: 2026,
    tags: ['Chrome MV3', 'Gmail API', 'OAuth'],
    links: [
      { label: 'Source on GitHub', href: 'https://github.com/rdilaz/SpamShredder' },
      { label: 'Privacy policy', href: 'https://ryo-nd.com/SpamShredder/privacy.html' },
    ],
    facts: ['Runs client-side in your browser'],
    accent: 'ember',
    demo: 'spamshredder',
  },
  {
    id: 'sts-bot',
    name: 'Slay the Spire bot',
    tagline: 'A rule-based bot that plays Slay the Spire through a live game hook.',
    blurb:
      'Reads the live game state through a hook, weighs each turn with hand-written heuristics and plays its cards. No machine learning, just rules.',
    status: 'Private',
    year: 2026,
    tags: ['Python', 'Game AI', 'IPC'],
    links: [],
    facts: ['Rule-based heuristics', 'Live game hook'],
    accent: 'rose',
    demo: 'sts',
  },
  {
    id: 'kensa',
    name: 'Kensa',
    tagline: 'A GitHub App that reviews AI-authored pull requests.',
    blurb: 'Still in the lab. More when it is ready.',
    status: 'In the lab',
    year: 2026,
    tags: ['GitHub Apps', 'AI review'],
    links: [],
    facts: [],
    accent: 'wait',
    demo: 'kensa',
    size: 'wide',
  },
];

const text = (p) => [p.name, p.tagline, ...p.tags, ...p.facts].join(' ');

// Filter chips, in order. `match` decides which cards stay visible.
export const filters = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'live', label: 'Live', match: (p) => p.status === 'Live' || p.status === 'Beta' },
  { id: 'progress', label: 'In progress', match: (p) => ['Beta', 'Private', 'In the lab'].includes(p.status) },
  { id: 'experiments', label: 'Experiments', match: (p) => p.status === 'Experiment' },
  { id: 'security', label: 'Security', match: (p) => /security|DoH|OAuth|sandbox/i.test(text(p)) },
  { id: 'ai', label: 'AI', match: (p) => /\bAI\b|LLM|agent|MCP|Claude/i.test(text(p)) },
];

export const heroStats = [
  { value: String(projects.length), label: 'builds' },
  { value: String(projects.filter(filters[1].match).length), label: 'live' },
  { value: '2,400+', label: 'automated tests written' },
];

// "Now building" ticker in the hero. `id` opens that project.
export const nowBuilding = [
  { label: 'RyoDev live mode', id: 'ryodev' },
  { label: 'Kensa', id: 'kensa' },
];

// Build log, newest first. Months only.
export const buildLog = [
  {
    month: 'Sep 2026',
    items: [
      { id: 'ryodev', text: 'Demo shipped, live mode underway' },
      { id: 'visualizer', text: '60 commits in 6 days' },
      { id: 'sadhana', text: 'A one-evening build' },
    ],
  },
  { month: 'Aug 2026', items: [{ id: 'riff' }, { id: 'agent-station' }] },
  { month: 'Jul 2026', items: [{ id: 'mcb', text: 'Refreshed' }] },
  { month: 'Jun 2026', items: [{ id: 'spamshredder' }] },
  { month: 'May 2026', items: [{ id: 'dns' }] },
];

export const profile = {
  github: 'https://github.com/rdilaz',
  home: 'https://ryo-nd.com/',
};
