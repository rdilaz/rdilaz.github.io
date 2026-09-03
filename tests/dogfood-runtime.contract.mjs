import assert from 'node:assert/strict';
import test from 'node:test';
import { DREAM_JOB_PHASES, dreamJobOwnsReliabilityStage } from '../public/visualizer/dream-job.js';
import { modelSearchMatches, normalizeModelSearch } from '../public/visualizer/model-search.js';
import { modelFitConfigurationKey } from '../public/visualizer/model-fit-evidence.js';
import {
  HEARTBEAT_STALE_MS,
  STALL_CONFIRM_TIMEOUT_MS,
  STALL_RETRY_TIMEOUT_MS,
  activeStallConfirmationDecision,
  confirmSandboxLiveness,
  RELIABILITY_SCHEMA,
} from '../public/visualizer/reliability.js';
import { VISUALIZER_RUNTIME_VERSION } from '../public/visualizer/runtime-version.js';

const owner = Object.freeze({ jobId: 'job-a', traceId: 'trace-a' });
const executingJob = Object.freeze({ id: 'job-a', phase: DREAM_JOB_PHASES.WORKING });

test('reliability stage ownership requires the active executing job and exact trace', () => {
  const base = {
    generating: true,
    owner,
    diagnosticTraceId: 'trace-a',
    activeTraceId: 'trace-a',
    job: executingJob,
  };
  assert.equal(dreamJobOwnsReliabilityStage(base), true);
  assert.equal(dreamJobOwnsReliabilityStage({ ...base, owner: null }), false);
  assert.equal(dreamJobOwnsReliabilityStage({ ...base, owner: { ...owner, jobId: 'job-b' } }), false);
  assert.equal(dreamJobOwnsReliabilityStage({ ...base, diagnosticTraceId: 'trace-b' }), false);
  assert.equal(dreamJobOwnsReliabilityStage({ ...base, activeTraceId: 'trace-b' }), false);
  assert.equal(dreamJobOwnsReliabilityStage({ ...base, generating: false }), false);
  for (const phase of [DREAM_JOB_PHASES.READY, DREAM_JOB_PHASES.FAILED, DREAM_JOB_PHASES.CANCELLED, DREAM_JOB_PHASES.OPENING]) {
    assert.equal(dreamJobOwnsReliabilityStage({ ...base, job: { ...executingJob, phase } }), false);
  }
});

test('runtime and reliability v3 isolate new evidence without rewriting historical v1/v2 identity', () => {
  const base = {
    modelId: 'z-ai/glm-5.3-flash',
    reasoningChoice: 'default',
    promptProfileId: 'neutral-v1',
    promptVersion: 'visualizer-prompt-v2',
    promptHash: 'fixture-hash',
    generationEnvelopeMajorVersion: 1,
    audioApiVersion: 'visualizer-audio-v1',
  };
  const historical = modelFitConfigurationKey({
    ...base,
    reliabilityVersion: 'dream-reliability-v1',
    runtimeVersion: 'visualizer-runtime-v1',
  });
  const historicalV2 = modelFitConfigurationKey({
    ...base,
    reliabilityVersion: 'dream-reliability-v2',
    runtimeVersion: 'visualizer-runtime-v2',
  });
  const current = modelFitConfigurationKey({
    ...base,
    reliabilityVersion: RELIABILITY_SCHEMA,
    runtimeVersion: VISUALIZER_RUNTIME_VERSION,
  });
  assert.equal(RELIABILITY_SCHEMA, 'dream-reliability-v3');
  assert.equal(VISUALIZER_RUNTIME_VERSION, 'visualizer-runtime-v3');
  assert.notEqual(current, historical);
  assert.notEqual(current, historicalV2);
  assert.match(historical, /dream-reliability-v1/);
  assert.match(historical, /visualizer-runtime-v1/);
  assert.match(historicalV2, /dream-reliability-v2/);
  assert.match(historicalV2, /visualizer-runtime-v2/);
});

test('model search ignores human punctuation and spacing while retaining exact identifiers', () => {
  const fixtures = [
    {
      model: { name: 'Qwen3.8 Flash', id: 'qwen/qwen3.8-flash', provider: 'Qwen' },
      queries: ['Qwen 3.8 Flash', 'qwen3.8', 'qwen/qwen3.8-flash'],
    },
    {
      model: { name: 'Google: Gemini 3.8 Flash', id: 'google/gemini-3.8-flash', provider: 'Google' },
      queries: ['Gemini 3.8', 'google gemini 3 8', 'google/gemini-3.8'],
    },
    {
      model: { name: 'Z.ai: GLM 5.3 Flash', id: 'z-ai/glm-5.3-flash', provider: 'Z.ai' },
      queries: ['Z ai GLM 5.3', 'glm5.3', 'z-ai/glm-5.3-flash'],
    },
  ];
  for (const fixture of fixtures) {
    const before = structuredClone(fixture.model);
    for (const query of fixture.queries) assert.equal(modelSearchMatches(fixture.model, query), true, query);
    assert.deepEqual(fixture.model, before);
  }
  assert.equal(modelSearchMatches(fixtures[0].model, ''), true);
  assert.equal(modelSearchMatches(fixtures[0].model, '... ---'), true);
  assert.equal(modelSearchMatches(fixtures[0].model, 'qwen missing-token'), false);
  assert.equal(modelSearchMatches({ name: 'Qwen3-8B', id: 'qwen/qwen3-8b', provider: 'Qwen' }, 'qwen3.8'), false);
  assert.equal(modelSearchMatches({ name: 'Gemini 3 Pro Context 8K', id: 'google/gemini-3-pro-8k', provider: 'Google' }, 'Gemini 3.8'), false);
  assert.equal(modelSearchMatches(fixtures[1].model, '3 gem'), true);
  assert.equal(normalizeModelSearch('  Z.ai — GLM__5.3  '), 'z ai glm 5 3');
  assert.equal(normalizeModelSearch('Gémini'), 'gemini');
});

