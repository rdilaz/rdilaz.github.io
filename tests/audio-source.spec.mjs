import { expect, test } from '@playwright/test';

async function blockProviderCompletions(page) {
  const state = { completions: 0 };
  await page.route('https://openrouter.ai/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/v1/chat/completions') state.completions += 1;
    await route.abort('blockedbyclient');
  });
  return state;
}

async function installAudioFixture(page, {
  display = true,
  microphone = true,
  channels = 1,
  permissionError = '',
  noAudio = false,
} = {}) {
  await page.addInitScript(config => {
    class FakeNode {
      constructor() {
        this.disconnectCount = 0;
      }

      connect() {}
      disconnect() { this.disconnectCount += 1; }
    }

    class FakeAnalyser extends FakeNode {
      constructor(index) {
        super();
        this.index = index;
        this._fftSize = 2048;
        this.frequencyBinCount = 1024;
      }

      set fftSize(value) {
        this._fftSize = value;
        this.frequencyBinCount = value / 2;
      }

      get fftSize() { return this._fftSize; }
      getByteFrequencyData(target) { target.fill(90); }
      getFloatTimeDomainData(target) {
        const amplitude = this.index === 2 ? .08 : this.index === 3 ? .28 : .2;
        for (let index = 0; index < target.length; index += 1) target[index] = Math.sin(index / 4) * amplitude;
      }
    }

    class FakeTrack {
      constructor(kind, settings = {}) {
        this.kind = kind;
        this.enabled = true;
        this.settings = settings;
        this.stopCount = 0;
        this.listeners = new Map();
      }

      getSettings() { return { ...this.settings }; }
      getCapabilities() { return { channelCount: { min: 1, max: this.settings.channelCount || 1 } }; }
      addEventListener(type, listener) { this.listeners.set(type, listener); }
      removeEventListener(type, listener) {
        if (this.listeners.get(type) === listener) this.listeners.delete(type);
      }
      stop() { this.stopCount += 1; }
      end() { this.listeners.get('ended')?.(); }
    }

    class FakeStream {
      constructor(audioTrack, videoTrack) {
        this.audioTrack = audioTrack;
        this.videoTrack = videoTrack;
      }

      getAudioTracks() { return this.audioTrack ? [this.audioTrack] : []; }
      getVideoTracks() { return this.videoTrack ? [this.videoTrack] : []; }
      getTracks() { return [...this.getAudioTracks(), ...this.getVideoTracks()]; }
    }

    class FakeAudioContext {
      constructor() {
        this.sampleRate = 48000;
        this.state = 'suspended';
        this.source = new FakeNode();
        this.nodes = [this.source];
        this.analyserCount = 0;
        this.closeCount = 0;
        window.__audioFixture.contexts.push(this);
      }

      createMediaStreamSource() { return this.source; }
      createAnalyser() {
        const node = new FakeAnalyser(this.analyserCount++);
        this.nodes.push(node);
        return node;
      }
      createChannelSplitter() {
        const node = new FakeNode();
        this.nodes.push(node);
        return node;
      }
      async resume() { this.state = 'running'; }
      async close() { this.closeCount += 1; this.state = 'closed'; }
    }

    const state = {
      userMediaCalls: [],
      displayMediaCalls: [],
      streams: [],
      contexts: [],
      latestAudioTrack: null,
      permissionError: config.permissionError,
      noAudio: config.noAudio,
    };
    window.__audioFixture = state;
    const makeStream = sourceKind => {
      const audioTrack = state.noAudio ? null : new FakeTrack('audio', {
        channelCount: config.channels,
        sampleRate: 44100,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        deviceId: 'private-device-id',
        groupId: 'private-group-id',
      });
      const videoTrack = sourceKind === 'display' ? new FakeTrack('video') : null;
      const stream = new FakeStream(audioTrack, videoTrack);
      state.latestAudioTrack = audioTrack;
      state.streams.push(stream);
      return stream;
    };
    const mediaDevices = {
      getSupportedConstraints: () => ({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: true,
        sampleRate: true,
        latency: true,
        voiceIsolation: true,
      }),
    };
    if (config.microphone) {
      mediaDevices.getUserMedia = async constraints => {
        state.userMediaCalls.push(structuredClone(constraints));
        if (state.permissionError) throw new DOMException('fixture denied', state.permissionError);
        return makeStream('microphone');
      };
    }
    if (config.display) {
      mediaDevices.getDisplayMedia = async constraints => {
        state.displayMediaCalls.push(structuredClone(constraints));
        return makeStream('display');
      };
    }
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  }, { display, microphone, channels, permissionError, noAudio });
}

async function openVisualizer(page) {
  await page.goto('/visualizer/index.html?dev=1');
  await expect.poll(() => page.evaluate(() => typeof window.VIZ_DEV)).toBe('object');
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
}

