import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const HOST = '127.0.0.1';
const PORT = 4096;
const ALLOWED_ORIGIN = 'https://ryo-nd.com';
const MODEL_CACHE_MS = 30_000;
const sessions = new Map();
let modelCache = null;
let modelCacheAt = 0;

function findOpenCodeExecutable() {
  const candidates = [];
  if (process.platform === 'win32') {
    const where = spawnSync('where.exe', ['opencode.cmd'], { encoding: 'utf8', windowsHide: true });
    const shim = where.status === 0 ? String(where.stdout || '').split(/\r?\n/).map(v => v.trim()).find(Boolean) : '';
    if (shim) candidates.push(path.join(path.dirname(shim), 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
    if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
  } else {
    const which = spawnSync('which', ['opencode'], { encoding: 'utf8' });
    if (which.status === 0) candidates.push(String(which.stdout || '').trim());
  }
  const direct = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (direct) return direct;
  return process.platform === 'win32' ? 'opencode.cmd' : 'opencode';
}

const OPENCODE = findOpenCodeExecutable();
const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-visualizer-opencode-'));
fs.writeFileSync(path.join(WORKDIR, 'opencode.json'), JSON.stringify({
  $schema: 'https://opencode.ai/config.json',
  permission: 'deny',
}, null, 2));

function spawnOpenCode(args, options = {}) {
  if (process.platform === 'win32' && OPENCODE.toLowerCase().endsWith('.cmd')) {
    const escaped = [OPENCODE, ...args].map(value => `"${String(value).replaceAll('"', '\\"')}"`).join(' ');
    return spawn('cmd.exe', ['/d', '/s', '/c', escaped], { windowsHide: true, ...options });
  }
  return spawn(OPENCODE, args, { windowsHide: true, ...options });
}

function runCapture(args, { input = '', timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnOpenCode(args, { cwd: WORKDIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      terminateChild(child);
      reject(new Error(`OpenCode command timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `OpenCode exited with code ${code}`).trim()));
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function terminateChild(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref();
    return;
  }
  try { child.kill('SIGTERM'); } catch {}
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && origin !== ALLOWED_ORIGIN) return false;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store');
  return true;
}

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function parseVerboseModels(output) {
  const lines = String(output || '').replaceAll('\r', '').split('\n');
  const providers = new Map();
  let index = 0;
  while (index < lines.length) {
    const idLine = lines[index].trim();
    if (!/^[^\s/]+\/.+/.test(idLine)) {
      index += 1;
      continue;
    }
    const slash = idLine.indexOf('/');
    const providerID = idLine.slice(0, slash);
    const modelID = idLine.slice(slash + 1);
    index += 1;
    while (index < lines.length && !lines[index].trim()) index += 1;
    let model = { id: modelID, name: modelID };
    if (index < lines.length && lines[index].trim().startsWith('{')) {
      const buffer = [];
      let depth = 0;
      let inString = false;
      let escaped = false;
      let started = false;
      for (; index < lines.length; index += 1) {
        const line = lines[index];
        buffer.push(line);
        for (const char of line) {
          if (escaped) { escaped = false; continue; }
          if (inString && char === '\\') { escaped = true; continue; }
          if (char === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (char === '{') { depth += 1; started = true; }
          if (char === '}') depth -= 1;
        }
        if (started && depth === 0) {
          index += 1;
          break;
        }
      }
      try { model = { ...JSON.parse(buffer.join('\n')), id: modelID }; } catch {}
    }
    if (!providers.has(providerID)) providers.set(providerID, { id: providerID, name: providerName(providerID), models: {} });
    providers.get(providerID).models[modelID] = { ...model, id: modelID, name: model.name || modelID };
  }
  return [...providers.values()];
}

function providerName(id) {
  if (id === 'openai') return 'ChatGPT / OpenAI';
  if (id === 'opencode' || id.startsWith('opencode-')) return 'OpenCode Go / Zen';
  if (id === 'anthropic') return 'Anthropic';
  if (id === 'google') return 'Google';
  return id;
}

async function providerPayload() {
  if (modelCache && Date.now() - modelCacheAt < MODEL_CACHE_MS) return modelCache;
  const { stdout } = await runCapture(['models', '--verbose'], { timeoutMs: 90_000 });
  const providers = parseVerboseModels(stdout);
  modelCache = { all: providers, connected: providers.map(provider => provider.id) };
  modelCacheAt = Date.now();
  return modelCache;
}

function parseRunOutput(stdout) {
  const texts = [];
  let tokens = { input: 0, output: 0, reasoning: 0 };
  let cost = 0;
  let model = '';
  let error = '';
  for (const rawLine of String(stdout || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'text' && event.part?.text && !event.part?.synthetic && !event.part?.ignored) texts.push(String(event.part.text));
    if (event.type === 'step_finish' || event.type === 'step-finish') {
      const partTokens = event.part?.tokens || {};
      tokens = {
        input: Number(partTokens.input || tokens.input || 0),
        output: Number(partTokens.output || tokens.output || 0),
        reasoning: Number(partTokens.reasoning || tokens.reasoning || 0),
      };
      cost = Number(event.part?.cost || cost || 0);
      model = event.part?.model || model;
    }
    if (event.type === 'error') error = event.part?.message || event.error?.message || error;
  }
  const text = texts.join('');
  if (!text.trim()) throw new Error(error || 'OpenCode returned no text for this Dream.');
  return { text, tokens, cost, model };
}

function runModel(sessionID, body) {
  const session = sessions.get(sessionID);
  if (!session) throw new Error('Unknown local Model Lab session.');
  if (session.child) throw new Error('A Model Lab request is already running in this session.');
  const providerID = String(body?.model?.providerID || '');
  const modelID = String(body?.model?.modelID || '');
  if (!providerID || !modelID) throw new Error('Missing OpenCode model identity.');
  const variant = body?.variant ? String(body.variant) : '';
  const system = String(body?.system || '').trim();
  const user = (Array.isArray(body?.parts) ? body.parts : []).filter(part => part?.type === 'text').map(part => String(part.text || '')).join('\n\n').trim();
  const prompt = [system, user].filter(Boolean).join('\n\n');
  if (!prompt) throw new Error('The visualizer prompt was empty.');

  return new Promise((resolve, reject) => {
    const args = ['run', '--format', 'json', '--model', `${providerID}/${modelID}`, '--dir', WORKDIR];
    if (variant) args.push('--variant', variant);
    const child = spawnOpenCode(args, { cwd: WORKDIR, stdio: ['pipe', 'pipe', 'pipe'] });
    session.child = child;
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      session.child = null;
      reject(error);
    });
    child.on('close', code => {
      session.child = null;
      if (session.aborted) return reject(new Error('Dream cancelled.'));
      if (code !== 0) return reject(new Error((stderr || stdout || `OpenCode exited with code ${code}`).trim()));
      try {
        const result = parseRunOutput(stdout);
        resolve({
          info: { tokens: result.tokens, cost: result.cost, model: result.model || `${providerID}/${modelID}` },
          parts: [{ type: 'text', text: result.text }],
        });
      } catch (error) { reject(error); }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function version() {
  try {
    const { stdout } = await runCapture(['--version'], { timeoutMs: 15_000 });
    return String(stdout || '').trim();
  } catch { return ''; }
}

const server = http.createServer(async (req, res) => {
  if (!cors(req, res)) return json(res, 403, { error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);

  try {
    if (req.method === 'GET' && url.pathname === '/global/health') {
      return json(res, 200, { healthy: true, version: await version(), bridge: 'windows-run-v1' });
    }
    if (req.method === 'GET' && url.pathname === '/provider') {
      return json(res, 200, await providerPayload());
    }
    if (req.method === 'POST' && url.pathname === '/session') {
      const id = `viz_${crypto.randomUUID()}`;
      sessions.set(id, { child: null, aborted: false });
      return json(res, 200, { id });
    }
    const messageMatch = url.pathname.match(/^\/session\/([^/]+)\/message$/);
    if (req.method === 'POST' && messageMatch) {
      const id = decodeURIComponent(messageMatch[1]);
      const body = await readJson(req);
      return json(res, 200, await runModel(id, body));
    }
    const abortMatch = url.pathname.match(/^\/session\/([^/]+)\/abort$/);
    if (req.method === 'POST' && abortMatch) {
      const id = decodeURIComponent(abortMatch[1]);
      const session = sessions.get(id);
      if (session) {
        session.aborted = true;
        terminateChild(session.child);
      }
      return json(res, 200, { aborted: Boolean(session) });
    }
    const sessionMatch = url.pathname.match(/^\/session\/([^/]+)$/);
    if (req.method === 'DELETE' && sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]);
      const session = sessions.get(id);
      if (session?.child) terminateChild(session.child);
      sessions.delete(id);
      return json(res, 200, { deleted: true });
    }
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    console.error('[Model Lab]', error);
    return json(res, 500, { error: error?.message || String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('AI Visualizer Model Lab bridge is LIVE');
  console.log(`  http://${HOST}:${PORT}`);
  console.log(`  OpenCode: ${OPENCODE}`);
  console.log(`  Allowed site: ${ALLOWED_ORIGIN}`);
  console.log('');
  console.log('Keep this window open while using subscription-backed models.');
  console.log('Press Ctrl+C to stop.');
});

function cleanup() {
  for (const session of sessions.values()) terminateChild(session.child);
  try { fs.rmSync(WORKDIR, { recursive: true, force: true }); } catch {}
}
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);
