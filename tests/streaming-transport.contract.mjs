import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENROUTER_STREAM_COMPLETE_REASON,
  consumeOpenRouterChatStream,
} from '../public/visualizer/openrouter-sse.js';
import { createActivityTimeoutController } from '../public/visualizer/dream-transport.js';

const encoder = new TextEncoder();

function immediateResponse(chunks, headers = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk instanceof Uint8Array ? chunk : encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream', ...headers } });
}

function event(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

class FakeScheduler {
  now = 0;
  sequence = 0;
  timers = new Map();

  schedule = (callback, delay) => {
    const id = ++this.sequence;
    this.timers.set(id, { callback, due: this.now + Number(delay) });
    return id;
  };

  cancel = id => this.timers.delete(id);

  advance(ms) {
    const target = this.now + ms;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      this.now = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.now = target;
  }
}

test('fragmented OpenRouter SSE assembles content, exposed reasoning, usage, and bounded transport evidence', async () => {
  const html = '<!doctype html><html><body><canvas></canvas><script>requestAnimationFrame(()=>{})</script></body></html>';
  const transcript = [
    ': OPENROUTER PROCESSING\r\n\r\n',
    event({ id: 'gen-stream-1', model: 'model/resolved', provider: 'Provider A', choices: [{ index: 0, delta: { role: 'assistant', reasoning: '思考' }, finish_reason: null }] }),
    event({ id: 'gen-stream-1', model: 'model/resolved', choices: [{ index: 0, delta: { content: html.slice(0, 41) }, finish_reason: null }] }),
    event({ id: 'gen-stream-1', model: 'model/resolved', choices: [{ index: 0, delta: { content: html.slice(41) }, finish_reason: null }] }),
    event({ id: 'gen-stream-1', model: 'model/resolved', choices: [{ index: 0, delta: {}, finish_reason: 'stop', native_finish_reason: 'stop_sequence' }], usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18, cost: 0.0042 } }),
    'data: [DONE]\n\n',
  ].join('');
  const bytes = encoder.encode(transcript);
  const chunks = [bytes.slice(0, 17), bytes.slice(17, 89), bytes.slice(89, 173), bytes.slice(173, 311), bytes.slice(311)];
  let now = 1000;
  const result = await consumeOpenRouterChatStream(immediateResponse(chunks), {
    clock: () => ++now,
    providerGenerationId: 'gen-stream-1',
  });

  assert.equal(result.assistantText, html);
  assert.equal(result.providerGenerationId, 'gen-stream-1');
  assert.equal(result.resolvedModel, 'model/resolved');
  assert.equal(result.resolvedProvider, 'Provider A');
  assert.equal(result.streamAggregate.choices[0].message.reasoning, '思考');
  assert.equal(result.streamAggregate.choices[0].message.content, html);
  assert.equal(result.usage.cost, 0.0042);
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.nativeFinishReason, 'stop_sequence');
  assert.equal(result.transport.outcome, 'completed');
  assert.equal(result.transport.doneReceived, true);
  assert.equal(result.transport.usageReceived, true);
  assert.equal(result.transport.chunkCount, 5);
  assert.equal(result.transport.eventCount, 4);
  assert.equal(result.transport.commentCount, 1);
  assert.equal(result.transport.contentDeltaCount, 2);
  assert.equal(result.transport.reasoningDeltaCount, 1);
  assert.ok(result.transport.firstActivityAt < result.transport.streamCompletedAt);
  assert.match(result.rawBodyText, /OPENROUTER PROCESSING/);
});

test('a complete-looking partial artifact stays private until [DONE]', async () => {
  let source;
  let cancelReason = '';
  const response = new Response(new ReadableStream({
    start(controller) { source = controller; },
    cancel(reason) { cancelReason = reason; },
  }), { headers: { 'content-type': 'text/event-stream' } });
  let settled = false;
  const pending = consumeOpenRouterChatStream(response).finally(() => { settled = true; });
  source.enqueue(encoder.encode(event({ id: 'gen-private', choices: [{ delta: { content: '<!doctype html><html><body><script>0</script></body></html>' }, finish_reason: 'stop' }] })));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(settled, false);
  source.enqueue(encoder.encode(`${event({ id: 'gen-private', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0 } })}data: [DONE]\n\n`));
  const result = await pending;
  assert.equal(result.transport.doneReceived, true);
  assert.equal(cancelReason, OPENROUTER_STREAM_COMPLETE_REASON);
});

test('EOF before [DONE] is incomplete and retains only diagnostic partial text', async () => {
  const response = immediateResponse([
    event({ id: 'gen-incomplete', choices: [{ delta: { content: '<html>partial' }, finish_reason: null }] }),
  ]);
  await assert.rejects(
    consumeOpenRouterChatStream(response),
    error => {
      assert.equal(error.code, 'PROVIDER_STREAM_INCOMPLETE');
      assert.equal(error.streamResult.assistantText, '<html>partial');
      assert.equal(error.streamResult.transport.outcome, 'incomplete');
      assert.equal(error.streamResult.transport.doneReceived, false);
      return true;
    },
  );
});