test('390x844 source chooser is mobile-first, immersive-safe, tappable, and restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const provider = await blockProviderCompletions(page);
  await installAudioFixture(page);
  await openVisualizer(page);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioPicker')).toBeVisible();
  await expect(page.locator('#audioMicrophoneOption')).toBeVisible();
  await expect(page.locator('#audioMicrophoneOption')).toBeFocused();
  const bounds = await page.locator('#audioPicker').boundingBox();
  const microphoneBounds = await page.locator('#audioMicrophoneOption').boundingBox();
  const displayBounds = await page.locator('#audioDisplayOption').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  expect(microphoneBounds.y).toBeLessThan(displayBounds.y);
  expect(microphoneBounds.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => window.VIZ_DEV.immersive().blocker)).toBe('dialog-open');
  await page.waitForTimeout(3200);
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);
  await page.locator('#audioPickerClose').click();
  await expect(page.locator('#audioPicker')).toBeHidden();
  await expect(page.locator('#audioButton')).toBeFocused();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-expanded', 'false');
  expect(provider.completions).toBe(0);
});

test('360px chooser remains reachable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  const provider = await blockProviderCompletions(page);
  await installAudioFixture(page, { display: false, microphone: true });
  await openVisualizer(page);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioMicrophoneOption')).toBeVisible();
  await expect(page.locator('#audioDisplayOption')).toBeHidden();
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    picker: document.getElementById('audioPicker').getBoundingClientRect().toJSON(),
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  expect(layout.picker.left).toBeGreaterThanOrEqual(0);
  expect(layout.picker.right).toBeLessThanOrEqual(360);
  expect(provider.completions).toBe(0);
});

test('microphone choice is local, music-friendly, mono-safe, diagnostic-safe, and leak-free', async ({ page }) => {
  const provider = await blockProviderCompletions(page);
  await installAudioFixture(page, { channels: 1 });
  await openVisualizer(page);
  const messagesBefore = await page.evaluate(async () => JSON.stringify((await import('/visualizer/prompt.js')).buildGenerationMessages()));
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await page.locator('#audioButton').click();
    await page.locator('#audioMicrophoneOption').click();
    await expect(page.locator('#audioButtonLabel')).toHaveText('Microphone connected');
    const evidence = await page.evaluate(() => ({
      userMediaCalls: window.__audioFixture.userMediaCalls,
      displayCalls: window.__audioFixture.displayMediaCalls.length,
      audio: window.VIZ_DEV.state().audio,
      identity: window.VIZ_DEV.identity().live,
    }));
    expect(evidence.userMediaCalls.at(-1)).toEqual({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
    });
    expect(evidence.displayCalls).toBe(0);
    expect(evidence.audio).toMatchObject({
      connected: true,
      sourceKind: 'microphone',
      effectiveChannelCount: 1,
      effectiveSampleRate: 44100,
      connectionReason: 'connected',
    });
    expect(evidence.identity.displayName).toBe('Calibration Bloom');
    expect(JSON.stringify(evidence.audio)).not.toMatch(/deviceId|groupId|waveform|spectrum|private-/i);
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButtonLabel')).toHaveText('Connect audio');
  }
  const cleanup = await page.evaluate(() => ({
    tracks: window.__audioFixture.streams.map(stream => stream.audioTrack?.stopCount),
    contexts: window.__audioFixture.contexts.map(context => ({
      closeCount: context.closeCount,
      disconnected: context.nodes.every(node => node.disconnectCount === 1),
    })),
  }));
  expect(cleanup.tracks).toEqual([1, 1]);
  expect(cleanup.contexts).toEqual([
    { closeCount: 1, disconnected: true },
    { closeCount: 1, disconnected: true },
  ]);
  const messagesAfter = await page.evaluate(async () => JSON.stringify((await import('/visualizer/prompt.js')).buildGenerationMessages()));
  expect(messagesAfter).toBe(messagesBefore);
  expect(provider.completions).toBe(0);
});

