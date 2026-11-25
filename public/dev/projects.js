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
    links: [{ label: 'Open the Visualizer', href: 'https://ryo-nd.com/visualizer/' }],
    facts: ['17 contract suites + Playwright e2e', 'Sandboxed iframe preflight', '60 commits in 6 days'],
    accent: 'rose',
    demo: 'visualizer',
    size: 'xl',
  },
  {
    id: 'dns',
    name: 'DNS Integrity Checker',
    tagline: 'A Chrome extension that catches DNS spoofing with DNS-over-HTTPS cross-checks.',
    blurb:
      'Security research: it compares your resolver’s answer against independent DoH resolvers, with CDN allowlisting and IP-range heuristics. It ships with a local spoofing lab (a fake HTTPS server plus a custom root CA) to prove it works.',
    status: 'Experiment',
    year: 2025,
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
    status: 'In the lab',
    year: 2026,
    tags: ['Python', 'Flask', 'OAuth PKCE', 'Fuzzy matching', 'Docker'],
    links: [{ label: 'Source on GitHub', href: 'https://github.com/rdilaz/csv-to-clone-hero' }],
    facts: ['1,000+ tests', 'Match confidence 0–100'],
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
    links: [{ label: 'Open the 3D demo', href: 'https://ryo-nd.com/agent-station/' }],
    facts: ['1,600+ tests', 'Phone approval flow', '3D demo runs on synthetic data'],
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
    links: [{ label: 'Open app', href: 'https://ryo-nd.com/sadhana/' }],
    facts: ['4s in · ½s · 4s out · ½s', 'Installable PWA', 'One-evening build'],
    accent: 'live',
    demo: 'sadhana',
  },
  {
    id: 'flowers',
    name: 'Flowers',
    tagline: 'A nightly recap that grows a bouquet from what you finished.',
    blurb:
      'The evening half of Ṛta, a daily ritual built with Claude. Each night a 3D garden grows a flower for every task finished, bows a stem for what was skipped and sends a butterfly toward tomorrow, scored to Chopin. The demo runs on made-up nights.',
    status: 'Experiment',
    year: 2026,
    tags: ['three.js', 'WebGL', 'Web Audio'],
    links: [{ label: 'Open the demo', href: 'https://ryo-nd.com/flowers/' }],
    facts: ['Demo uses made-up nights', 'Scored to Chopin, Op. 53'],
    accent: 'rose',
    demo: 'flowers',
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
    links: [{ label: 'Enter the field', href: 'https://ryo-nd.com/#experiments' }],
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
    status: 'Live',
    year: 2026,
    tags: ['Chrome MV3', 'Gmail API', 'OAuth'],
    links: [
      { label: 'Chrome Web Store', href: 'https://chromewebstore.google.com/detail/spam-shredder/cbfeclcjnbhalmengbpmbkbkgcpgnidk' },
      { label: 'Source on GitHub', href: 'https://github.com/rdilaz/SpamShredder' },
      { label: 'Privacy policy', href: 'https://gist.github.com/rdilaz/5ebdc944f4a1cfa7f6f4547e7cb08448' },
    ],
    facts: ['Runs client-side in your browser'],
    accent: 'ember',
    demo: 'spamshredder',
  },
  {
    id: 'auto-alt',
    name: 'Auto-Alt',
    tagline: 'A captioning model that writes alt text for any image.',
    blurb:
      'A course project for a machine-learning class: an image-captioning model trained on Flickr8k (8,091 images, about 40,000 captions). A ResNet50 encoder turns each image into a 2,048-number feature vector and a merged CNN and LSTM decoder writes the caption, decoded with beam search.',
    status: 'Experiment',
    year: 2025,
    tags: ['Python', 'TensorFlow', 'ResNet50', 'LSTM', 'Colab'],
    links: [],
    facts: ['Trained on 8,091 images', '8,831-word vocabulary', 'Beam search, width 5'],
    accent: 'info',
    demo: 'autoalt',
  },
  {
    id: 'sts-bot',
    name: 'Slay the Spire RL agent',
    tagline: 'A reinforcement-learning agent that learns to fight in Slay the Spire.',
    blurb:
      'A PyTorch dueling Double-DQN that learns combat card play online while it plays Ironclad through CommunicationMod, with smaller Q-networks for card rewards and events. Map, rest and shop choices are still scripted.',
    status: 'Private',
    year: 2025,
    tags: ['Python', 'PyTorch', 'Reinforcement learning', 'CommunicationMod'],
    links: [],
    facts: ['85% of fights won over 1,000 combats', 'Reached floor 14 of Act 1'],
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
  { label: 'Riff', id: 'riff' },
  { label: 'Kensa', id: 'kensa' },
];

// Build log, newest first. Months only.
export const buildLog = [
  {
    month: 'Nov 2026',
    items: [{ id: 'flowers', text: 'Nightly recap garden' }],
  },
  {
    month: 'Sep 2026',
    items: [
      { id: 'visualizer', text: '60 commits in 6 days' },
      { id: 'sadhana', text: 'A one-evening build' },
    ],
  },
  { month: 'Aug 2026', items: [{ id: 'riff' }, { id: 'agent-station' }] },
  { month: 'Jul 2026', items: [{ id: 'mcb', text: 'Refreshed' }] },
  { month: 'Jun 2026', items: [{ id: 'spamshredder' }] },
  { month: 'May 2025', items: [{ id: 'dns' }] },
];

export const profile = {
  github: 'https://github.com/rdilaz',
  linkedin: 'https://www.linkedin.com/in/ryodila/',
  home: 'https://ryo-nd.com/',
};
