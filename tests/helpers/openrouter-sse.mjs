export function openRouterSseBody(payload = {}) {
  const choice = payload?.choices?.[0] || {};
  const message = choice.message || {};
  const base = {
    ...(payload.id ? { id: payload.id } : {}),
    object: 'chat.completion.chunk',
    ...(payload.created != null ? { created: payload.created } : {}),
    ...(payload.model ? { model: payload.model } : {}),
    ...(payload.provider ? { provider: payload.provider } : {}),
  };
  const events = [];
  if (payload.error || choice.error) {
    events.push({
      ...base,
      ...(payload.error ? { error: payload.error } : {}),
      choices: [{
        index: 0,
        delta: { content: '' },
        finish_reason: choice.finish_reason || 'error',
        ...(choice.native_finish_reason != null ? { native_finish_reason: choice.native_finish_reason } : {}),
        ...(choice.error ? { error: choice.error } : {}),
      }],
    });
    return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  }
  const reasoningDelta = {};
  if (message.reasoning !== undefined) reasoningDelta.reasoning = message.reasoning;
  if (message.reasoning_details !== undefined) reasoningDelta.reasoning_details = message.reasoning_details;
  if (Object.keys(reasoningDelta).length) {
    events.push({ ...base, choices: [{ index: 0, delta: { role: 'assistant', ...reasoningDelta }, finish_reason: null }] });
  }
  if (message.content !== undefined && message.content !== null) {
    events.push({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: message.content }, finish_reason: null }] });
  }
  events.push({
    ...base,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: choice.finish_reason ?? null,
      ...(choice.native_finish_reason != null ? { native_finish_reason: choice.native_finish_reason } : {}),
    }],
    ...(payload.usage ? { usage: payload.usage } : {}),
  });
  return `${events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
}

export function openRouterSseHeaders(payload = {}, requestId = '') {
  return {
    'content-type': 'text/event-stream; charset=utf-8',
    'access-control-expose-headers': 'x-request-id, x-generation-id',
    ...(requestId ? { 'x-request-id': requestId } : {}),
    ...(payload.id ? { 'x-generation-id': payload.id } : {}),
  };
}
