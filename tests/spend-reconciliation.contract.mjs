import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENERATION_METADATA_RETRY_DELAYS_MS,
  authoritativeGenerationMetadata,
  runBoundedGenerationReconciliation,
} from '../public/visualizer/cost-guard.js';

test('authoritative metadata accepts exact zero and positive total_cost only for the expected generation', () => {
  const zero = authoritativeGenerationMetadata({
    data: { id: 'gen-zero', total_cost: 0, tokens_prompt: 10, tokens_completion: 0 },
  }, 'gen-zero');
  assert.equal(zero.accepted, true);
  assert.equal(zero.cost, 0);
  assert.equal(zero.usage.providerGenerationId, 'gen-zero');

  const positive = authoritativeGenerationMetadata({
    data: { id: 'gen-positive', total_cost: 0.125, tokens_prompt: 10, tokens_completion: 4 },
  }, 'gen-positive');
  assert.equal(positive.accepted, true);
  assert.equal(positive.cost, 0.125);

  assert.deepEqual(
    authoritativeGenerationMetadata({ data: { id: 'gen-other', total_cost: 0 } }, 'gen-expected'),
    { accepted: false, reason: 'metadata-generation-id-mismatch', usage: null, cost: null },
  );
  assert.equal(authoritativeGenerationMetadata({ data: { id: 'gen-no-cost' } }, 'gen-no-cost').accepted, false);
  assert.equal(authoritativeGenerationMetadata({ data: { id: 'gen-bad-cost', total_cost: 'not-finite' } }, 'gen-bad-cost').accepted, false);
});

test('bounded metadata reconciliation retries too-early absence without a tight loop', async () => {
  const waits = [];
  const results = [
    { settled: false, reason: 'metadata-http-404' },
    { settled: false, reason: 'metadata-http-404' },
    { settled: true, source: 'generation-metadata', terminal: true },
  ];
  const result = await runBoundedGenerationReconciliation({
    delays: [0, 1500, 5000, 15000],
    wait: async delay => { waits.push(delay); },
    attempt: async () => results.shift(),
  });
  assert.equal(result.settled, true);
  assert.equal(result.attempts, 3);
  assert.deepEqual(waits, [1500, 5000]);
});

test('metadata 429, 5xx, and network failures exhaust only the finite schedule and never imply zero', async () => {
  assert.deepEqual(GENERATION_METADATA_RETRY_DELAYS_MS, [0, 1500, 5000, 15000, 30000, 60000]);
  for (const reason of ['metadata-http-429', 'metadata-http-503', 'metadata-fetch-failed']) {
    const waits = [];
    let attempts = 0;
    const result = await runBoundedGenerationReconciliation({
      delays: GENERATION_METADATA_RETRY_DELAYS_MS,
      wait: async delay => { waits.push(delay); },
      attempt: async () => {
        attempts += 1;
        return { settled: false, reason };
      },
    });
    assert.equal(result.settled, false);
    assert.equal(result.reason, reason);
    assert.equal(attempts, GENERATION_METADATA_RETRY_DELAYS_MS.length);
    assert.deepEqual(waits, GENERATION_METADATA_RETRY_DELAYS_MS.slice(1));
  }
});
