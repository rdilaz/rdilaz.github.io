import assert from 'node:assert/strict';
import { filterLiveDreamModels, liveDreamEligibility } from '../public/visualizer/model-eligibility.js';

const live = {
  id: 'google/gemini-flash-current',
  name: 'Google: Gemini Flash Current',
  architecture: { output_modalities: ['text'] },
  top_provider: { max_completion_tokens: 32000 },
  expiration_date: null,
};

assert.equal(liveDreamEligibility(live, Date.parse('2026-09-01T12:00:00Z')).eligible, true, 'normal interactive model should remain available');
assert.equal(liveDreamEligibility({ ...live, id: 'google/gemini-flash-current:free' }).eligible, true, ':free interactive variants must remain available');
assert.equal(liveDreamEligibility({ ...live, id: 'google/gemini-flash-current:nitro' }).eligible, true, ':nitro interactive variants must remain available');
assert.deepEqual(liveDreamEligibility({ ...live, id: 'google/gemini-flash-current:batch', name: 'Google: Gemini Flash Current (batch)' }).reason, 'BATCH_ONLY');
assert.deepEqual(liveDreamEligibility({ ...live, expiration_date: '2026-08-31' }, Date.parse('2026-09-01T12:00:00Z')).reason, 'EXPIRED');
assert.equal(liveDreamEligibility({ ...live, expiration_date: '2026-09-02' }, Date.parse('2026-09-01T12:00:00Z')).eligible, true, 'future expiration must not hide a currently live model');
assert.deepEqual(liveDreamEligibility({ ...live, architecture: { output_modalities: ['image'] } }).reason, 'NO_TEXT_OUTPUT');
assert.deepEqual(liveDreamEligibility({ ...live, top_provider: { max_completion_tokens: 1024 } }).reason, 'OUTPUT_TOO_SMALL');

const filtered = filterLiveDreamModels([
  live,
  { ...live, id: 'google/gemini-flash-current:batch', name: 'Google: Gemini Flash Current (batch)' },
  { ...live, id: 'old/model', expiration_date: '2020-01-01' },
]);
assert.deepEqual(filtered.map(model => model.id), [live.id], 'picker catalog must contain only live Dream-compatible models');

console.log('Model eligibility contract: PASS');
