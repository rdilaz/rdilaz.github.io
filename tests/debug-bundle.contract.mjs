import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebugBundle, debugBundleText, DEBUG_BUNDLE_SCHEMA } from '../public/visualizer/debug-bundle.js';

function exportWith(records) {
  return { schema: 'dream-diagnostic-export-v1', exportedAt: '2026-09-01T00:00:00.000Z', records };
}

test('debug bundle selects the latest real generation instead of a later recovery record', () => {
  const generation = {
    id: 'dream-1',
    kind: 'generation',
    createdAt: 1000,
    status: 'failed',
    modelId: 'moonshotai/kimi-k3',
    modelName: 'Kimi K3',
    failureCode: 'PROVIDER_OR_PIPELINE_FAILURE',
    failureMessage: 'returned no visualizer code',
    trace: { id: 'trace-1', attempts: [{ number: 1 }] },
  };
  const recovery = {
    id: 'recovery-1',
    kind: 'automatic-recovery',
    createdAt: 1100,
    status: 'succeeded',
    modelId: 'built-in/calibration-bloom',
    modelName: 'Calibration Bloom',
  };
  const bundle = createDebugBundle({
    identity: { live: { displayName: 'Calibration Bloom' }, next: { displayName: 'Kimi K3' } },
    runtime: { currentModel: 'Calibration Bloom' },
    diagnosticExport: exportWith([recovery, generation]),
    capturedAt: 2000,
  });

  assert.equal(bundle.schema, DEBUG_BUNDLE_SCHEMA);
  assert.equal(bundle.primaryDream.id, 'dream-1');
  assert.equal(bundle.primaryDream.failureCode, 'PROVIDER_OR_PIPELINE_FAILURE');
  assert.equal(bundle.latestRecordWhenDifferent.id, 'recovery-1');
  assert.equal(bundle.relatedRecords[0].id, 'recovery-1');
  assert.match(bundle.interpretationHint, /Kimi K3.*failed.*PROVIDER_OR_PIPELINE_FAILURE/);
});

test('debug bundle recursively strips credentials and audio payloads', () => {
  const bundle = createDebugBundle({
    runtime: {
      authorization: 'Bearer SENTINEL_SECRET_ABC',
      activeEvents: [{ waveform: [1, 2], spectrum: [3, 4], tokenCount: 17 }],
    },
    diagnosticExport: exportWith([{
      id: 'dream-2',
      kind: 'generation',
      createdAt: 1000,
      status: 'failed',
      apiKey: 'sk-or-v1-SENTINEL_SECRET_ABC',
      trace: {
        attempts: [{ request: { headers: { authorization: 'Bearer SENTINEL_SECRET_ABC' } } }],
      },
    }]),
    capturedAt: 2000,
  });
  const serialized = JSON.stringify(bundle);
  assert.doesNotMatch(serialized, /SENTINEL_SECRET_ABC/);
  assert.doesNotMatch(serialized, /waveform|spectrum|apiKey/i);
  assert.match(serialized, /tokenCount/);
});

test('copy text is visibly delimited and paste-ready', () => {
  const bundle = createDebugBundle({ diagnosticExport: exportWith([]), capturedAt: 2000 });
  const text = debugBundleText(bundle);
  assert.match(text, /^=== AI VISUALIZER DEBUG BUNDLE v1 ===/);
  assert.match(text, /Paste this entire block into ChatGPT\./);
  assert.match(text, /visualizer-debug-bundle-v1/);
  assert.match(text, /=== END AI VISUALIZER DEBUG BUNDLE ===$/);
});

test('runtime backpressure evidence remains compact and non-sensitive', () => {
  const frameDelivery = {
    receivedFrames: 42,
    deliveredFrames: 30,
    coalescedFrames: 11,
    droppedFrames: 1,
    inFlightFrames: 1,
    pendingFrames: 1,
    inFlightSequence: 41,
    pendingSequence: 42,
    lastSettledSequence: 40,
    blockedByFatal: false,
  };
  const bundle = createDebugBundle({
    runtime: {
      renderQuality: { vizFrameDeliveries: 42, deliveryGate: { maxFps: 30 } },
      frameDelivery,
    },
    diagnosticExport: exportWith([]),
    capturedAt: 2000,
  });
  assert.deepEqual(bundle.runtime.frameDelivery, frameDelivery);
  assert.deepEqual(bundle.runtime.renderQuality, { vizFrameDeliveries: 42, deliveryGate: { maxFps: 30 } });
});