test('mono microphone VIZ remains viable across both model-generated Featured Dreams', async ({ page }) => {
  test.setTimeout(80000);
  const provider = await blockProviderCompletions(page);
  await installAudioFixture(page, { channels: 1 });
  await openVisualizer(page);
  await page.locator('#audioButton').click();
  await page.locator('#audioMicrophoneOption').click();
  await expect(page.locator('#audioButtonLabel')).toHaveText('Microphone connected');

  const assertActiveFeatured = async title => {
    await expect(page.locator('#liveIdentityName')).toHaveText(title, { timeout: 30000 });
    const evidence = await page.evaluate(async label => ({
      audio: window.VIZ_DEV.state().audio,
      probe: await window.VIZ_DEV.probeActive(label),
    }), `mono-featured-${title}`);
    expect(evidence.audio).toMatchObject({ connected: true, sourceKind: 'microphone', effectiveChannelCount: 1 });
    expect(evidence.probe.viz.consumed).toBe(true);
    expect(evidence.probe.visual.visibleProof).toBe(true);
    expect(evidence.probe.events.filter(event => event.severity === 'fatal')).toEqual([]);
  };

  await assertActiveFeatured('Calibration Bloom');
  await page.mouse.move(12, 12);
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);
  await page.locator('#switcherButton').click();
  await page.locator('[data-dream-key="featured:aural-cymatics-genesis"] .dream-switcher__choose').click();
  await assertActiveFeatured('Aural Cymatics: Genesis of Harmonic Form');
  await page.mouse.move(180, 160);
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);
  await page.locator('#switcherButton').click();
  await page.locator('[data-dream-key="featured:klangfiguren"] .dream-switcher__choose').click();
  await assertActiveFeatured('Klangfiguren');
  await page.mouse.move(340, 260);
  await expect(page.locator('body')).not.toHaveClass(/ui-hidden/);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButtonLabel')).toHaveText('Connect audio');
  expect(provider.completions).toBe(0);
});

test('desktop direct share stays first, preserves preferred call shape, and never requests microphone', async ({ page }) => {
  const provider = await blockProviderCompletions(page);
  await installAudioFixture(page, { channels: 2 });
  await openVisualizer(page);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioDisplayOption')).toBeFocused();
  await page.locator('#audioDisplayOption').click();
  await expect(page.locator('#audioButtonLabel')).toHaveText('Audio connected');
  const evidence = await page.evaluate(() => ({
    displayCalls: window.__audioFixture.displayMediaCalls,
    microphoneCalls: window.__audioFixture.userMediaCalls.length,
    audio: window.VIZ_DEV.state().audio,
    videoEnabled: window.__audioFixture.streams[0].videoTrack.enabled,
  }));
  expect(evidence.displayCalls).toHaveLength(1);
  expect(evidence.displayCalls[0]).toMatchObject({
    audioSelection: 'preferred',
    systemAudio: 'include',
    windowAudio: 'system',
    audio: { suppressLocalAudioPlayback: false },
  });
  expect(evidence.microphoneCalls).toBe(0);
  expect(evidence.videoEnabled).toBe(false);
  expect(evidence.audio).toMatchObject({ sourceKind: 'display', effectiveChannelCount: 2 });
  expect(provider.completions).toBe(0);
});

test('permission denial and empty microphone stream fail without changing LIVE', async ({ page }) => {
  const provider = await blockProviderCompletions(page);
  await installAudioFixture(page, { display: false, permissionError: 'NotAllowedError' });
  await openVisualizer(page);
  await page.locator('#audioButton').click();
  await page.locator('#audioMicrophoneOption').click();
  await expect(page.locator('#toast')).toContainText('Microphone permission was not granted');
  await expect(page.locator('#audioButtonLabel')).toHaveText('Connect audio');
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  expect(await page.evaluate(() => window.__audioFixture.contexts.length)).toBe(0);
  expect(provider.completions).toBe(0);

  await page.evaluate(() => {
    window.__audioFixture.permissionError = '';
    window.__audioFixture.noAudio = true;
  });
  await page.locator('#audioButton').click();
  await page.locator('#audioMicrophoneOption').click();
  await expect(page.locator('#toast')).toContainText('did not include audio');
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  expect(provider.completions).toBe(0);
});

test('track-ended and unavailable capability states remain truthful with zero provider calls', async ({ page }) => {
  const provider = await blockProviderCompletions(page);
  await installAudioFixture(page, { display: false, microphone: true });
  await openVisualizer(page);
  await page.locator('#audioButton').click();
  await page.locator('#audioMicrophoneOption').click();
  await expect(page.locator('#audioButtonLabel')).toHaveText('Microphone connected');
  await page.evaluate(() => window.__audioFixture.latestAudioTrack.end());
  await expect(page.locator('#audioButtonLabel')).toHaveText('Connect audio');
  await expect(page.locator('#toast')).toContainText('Audio source ended');
  await expect(page.locator('#liveIdentityName')).toHaveText('Calibration Bloom');
  expect(provider.completions).toBe(0);
});

test('neither capture API produces a compact unavailable state without permission requests', async ({ page }) => {
  const provider = await blockProviderCompletions(page);
  await installAudioFixture(page, { display: false, microphone: false });
  await openVisualizer(page);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioUnavailable')).toBeVisible();
  await expect(page.locator('#audioDisplayOption')).toBeHidden();
  await expect(page.locator('#audioMicrophoneOption')).toBeHidden();
  expect(await page.evaluate(() => ({
    microphone: window.__audioFixture.userMediaCalls.length,
    display: window.__audioFixture.displayMediaCalls.length,
  }))).toEqual({ microphone: 0, display: 0 });
  expect(provider.completions).toBe(0);
});
