# Visualizer Audio API v1

Runtime identifier: `visualizer-audio-v1`.

The host owns audio capture and signal interpretation. Generated visualizers never capture audio themselves.

## Capture boundary

The web version uses `navigator.mediaDevices.getDisplayMedia()` after an explicit user gesture. It requests shared audio and hints for system/window audio where supported. The browser and operating system decide which audio sources can actually be shared. A video track is required by the browser API but the app does not render or analyze the video; the visualizer uses the audio track only.

`getUserMedia()` microphone capture is explicitly forbidden in V0.

## Host frame

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
