const LEGACY_NOT_CAPTURED = 'Not captured by this app version.';
const REASONING_NOT_EXPOSED = 'Reasoning not exposed by provider.';
const REASONING_TEXT_NOT_EXPOSED = 'Reasoning text not exposed by provider.';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPresent(value) {
  return value !== null && value !== undefined;
}

function hasOwn(record, key) {
  return isRecord(record) && Object.prototype.hasOwnProperty.call(record, key);
}

function firstPresent(...values) {
  return values.find(isPresent);
}

function jsonText(value) {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return typeof serialized === 'string' ? serialized : '';
  } catch {
    return '[Captured value could not be serialized.]';
  }
}

function exactText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return LEGACY_NOT_CAPTURED;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return jsonText(value);
}

function traceJson(trace) {
  const serialized = JSON.stringify(trace, null, 2);
  if (typeof serialized !== 'string') throw new TypeError('The Dream Trace could not be serialized.');
  return serialized;
}

function lineCount(value) {
  if (!value) return 0;
  return (value.match(/\r\n|\r|\n/g)?.length || 0) + 1;
}

function byteCount(value) {
  return new TextEncoder().encode(value).byteLength;
}

function formatTimestamp(value) {
  if (!isPresent(value) || value === '') return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return exactText(value);
  return date.toISOString();
}

function formatModel(model) {
  if (!isPresent(model)) return 'Not recorded';
  if (typeof model === 'string') return model;
  if (!isRecord(model)) return exactText(model);
  const name = firstPresent(model.displayName, model.name, model.modelName);
  const id = firstPresent(model.id, model.modelId, model.requestedModelId);
  if (isPresent(name) && isPresent(id) && String(name) !== String(id)) return `${exactText(name)} (${exactText(id)})`;
  if (isPresent(name) || isPresent(id)) return exactText(firstPresent(name, id));
  return jsonText(model);
}

function formatIdentity(identity) {
  if (!isPresent(identity)) return 'Not recorded';
  if (typeof identity === 'string') return identity;
  if (!isRecord(identity)) return exactText(identity);

  const value = isRecord(identity.live) ? identity.live : identity;
  const display = firstPresent(value.display, value.displayName, value.label);
  if (isPresent(display)) return exactText(display);

  const name = firstPresent(value.modelName, value.name, value.title, value.modelId, value.id);
  const marker = firstPresent(value.marker, value.shortId);
  if (isPresent(name) && isPresent(marker)) return `${exactText(name)} · #${String(marker).replace(/^#/, '')}`;
  if (isPresent(name)) return exactText(name);
  return jsonText(value);
}

function tokenValue(usage, snakeName, camelName) {
  if (!isRecord(usage)) return undefined;
  return firstPresent(usage[snakeName], usage[camelName]);
}

function formatUsage(usage) {
  if (!isPresent(usage)) return 'Not reported';
  if (!isRecord(usage)) return exactText(usage);

  const prompt = tokenValue(usage, 'prompt_tokens', 'promptTokens');
  const completion = tokenValue(usage, 'completion_tokens', 'completionTokens');
  const total = tokenValue(usage, 'total_tokens', 'totalTokens');
  const parts = [];
  if (isPresent(prompt)) parts.push(`${exactText(prompt)} prompt`);
  if (isPresent(completion)) parts.push(`${exactText(completion)} completion`);
  if (isPresent(total)) parts.push(`${exactText(total)} total`);
  return parts.length ? `${parts.join(' · ')} tokens` : jsonText(usage);
}

function formatCost(cost) {
  if (!isPresent(cost)) return 'Not reported';
  if (typeof cost === 'number' || typeof cost === 'bigint') return `$${String(cost)}`;
  if (typeof cost === 'string') return cost.startsWith('$') ? cost : `$${cost}`;
  return jsonText(cost);
}

function roleLabel(message) {
  const role = String(isRecord(message) ? message.role || '' : '').toLowerCase();
  if (role === 'system') return 'SYSTEM';
  if (role === 'user') return 'USER';
  if (role === 'assistant') return 'ASSISTANT';
  return 'MESSAGE';
}

function messageContent(message) {
  if (!isRecord(message) || !hasOwn(message, 'content') || message.content === null) return LEGACY_NOT_CAPTURED;
  return exactText(message.content);
}