test('HTTP-200 provider-declared timeouts retain a distinct stream outcome', async () => {
  const response = immediateResponse([
    event({ id: 'gen-provider-error', choices: [{ delta: { content: '<html>private' }, finish_reason: null }] }),
    event({ id: 'gen-provider-error', provider: 'Provider B', error: { code: 504, message: 'Gateway failure' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] }),
  ]);
  await assert.rejects(
    consumeOpenRouterChatStream(response),
    error => {
      assert.equal(error.code, 'PROVIDER_STREAM_ERROR');
      assert.equal(error.providerPayload.error.code, 504);
      assert.equal(error.streamResult.transport.outcome, 'provider-timeout');
      assert.equal(error.streamResult.transport.timeoutKind, 'provider');
      assert.equal(error.streamResult.assistantText, '<html>private');
      return true;
    },
  );
});

test('events after [DONE] are ignored regardless of network chunking', async () => {
  const before = event({ id: 'gen-terminal', choices: [{ delta: { content: 'BEFORE_DONE' }, finish_reason: null }] });
  const usage = event({ id: 'gen-terminal', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { cost: 0 } });
  const after = event({ id: 'gen-terminal', choices: [{ delta: { content: 'AFTER_DONE' }, finish_reason: 'stop' }], usage: { cost: 99 } });
  const result = await consumeOpenRouterChatStream(immediateResponse([`${before}${usage}data: [DONE]\n\n${after}`]), {
    providerGenerationId: 'gen-terminal',
  });
  assert.equal(result.assistantText, 'BEFORE_DONE');
  assert.equal(result.usage.cost, 0);
  assert.equal(result.transport.eventCount, 2);
});

test('contradictory generation IDs fail closed before artifact or accounting promotion', async () => {
  const response = immediateResponse([
    `${event({ id: 'gen-other', choices: [{ delta: { content: '<html>wrong identity</html>' }, finish_reason: null }] })}data: [DONE]\n\n`,
  ]);
  await assert.rejects(
    consumeOpenRouterChatStream(response, { providerGenerationId: 'gen-header' }),
    error => {
      assert.equal(error.code, 'PROVIDER_GENERATION_ID_MISMATCH');
      assert.equal(error.streamResult.transport.outcome, 'protocol-error');
      assert.equal(error.streamResult.transport.generationIdMismatch, true);
      assert.equal(error.streamResult.assistantText, '');
      return true;
    },
  );
});

test('malformed SSE data fails as a bounded protocol error', async () => {
  await assert.rejects(
    consumeOpenRouterChatStream(immediateResponse(['data: {nope}\n\n'])),
    error => {
      assert.equal(error.code, 'PROVIDER_STREAM_PROTOCOL_ERROR');
      assert.equal(error.streamResult.transport.outcome, 'protocol-error');
      return true;
    },
  );
});

test('stream activity repeatedly extends idle time beyond the former absolute boundary', () => {
  const scheduler = new FakeScheduler();
  const expirations = [];
  const timeout = createActivityTimeoutController({
    idleTimeoutMs: 100,
    hardTimeoutMs: 1000,
    clock: () => scheduler.now,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    onTimeout: kind => expirations.push(kind),
  });
  timeout.start();
  for (let index = 0; index < 6; index += 1) {
    scheduler.advance(90);
    timeout.activity();
  }
  assert.equal(scheduler.now, 540);
  assert.deepEqual(expirations, []);
  assert.equal(timeout.snapshot().active, true);
  timeout.stop();
});

test('idle and hard deadlines are distinct and first terminal state wins', () => {
  const idleScheduler = new FakeScheduler();
  const idleExpirations = [];
  const idle = createActivityTimeoutController({
    idleTimeoutMs: 100,
    hardTimeoutMs: 1000,
    clock: () => idleScheduler.now,
    schedule: idleScheduler.schedule,
    cancel: idleScheduler.cancel,
    onTimeout: kind => idleExpirations.push(kind),
  });
  idle.start();
  idleScheduler.advance(100);
  assert.deepEqual(idleExpirations, ['idle']);
  idleScheduler.advance(1000);
  assert.deepEqual(idleExpirations, ['idle']);

  const hardScheduler = new FakeScheduler();
  const hardExpirations = [];
  const hard = createActivityTimeoutController({
    idleTimeoutMs: 100,
    hardTimeoutMs: 350,
    clock: () => hardScheduler.now,
    schedule: hardScheduler.schedule,
    cancel: hardScheduler.cancel,
    onTimeout: kind => hardExpirations.push(kind),
  });
  hard.start();
  for (let index = 0; index < 3; index += 1) {
    hardScheduler.advance(90);
    hard.activity();
  }
  hardScheduler.advance(80);
  assert.deepEqual(hardExpirations, ['hard']);
  assert.equal(hard.snapshot().terminal, 'hard');
});

test('stopping the timeout for cancellation prevents later idle or hard expiry', () => {
  const scheduler = new FakeScheduler();
  const expirations = [];
  const timeout = createActivityTimeoutController({
    idleTimeoutMs: 100,
    hardTimeoutMs: 200,
    clock: () => scheduler.now,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    onTimeout: kind => expirations.push(kind),
  });
  timeout.start();
  timeout.stop('cancelled');
  scheduler.advance(1000);
  assert.deepEqual(expirations, []);
  assert.equal(timeout.snapshot().terminal, 'cancelled');
});