function livenessSandbox({ snapshots, probes = [], fatal = null }) {
  let snapshotIndex = 0;
  let probeIndex = 0;
  const timeouts = [];
  return {
    timeouts,
    heartbeatSnapshot() {
      return snapshots[Math.min(snapshotIndex, snapshots.length - 1)];
    },
    async probe(_label, { timeoutMs }) {
      timeouts.push(timeoutMs);
      const action = probes[Math.min(probeIndex, probes.length - 1)];
      probeIndex += 1;
      snapshotIndex = Math.min(snapshotIndex + 1, snapshots.length - 1);
      if (action instanceof Error) throw action;
      return action;
    },
    fatalEvents() {
      return fatal ? [fatal] : [];
    },
  };
}

const stale = Object.freeze({ sessionId: 'session-a', receivedAt: 10, sandboxAtMs: 100, ageMs: HEARTBEAT_STALE_MS + 500 });
const fresh = Object.freeze({ sessionId: 'session-a', receivedAt: 20, sandboxAtMs: 1100, ageMs: 50 });

test('a stale heartbeat that recovers through the authenticated probe survives', async () => {
  const report = { visual: { visibleProof: true }, viz: { consumed: true } };
  const sandbox = livenessSandbox({ snapshots: [stale, fresh], probes: [report] });
  const result = await confirmSandboxLiveness(sandbox);
  assert.equal(result.status, 'recovered');
  assert.equal(result.report, report);
  assert.equal(result.evidence.initialStale, true);
  assert.equal(result.evidence.heartbeat.advanced, true);
  assert.equal(result.evidence.probe.responded, true);
});

test('a permanent heartbeat and probe stall remains RUNTIME_STALLED evidence', async () => {
  const sandbox = livenessSandbox({ snapshots: [stale], probes: [new Error('probe timed out')] });
  const result = await confirmSandboxLiveness(sandbox);
  assert.equal(result.status, 'stalled');
  assert.equal(result.evidence.heartbeat.advanced, false);
  assert.equal(result.evidence.probe.responded, false);
  assert.equal(result.evidence.probe.attempts, 1);
  assert.deepEqual(sandbox.timeouts, [STALL_CONFIRM_TIMEOUT_MS]);
});

test('a fatal runtime event fails immediately without waiting for confirmation', async () => {
  const fatal = { severity: 'fatal', code: 'RUNTIME_ERROR', message: 'boom' };
  const sandbox = livenessSandbox({ snapshots: [stale], probes: [{ ok: true }], fatal });
  const result = await confirmSandboxLiveness(sandbox);
  assert.equal(result.status, 'fatal');
  assert.equal(result.fatal, fatal);
  assert.equal(result.evidence.probe.attempted, false);
  assert.deepEqual(sandbox.timeouts, []);
});

test('stall confirmation permits at most one bounded retry when heartbeat resumes but probes fail', async () => {
  const sandbox = livenessSandbox({
    snapshots: [stale, fresh, fresh],
    probes: [new Error('first probe failed'), new Error('retry failed')],
  });
  const result = await confirmSandboxLiveness(sandbox);
  assert.equal(result.status, 'probe-failed');
  assert.equal(result.evidence.probe.attempts, 2);
  assert.deepEqual(sandbox.timeouts, [STALL_CONFIRM_TIMEOUT_MS, STALL_RETRY_TIMEOUT_MS]);
});

test('cancellation during liveness confirmation propagates instead of becoming a health failure', async () => {
  const controller = new AbortController();
  controller.abort();
  const sandbox = livenessSandbox({ snapshots: [stale], probes: [new Error('must not probe')] });
  await assert.rejects(
    confirmSandboxLiveness(sandbox, { signal: controller.signal }),
    error => error?.name === 'AbortError',
  );
  assert.deepEqual(sandbox.timeouts, []);
});

test('active watchdog cooldown suppresses one stale epoch but not a new freeze after heartbeat recovery', () => {
  const previousConfirmation = {
    sessionId: 'session-a',
    heartbeat: { sessionId: 'session-a', receivedAt: 10, sandboxAtMs: 100, ageMs: 9000 },
    recheckAt: 40000,
  };
  assert.deepEqual(activeStallConfirmationDecision({
    heartbeat: { ...previousConfirmation.heartbeat, ageMs: 12000 },
    previousConfirmation,
    now: 20000,
  }), {
    stale: true,
    due: false,
    distinctHeartbeatEpoch: false,
    coolingDown: true,
  });
  assert.deepEqual(activeStallConfirmationDecision({
    heartbeat: { sessionId: 'session-a', receivedAt: 20, sandboxAtMs: 1100, ageMs: 9000 },
    previousConfirmation,
    now: 20000,
  }), {
    stale: true,
    due: true,
    distinctHeartbeatEpoch: true,
    coolingDown: false,
  });
  assert.equal(activeStallConfirmationDecision({
    heartbeat: { ...previousConfirmation.heartbeat, ageMs: 12000 },
    previousConfirmation,
    now: 40001,
  }).due, true);
});