function requestMessages(attempt) {
  if (!isRecord(attempt?.request) || !Array.isArray(attempt.request.messages)) return null;
  return attempt.request.messages;
}

function hasLegacyRequestNotice(attempt) {
  const request = attempt?.request;
  return !isRecord(request)
    || request.messages === null
    || request.messagesNotice === LEGACY_NOT_CAPTURED
    || request.notCaptured === LEGACY_NOT_CAPTURED;
}

function requestTranscript(messages) {
  return messages.map(message => `${roleLabel(message)}\n${messageContent(message)}`).join('\n\n');
}

function hasResponseCapture(attempt) {
  const request = attempt?.request;
  const response = attempt?.response;
  if (!isRecord(response)) return false;
  return request?.captured === true
    || request?.dispatched === true
    || isPresent(response.httpStatus)
    || isPresent(response.status)
    || isPresent(response.parsedPayload)
    || isPresent(response.payload)
    || (typeof response.rawBodyText === 'string' && response.rawBodyText.length > 0)
    || (typeof response.rawBody === 'string' && response.rawBody.length > 0)
    || isPresent(response.error);
}

function assistantCapture(attempt) {
  const response = attempt?.response;
  if (!isRecord(response)) return { present: false, value: LEGACY_NOT_CAPTURED };
  if (hasOwn(response, 'assistantText') && response.assistantText !== null && response.assistantText !== undefined) {
    if (response.assistantText === '' && !hasResponseCapture(attempt)) {
      return { present: false, value: LEGACY_NOT_CAPTURED };
    }
    return { present: true, value: exactText(response.assistantText) };
  }
  if (!hasOwn(response, 'assistantText')) {
    const output = firstPresent(response.rawVisualizerOutput, response.rawOutput);
    if (isPresent(output) && (output !== '' || hasResponseCapture(attempt))) {
      return { present: true, value: exactText(output) };
    }
  }
  return { present: false, value: LEGACY_NOT_CAPTURED };
}

function capturedField(record, key, { allowEmpty = true } = {}) {
  if (!hasOwn(record, key) || record[key] === null || record[key] === undefined || (!allowEmpty && record[key] === '')) {
    return { present: false, value: LEGACY_NOT_CAPTURED };
  }
  return { present: true, value: exactText(record[key]), raw: record[key] };
}

function capturedResponseField(attempt, keys) {
  const response = attempt?.response;
  if (!isRecord(response)) return { present: false, value: LEGACY_NOT_CAPTURED };
  for (const key of keys) {
    if (!hasOwn(response, key) || response[key] === null || response[key] === undefined) continue;
    if (response[key] === '' && !hasResponseCapture(attempt)) continue;
    return { present: true, value: exactText(response[key]), raw: response[key], key };
  }
  return { present: false, value: LEGACY_NOT_CAPTURED };
}

function requestModel(attempt) {
  return firstPresent(
    attempt?.request?.model,
    attempt?.request?.modelId,
    attempt?.identity?.requestedModelId,
    attempt?.identity?.selectedModelId,
  );
}

function resolvedModel(attempt) {
  return firstPresent(
    attempt?.response?.resolvedModel,
    attempt?.identity?.resolvedModel,
  );
}

function providerRequestId(attempt) {
  return firstPresent(
    attempt?.response?.requestId,
    attempt?.identity?.providerRequestId,
    attempt?.identity?.requestId,
  );
}

function maxTokens(request) {
  return firstPresent(
    request?.max_tokens,
    request?.maxTokens,
    request?.parameters?.max_tokens,
    request?.parameters?.maxTokens,
    request?.body?.max_tokens,
  );
}

function serializedRequestBody(request) {
  return firstPresent(
    request?.serializedBody,
    request?.bodyText,
    request?.rawBodyText,
  );
}

function lastUserMessage(attempt) {
  const messages = requestMessages(attempt);
  if (!messages) return null;
  const message = [...messages].reverse().find(item => String(item?.role || '').toLowerCase() === 'user');
  if (!message || !hasOwn(message, 'content') || message.content === null) return null;
  return exactText(message.content);
}

