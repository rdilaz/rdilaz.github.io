# Visualizer Audio API v1 and v2

Current generation identifier: `visualizer-audio-v2`.

Compatibility identifier: `visualizer-audio-v1`.

The host owns audio capture and signal interpretation. Generated visualizers never capture audio themselves.

## Capture boundary

The web version offers two explicit, user-initiated host capture paths. `navigator.mediaDevices.getDisplayMedia()` requests shared audio and hints for system/window audio where supported. The browser and operating system decide which audio sources can actually be shared. A video track is required by the browser API but the app does not render or analyze the video; the visualizer uses the audio track only.

`navigator.mediaDevices.getUserMedia()` provides the mobile fallback. It captures environmental sound through the microphone, not internal phone/system audio. The host asks for supported music-friendly processing preferences, inspects the resulting track settings, and does not record, persist, or upload microphone audio. Shared, microphone, and local-media paths feed the same browser-local V2 semantics when the running artifact declares V2.

Channel topology comes from actual track settings when reported. A confirmed stereo source retains balance/width analysis. Mono or unknown topology reports neutral stereo truth: `balance: 0` and `width: 0`.

## Version routing

New generations and their repairs use `visualizer-audio-v2`. Existing Featured Dreams, saved V1 Dreams, legacy records, and absent/malformed/unknown provenance execute as V1. The active and candidate sandbox sessions are pinned independently, so Open, preflight, retest, rollback, and restore preserve the artifact's effective contract even while V1 and V2 sessions coexist.

V1 projection reconstructs exactly the pre-milestone enumerable shape below and never adds `audio.expressive`. Existing V1 field calculations and meanings are unchanged. The generated iframe's `VIZ.version`, initial frame, reliability stimulation, and live frames all match the pinned session contract.

## V1 host frame

```js
{
  version: 'visualizer-audio-v1',
  time,
  deltaTime,
  audio: {
    connected, silence, volume, peak, transient, beat,
    tempo, tempoConfidence, spectralFlux, spectralCentroid,
    bands: { subBass, bass, lowMid, mid, highMid, treble },
    stereo: { balance, width },
    waveform, // 128 floats, approximately -1..1
    spectrum, // 96 floats, 0..1
  },
  pointer: { x, y, active, down },
  viewport: { width, height, dpr }
}
```

## Frequency bands

- `subBass`: 20–60 Hz
- `bass`: 60–180 Hz
- `lowMid`: 180–450 Hz
- `mid`: 450–1400 Hz
- `highMid`: 1400–4200 Hz
- `treble`: 4200–14000 Hz

The easy signals use adaptive normalization. The same visualizer should remain expressive across quiet masters, loud modern masters, dense mixes, sparse mixes, and large dynamic ranges. Models still receive waveform and spectrum arrays for deeper custom interpretation.

`transient` is an onset-like spectral-change signal, not a genre-specific kick detector. `tempo` is deliberately rough and remains `0` until enough consistent onset evidence exists. A visualizer must never assume tempo will be available or meaningful.

The AI receives this contract while generating code, but receives no current audio samples at generation time. During performance the completed code reads `window.VIZ.frame` or subscribes with `window.VIZ.onFrame(callback)`.

## V2 host frame

V2 retains the complete V1 frame and appends one nested fixed-shape layer:

```js
{
  version: 'visualizer-audio-v2',
  time,
  deltaTime,
  audio: {
    // Every V1 field above, unchanged.
    expressive: {
      version: 'visualizer-expressive-audio-v1',
      dynamics: {
        fast, slow, attack, release,
        quietness, silenceSeconds, crest, surge
      },
      events: {
        onset: { pulse, strength, ageSeconds },
        lowImpact: { pulse, strength, ageSeconds },
        midHit: { pulse, strength, ageSeconds },
        highSpark: { pulse, strength, ageSeconds }
      },
      rhythm: { pulse, phase, tempo, confidence },
      frequency: {
        logBands,   // exactly 24 values
        bandAttack // exactly 24 values
      }
    }
  },
  pointer: { x, y, active, down },
  viewport: { width, height, dpr }
}
```

Except `tempo`, `silenceSeconds`, and `ageSeconds`, every expressive value is finite and bounded to `0..1`. Tempo is finite, nonnegative, capped by frame normalization, and zero when unavailable. `silenceSeconds` is capped at 300 seconds; event ages are capped at 30 seconds. Arrays always contain exactly 24 finite values.

### Dynamics

- `fast`: short-timescale normalized energy with fast attack and intentional recovery.
- `slow`: long-timescale normalized energy.
- `attack`: recent positive energy movement.
- `release`: recent negative energy movement.
- `quietness`: current quiet-state strength, where one is most quiet.
- `silenceSeconds`: continuous time below the conservative silence threshold.
- `crest`: current peakiness relative to average energy.
- `surge`: sudden short-versus-long energy increase. It is not a drop, genre, section, or emotion classifier.

### Events

Each event has a time-retained `pulse`, relative `strength`, and time since the latest event in `ageSeconds`. Pulses use time-based decay and remain observable across a 30 FPS delivery interval. Strength is not independently normalized to one for every hit, so soft and hard impacts remain ordered.

- `onset`: a broad attack event.
- `lowImpact`: a low-frequency attack gesture useful for kick-like or bass impact, not an instrument classifier.
- `midHit`: a mid-frequency attack gesture, not a snare or clap classifier.
- `highSpark`: a high-frequency attack gesture, not a hi-hat classifier.

Sustained energy does not repeatedly retrigger an event, and low noise cannot adapt into false maximum activity.

### Rhythm

- `pulse`: a retained pulse associated with sufficiently supported rhythm evidence.
- `phase`: continuous position in the supported beat period, neutral at zero below sufficient confidence.
- `tempo`: estimated beats per minute, or zero when unavailable.
- `confidence`: bounded regularity/evidence strength.

At least several consistent attacks are required. Irregular timing remains low confidence. One near-double gap may count as a missed observation only when it is a small minority of otherwise consistent intervals; alternating half/double evidence remains ambiguous. A long quiet gap clears stale intervals so a new regular train can reacquire promptly. Suspension, pause/resume, seek, queue/track replacement, and source replacement prime a fresh baseline without catch-up bursts or false impacts.

### Frequency

`logBands` covers 30 Hz through the useful upper audible range in 24 logarithmic regions. This gives low frequencies materially more resolution than V1's 96-value linear spectrum. `bandAttack` is the positive recent change in each corresponding logarithmic band; it rises on entrances and settles under sustained audio.

The expressive path uses a separate unsmoothed 4096-point analyser so V1 smoothing and field semantics remain unchanged. Internal FFT/state buffers are reused, onset history is bounded to 16 timestamps, and no audio or feature history is persisted.

## Privacy and source truth

The provider receives the schema text only. It never receives the current song, audio bytes, feature values, source kind, filename, MIME declaration, object URL, metadata, queue state, or history. Generated code receives only its current normalized frame over the existing authenticated opaque-origin bridge.

Local media, shared tab/system audio, and microphone audio use the same V2 processor. Capture availability and browser/operating-system processing can differ. Confirmed capture stereo retains V1 balance/width; mono or unknown capture stays neutral. Local media remains neutral stereo in this milestone because the media-element graph cannot prove mono versus stereo topology reliably without changing the trusted playback path.