function repairPromptFor(attempt, attempts) {
  const explicit = firstPresent(attempt?.request?.repairPrompt, attempt?.request?.repairPromptText);
  if (isPresent(explicit) && explicit !== '') return { present: true, value: exactText(explicit) };

  const repairAttempt = String(attempt?.kind || '').toLowerCase() === 'repair'
    ? attempt
    : attempts.find(candidate => (
      Number(candidate?.number) > Number(attempt?.number)
      && String(candidate?.kind || '').toLowerCase() === 'repair'
    ));
  const userPrompt = repairAttempt ? lastUserMessage(repairAttempt) : null;
  if (isPresent(userPrompt)) return { present: true, value: userPrompt };

  return { present: false, value: LEGACY_NOT_CAPTURED };
}

function reasoningTokenCount(response) {
  const reasoning = response?.reasoning;
  const usage = response?.usage;
  const parsedUsage = response?.parsedPayload?.usage;
  return firstPresent(
    reasoning?.reasoningTokens,
    reasoning?.reasoningTokenCount,
    reasoning?.tokenCount,
    reasoning?.tokens,
    response?.reasoningTokens,
    usage?.reasoning_tokens,
    usage?.reasoningTokens,
    usage?.completion_tokens_details?.reasoning_tokens,
    usage?.completionTokensDetails?.reasoningTokens,
    parsedUsage?.reasoning_tokens,
    parsedUsage?.reasoningTokens,
    parsedUsage?.completion_tokens_details?.reasoning_tokens,
  );
}

function meaningfulReasoning(value) {
  if (!isPresent(value)) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return typeof value !== 'boolean';
}

function reasoningView(response) {
  const reasoning = response?.reasoning;
  const tokens = reasoningTokenCount(response);
  if (!meaningfulReasoning(reasoning)) {
    return { state: isPresent(tokens) ? 'tokens-only' : 'absent', tokens, exposed: null };
  }

  if (typeof reasoning === 'string' || Array.isArray(reasoning)) {
    return { state: 'exposed', tokens, exposed: reasoning };
  }

  if (!isRecord(reasoning)) return { state: 'exposed', tokens, exposed: reasoning };

  const status = String(firstPresent(reasoning.status, reasoning.state, reasoning.kind, '')).toLowerCase();
  const candidates = [
    reasoning.exposed,
    reasoning.providerExposed,
    reasoning.exposedFields,
    reasoning.providerFields,
    reasoning.fields,
    reasoning.text,
    reasoning.details,
    reasoning.contentParts,
    reasoning.value,
    reasoning.data,
  ];
  const exposed = candidates.find(meaningfulReasoning);
  if (meaningfulReasoning(exposed)) return { state: 'exposed', tokens, exposed };

  if (status === 'not-captured') return { state: 'not-captured', tokens: null, exposed: null };
  if (/token/.test(status)) return { state: 'tokens-only', tokens, exposed: null };
  if (/not[- ]?exposed|absent|hidden|none/.test(status)) {
    return { state: 'absent', tokens, exposed: null };
  }

  const accountingKeys = new Set([
    'status',
    'state',
    'kind',
    'label',
    'exposed',
    'providerExposed',
    'hasText',
    'text',
    'details',
    'reasoningTokens',
    'reasoningTokenCount',
    'tokenCount',
    'tokens',
  ]);
  const providerEntries = Object.entries(reasoning).filter(([key]) => !accountingKeys.has(key));
  if (providerEntries.length) return { state: 'exposed', tokens, exposed: Object.fromEntries(providerEntries) };
  return { state: isPresent(tokens) ? 'tokens-only' : 'absent', tokens, exposed: null };
}

function attemptLabel(attempt, index) {
  const number = firstPresent(attempt?.number, index + 1);
  const kind = String(attempt?.kind || '').toLowerCase();
  const label = kind === 'repair' ? 'REPAIR' : 'GENERATION';
  return `ATTEMPT ${exactText(number)} · ${label}`;
}

function attemptMetadata(attempt) {
  const values = [
    attempt?.status || 'unknown',
    requestModel(attempt),
    resolvedModel(attempt),
  ].filter(isPresent).map(exactText);
  return values.join(' · ');
}

export class DreamTraceViewer {
  constructor({
    root,
    title,
    content,
    onCopy,
    onExport,
    onRetest,
    onOpenGeneration,
    onClose,
    notify,
  } = {}) {
    if (!root?.ownerDocument || typeof root.replaceChildren !== 'function') {
      throw new TypeError('DreamTraceViewer requires a DOM root element.');
    }

    this.root = root;
    this.document = root.ownerDocument;
    this.title = title || root.querySelector('#traceViewerTitle');
    this.content = content || root.querySelector('#traceViewerContent') || root;
    this.onCopy = typeof onCopy === 'function' ? onCopy : null;
    this.onExport = typeof onExport === 'function' ? onExport : null;
    this.onRetest = typeof onRetest === 'function' ? onRetest : null;
    this.onOpenGeneration = typeof onOpenGeneration === 'function' ? onOpenGeneration : null;
    this.onClose = typeof onClose === 'function' ? onClose : null;
    this.notify = typeof notify === 'function' ? notify : null;
    this.trace = null;
    this.diagnostic = null;
    this.returnFocus = null;
    this.closeButton = root.querySelector('#closeTraceViewer')
      || root.querySelector('button[aria-label="Close Dream Trace"]');

    this.closeButton?.addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || this.root.hidden) return;
      event.preventDefault();
      this.close();
    });
  }

  open(trace, { diagnostic = null } = {}) {
    if (!isRecord(trace)) throw new TypeError('DreamTraceViewer.open() requires a Dream Trace object.');

    if (this.root.hidden) {
      const activeElement = this.document.activeElement;
      this.returnFocus = activeElement && activeElement !== this.document.body ? activeElement : null;
    }

    this.trace = trace;
    this.diagnostic = diagnostic;
    if (this.title) this.title.textContent = 'Dream trace';
    this._render();
    this.root.hidden = false;
    this.closeButton?.focus();
    return this.trace;
  }

  close() {
    if (!this.trace && this.root.hidden) return;
    const trace = this.trace;
    const diagnostic = this.diagnostic;
    const returnFocus = this.returnFocus;

    this.root.hidden = true;
    this.content.replaceChildren();
    if (this.title) this.title.textContent = 'Dream trace';
    this.trace = null;
    this.diagnostic = null;
    this.returnFocus = null;

    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus();
    if (this.onClose) {
      try {
        this.onClose(trace, diagnostic);
      } catch (error) {
        this._notifyFailure(error);
      }
    }
  }

  current() {
    return this.trace;
  }

  _notify(message) {
    if (!this.notify) return;
    try {
      this.notify(message);
    } catch {
      // Notifications are best-effort and must not break trace inspection.
    }
  }

  _notifyFailure(error) {
    const detail = typeof error?.message === 'string' && error.message ? ` ${error.message}` : '';
    this._notify(`Dream Trace action failed.${detail}`);
  }

  _actions() {
    const actions = this.document.createElement('div');
    actions.className = 'dream-trace-viewer__actions';
    return actions;
  }

  _button(label, { available = true, action, successMessage } = {}) {
    const button = this.document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = !available || typeof action !== 'function';
    if (!button.disabled) {
      button.addEventListener('click', () => {
        void this._runAction(button, action, successMessage);
      });
    }
    return button;
  }

  async _runAction(button, action, successMessage) {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      await action();
      if (successMessage) this._notify(successMessage);
    } catch (error) {
      this._notifyFailure(error);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    }
  }

  _copyButton(label, value, { available = true, context, successMessage } = {}) {
    return this._button(label, {
      available: available && Boolean(this.onCopy),
      action: () => this.onCopy(value, {
        ...context,
        trace: this.trace,
        diagnostic: this.diagnostic,
      }),
      successMessage,
    });
  }

  _appendFact(container, label, value) {
    const row = this.document.createElement('p');
    const name = this.document.createElement('strong');
    const text = this.document.createElement('span');
    name.textContent = `${label}: `;
    text.textContent = exactText(value);
    row.append(name, text);
    container.appendChild(row);
  }

  _appendNotice(container, message) {
    const notice = this.document.createElement('p');
    notice.className = 'dream-trace-viewer__meta';
    notice.textContent = message;
    container.appendChild(notice);
  }

  _appendTextBlock(container, label, value) {
    const text = exactText(value);
    const block = this.document.createElement('section');
    const heading = this.document.createElement('h4');
    const metadata = this.document.createElement('small');
    const pre = this.document.createElement('pre');
    const code = this.document.createElement('code');

    heading.textContent = label;
    metadata.textContent = `${lineCount(text)} lines · ${byteCount(text)} bytes`;
    code.textContent = text;
    pre.appendChild(code);
    block.append(heading, metadata, pre);
    container.appendChild(block);
  }

  _appendMessage(container, label, value, { captured, context } = {}) {
    const message = this.document.createElement('article');
    message.className = 'dream-trace-viewer__message';
    const head = this.document.createElement('div');
    head.className = 'dream-trace-viewer__message-head';
    const role = this.document.createElement('strong');
    role.textContent = label;
    const copy = this._copyButton('Copy message', value, {
      available: captured,
      context,
      successMessage: 'Copied conversation message.',
    });
    head.append(role, copy);
    message.appendChild(head);

    const metadata = this.document.createElement('small');
    metadata.textContent = captured
      ? `${lineCount(value)} lines · ${byteCount(value)} bytes`
      : LEGACY_NOT_CAPTURED;
    message.appendChild(metadata);

    const pre = this.document.createElement('pre');
    const code = this.document.createElement('code');
    code.textContent = value;
    pre.appendChild(code);
    message.appendChild(pre);
    container.appendChild(message);
  }

  _details(label, build, actions = null) {
    const details = this.document.createElement('details');
    const summary = this.document.createElement('summary');
    summary.textContent = label;
    details.appendChild(summary);

    let built = false;
    details.addEventListener('toggle', () => {
      if (!details.open || built) return;
      built = true;
      const body = this.document.createElement('div');
      try {
        build(body);
      } catch {
        this._appendNotice(body, 'This captured section could not be displayed.');
      }
      details.appendChild(body);
    });
    if (!actions) return details;

    const disclosure = this.document.createElement('section');
    disclosure.className = 'dream-trace-viewer__disclosure';
    disclosure.append(actions, details);
    return disclosure;
  }

  _render() {
    const trace = this.trace;
    const attempts = Array.isArray(trace.attempts) ? trace.attempts : [];
    const fragment = this.document.createDocumentFragment();

    fragment.appendChild(this._overview(trace));
    fragment.appendChild(this._traceActions(trace));

    if (!attempts.length) this._appendNotice(fragment, LEGACY_NOT_CAPTURED);
    attempts.forEach((attempt, index) => fragment.appendChild(this._attempt(attempt, index, attempts)));

    fragment.appendChild(this._timeline(trace, attempts));
    fragment.appendChild(this._rawJson(trace));
    this.content.replaceChildren(fragment);
  }

  _overview(trace) {
    const overview = this.document.createElement('section');
    overview.className = 'dream-trace-viewer__overview';
    const heading = this.document.createElement('h4');
    heading.textContent = 'Overview';
    overview.appendChild(heading);

    this._appendFact(overview, 'Trace', firstPresent(trace.id, 'Not recorded'));
    this._appendFact(overview, 'Status', firstPresent(trace.status, 'unknown'));
    this._appendFact(overview, 'Started', formatTimestamp(trace.startedAt));
    this._appendFact(overview, 'Selected model', formatModel(trace.selectedModel));
    this._appendFact(overview, 'Initial LIVE', formatIdentity(firstPresent(trace.initialLiveIdentity, trace.liveAtStart)));
    this._appendFact(overview, 'Final LIVE', formatIdentity(trace.finalLiveIdentity));
    this._appendFact(overview, 'Provider requests', trace.legacy ? LEGACY_NOT_CAPTURED : firstPresent(trace.providerRequestCount, 0));
    this._appendFact(overview, 'Total usage', formatUsage(trace.totalUsage));
    this._appendFact(overview, 'Reported cost', formatCost(trace.totalReportedCost));
    this._appendFact(overview, 'Final saved Dream', firstPresent(trace.finalGenerationId, 'None'));

    const traceFailure = firstPresent(
      trace.failure,
      trace.failureCode || trace.failureMessage
        ? { code: trace.failureCode, message: trace.failureMessage }
        : null,
    );
    if (isPresent(traceFailure)) {
      const failure = isRecord(traceFailure)
        ? [traceFailure.code, traceFailure.message].filter(isPresent).map(exactText).join(' · ') || jsonText(traceFailure)
        : exactText(traceFailure);
      this._appendFact(overview, 'Failure', failure);
    }
    const captureNotice = firstPresent(trace.captureNotice, trace.legacyNotice);
    if (isPresent(captureNotice)) this._appendFact(overview, 'Capture notice', captureNotice);
    return overview;
  }

  _traceActions(trace) {
    const actions = this._actions();
    actions.append(
      this._button('Copy complete trace JSON', {
        available: Boolean(this.onCopy),
        action: () => this.onCopy(traceJson(trace), {
          kind: 'trace-json',
          trace,
          diagnostic: this.diagnostic,
        }),
        successMessage: 'Copied complete Dream Trace JSON.',
      }),
      this._button('Export trace', {
        available: Boolean(this.onExport),
        action: () => this.onExport(trace, this.diagnostic),
        successMessage: 'Exported complete Dream Trace.',
      }),
      this._button('Open saved Dream', {
        available: Boolean(this.onOpenGeneration) && isPresent(trace.finalGenerationId) && trace.finalGenerationId !== '',
        action: () => this.onOpenGeneration(trace.finalGenerationId, trace, this.diagnostic),
        successMessage: 'Opened the saved Dream.',
      }),
    );
    return actions;
  }

  _attempt(attempt, index, attempts) {
    const article = this.document.createElement('article');
    article.className = 'dream-trace-viewer__attempt';
    const heading = this.document.createElement('h4');
    heading.textContent = attemptLabel(attempt, index);
    const metadata = this.document.createElement('small');
    metadata.textContent = attemptMetadata(attempt);
    article.append(heading, metadata);

    article.append(
      this._conversation(attempt),
      this._requestDetails(attempt),
      this._providerResponse(attempt),
      this._reasoning(attempt),
      this._generatedHtml(attempt),
      this._repair(attempt, attempts),
      this._reliability(attempt),
      this._runtimeEvents(attempt),
    );
    return article;
  }

  _conversation(attempt) {
    const messages = requestMessages(attempt);
    const legacyMessages = hasLegacyRequestNotice(attempt);
    const actions = this._actions();
    actions.appendChild(this._copyButton(
      'Copy all request messages',
      messages ? requestTranscript(messages) : '',
      {
        available: !legacyMessages && Boolean(messages?.length),
        context: { kind: 'request-messages', attempt },
        successMessage: 'Copied all request messages.',
      },
    ));

    return this._details('Conversation', body => {
      if (legacyMessages) {
        this._appendNotice(body, LEGACY_NOT_CAPTURED);
      } else if (!messages.length) {
        this._appendNotice(body, 'No request messages were captured.');
      } else {
        messages.forEach((message, messageIndex) => {
          const captured = isRecord(message) && hasOwn(message, 'content') && isPresent(message.content);
          this._appendMessage(body, roleLabel(message), messageContent(message), {
            captured,
            context: { kind: 'request-message', attempt, messageIndex },
          });
        });
      }

      const assistant = assistantCapture(attempt);
      this._appendMessage(body, 'ASSISTANT / MODEL', assistant.value, {
        captured: assistant.present,
        context: { kind: 'assistant-message', attempt },
      });
    }, actions);
  }

  _requestDetails(attempt) {
    const request = attempt?.request;
    return this._details('Request details', body => {
      if (!isRecord(request)) {
        this._appendNotice(body, LEGACY_NOT_CAPTURED);
        return;
      }

      this._appendFact(body, 'Method', firstPresent(request.method, 'Not recorded'));
      this._appendFact(body, 'Endpoint', firstPresent(request.endpoint, request.endpointId, request.url, 'Not recorded'));
      this._appendFact(body, 'Requested model', firstPresent(requestModel(attempt), 'Not recorded'));
      this._appendFact(body, 'Temperature', firstPresent(request.temperature, request.parameters?.temperature, 'Not recorded'));
      this._appendFact(body, 'Final max tokens', firstPresent(maxTokens(request), 'Not recorded'));
      this._appendFact(body, 'Streaming', firstPresent(request.stream, request.parameters?.stream, 'Not recorded'));
      if (isPresent(attempt?.identity)) this._appendTextBlock(body, 'Attempt identity', attempt.identity);
      this._appendTextBlock(body, 'Captured request record', request);

      const serializedBody = serializedRequestBody(request);
      if (isPresent(serializedBody)) this._appendTextBlock(body, 'Final serialized request body', serializedBody);
    });
  }

  _providerResponse(attempt) {
    const response = attempt?.response;
    const raw = capturedResponseField(attempt, ['rawBodyText', 'rawBody']);
    const actions = this._actions();
    actions.appendChild(this._copyButton('Copy raw response', raw.value, {
      available: raw.present,
      context: { kind: 'raw-provider-response', attempt },
      successMessage: 'Copied the raw provider response.',
    }));

    return this._details('Provider response', body => {
      if (!isRecord(response)) {
        this._appendNotice(body, LEGACY_NOT_CAPTURED);
        return;
      }

      this._appendFact(body, 'HTTP status', firstPresent(response.httpStatus, response.status, 'Not recorded'));
      this._appendFact(body, 'Finish reason', firstPresent(response.finishReason, 'Not recorded'));
      this._appendFact(body, 'Resolved model', firstPresent(resolvedModel(attempt), 'Not recorded'));
      this._appendFact(body, 'Provider request ID', firstPresent(providerRequestId(attempt), 'Not recorded'));
      this._appendFact(body, 'OpenRouter generation ID', firstPresent(response.providerGenerationId, attempt?.identity?.providerGenerationId, 'Not recorded'));
      this._appendFact(body, 'Stream outcome', firstPresent(response.transport?.outcome, 'Not recorded'));
      if (isRecord(response.transport)) {
        this._appendFact(body, 'Stream activity', `${firstPresent(response.transport.chunkCount, 0)} chunks · ${firstPresent(response.transport.eventCount, 0)} events · ${firstPresent(response.transport.commentCount, 0)} keep-alives`);
      }
      this._appendFact(body, 'Usage', formatUsage(response.usage));
      this._appendFact(body, 'Reported cost', formatCost(firstPresent(response.reportedCost, response.cost, response.usage?.cost)));

      if (isPresent(response.usage)) this._appendTextBlock(body, 'Usage record', response.usage);
      if (raw.present) this._appendTextBlock(body, 'Raw response body', raw.value);
      const parsedPayload = firstPresent(response.parsedPayload, response.payload);
      if (isPresent(parsedPayload)) {
        this._appendTextBlock(body, 'Parsed provider payload', parsedPayload);
      }
      if (isPresent(response.streamAggregate)) {
        this._appendTextBlock(body, 'Normalized stream aggregate', response.streamAggregate);
      }
      if (isPresent(response.transport)) this._appendTextBlock(body, 'Stream transport evidence', response.transport);
      const assistant = assistantCapture(attempt);
      if (assistant.present) this._appendTextBlock(body, 'Assistant text', assistant.value);
      const rawVisualizerOutput = firstPresent(response.rawVisualizerOutput, response.rawOutput);
      if (isPresent(rawVisualizerOutput) && (rawVisualizerOutput !== '' || hasResponseCapture(attempt))) {
        this._appendTextBlock(body, 'Raw visualizer output', rawVisualizerOutput);
      }
    }, actions);
  }

  _reasoning(attempt) {
    const view = reasoningView(attempt?.response);
    const section = this.document.createElement('section');
    section.className = 'dream-trace-viewer__reasoning';

    if (view.state === 'not-captured') {
      this._appendNotice(section, LEGACY_NOT_CAPTURED);
    } else if (view.state === 'absent') {
      this._appendNotice(section, REASONING_NOT_EXPOSED);
    } else if (view.state === 'tokens-only') {
      this._appendNotice(section, REASONING_TEXT_NOT_EXPOSED);
      this._appendFact(section, 'Reasoning tokens', view.tokens);
    } else {
      this._appendNotice(section, 'Provider-exposed reasoning.');
      if (isPresent(view.tokens)) this._appendFact(section, 'Reasoning tokens', view.tokens);
    }

    section.appendChild(this._details('Reasoning', body => {
      if (view.state === 'not-captured') {
        this._appendNotice(body, 'No additional reasoning fields are available for this legacy trace.');
        return;
      }
      if (view.state === 'absent') {
        this._appendNotice(body, 'No provider-exposed reasoning fields were captured.');
        return;
      }
      if (view.state === 'tokens-only') {
        this._appendNotice(body, 'The token count is accounting metadata, not textual reasoning.');
        return;
      }

      this._appendNotice(body, 'Provider-exposed reasoning data. This is separate from ordinary assistant output.');
      this._appendTextBlock(body, 'Provider-exposed reasoning', view.exposed);
    }));
    return section;
  }

  _generatedHtml(attempt) {
    const html = capturedField(attempt?.response, 'extractedHtml', { allowEmpty: false });
    const actions = this._actions();
    actions.append(
      this._copyButton('Copy HTML', html.value, {
        available: html.present,
        context: { kind: 'extracted-html', attempt },
        successMessage: 'Copied the extracted HTML.',
      }),
      this._button('Retest attempt HTML', {
        available: Boolean(this.onRetest) && html.present && html.value.length > 0,
        action: () => this.onRetest(html.value, attempt, this.trace, this.diagnostic),
        successMessage: 'Completed the stored HTML retest.',
      }),
    );

    return this._details('Generated HTML', body => {
      if (!html.present) {
        this._appendNotice(body, LEGACY_NOT_CAPTURED);
        return;
      }
      this._appendNotice(body, 'Displayed as inert text. This viewer does not run the captured document.');
      this._appendTextBlock(body, 'Extracted HTML', html.value);
    }, actions);
  }

  _repair(attempt, attempts) {
    const prompt = repairPromptFor(attempt, attempts);
    const problem = capturedField(attempt?.artifact, 'repairProblem', { allowEmpty: false });
    const actions = this._actions();
    actions.appendChild(this._copyButton('Copy repair prompt', prompt.value, {
      available: prompt.present,
      context: { kind: 'repair-prompt', attempt },
      successMessage: 'Copied the repair prompt.',
    }));

    return this._details('Repair', body => {
      if (!prompt.present && !problem.present) {
        this._appendNotice(body, 'No repair was captured for this attempt.');
        return;
      }
      if (problem.present) this._appendTextBlock(body, 'Repair problem', problem.value);
      if (prompt.present && (!problem.present || prompt.value !== problem.value)) {
        this._appendTextBlock(body, 'Exact repair prompt', prompt.value);
      }
    }, actions);
  }

  _reliability(attempt) {
    const artifact = attempt?.artifact;
    return this._details('Reliability', body => {
      if (!isRecord(artifact)) {
        this._appendNotice(body, LEGACY_NOT_CAPTURED);
        return;
      }
      const report = { ...artifact };
      delete report.runtimeEvents;
      delete report.repairProblem;
      this._appendTextBlock(body, 'Artifact and reliability evidence', report);
    });
  }

  _runtimeEvents(attempt) {
    const events = attempt?.artifact?.runtimeEvents;
    return this._details('Runtime events', body => {
      if (!isPresent(events)) {
        this._appendNotice(body, LEGACY_NOT_CAPTURED);
        return;
      }
      if (Array.isArray(events) && !events.length) {
        this._appendNotice(body, 'No runtime events were recorded.');
        return;
      }
      this._appendTextBlock(body, 'Captured runtime events', events);
    });
  }

  _timeline(trace, attempts) {
    return this._details('Timeline', body => {
      const hasTraceTimeline = Array.isArray(trace.timeline) && trace.timeline.length > 0;
      const hasAttemptTimeline = attempts.some(attempt => (
        isPresent(attempt?.timing)
        || (Array.isArray(attempt?.timeline) && attempt.timeline.length > 0)
      ));
      if (!hasTraceTimeline && !hasAttemptTimeline) {
        this._appendNotice(body, LEGACY_NOT_CAPTURED);
        return;
      }
      this._appendTextBlock(body, 'Dream and attempt timeline', {
        dream: trace.timeline,
        attempts: attempts.map(attempt => ({
          number: attempt?.number,
          kind: attempt?.kind,
          timing: attempt?.timing,
          timeline: attempt?.timeline,
        })),
      });
    });
  }

  _rawJson(trace) {
    return this._details('Raw JSON', body => {
      this._appendTextBlock(body, 'Complete Dream Trace JSON', traceJson(trace));
    });
  }
}
