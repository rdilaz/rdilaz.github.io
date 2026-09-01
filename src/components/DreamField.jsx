import { useEffect, useRef, useState } from 'react';
import './DreamField.css';

const COPY = [
  ['You are looking at something that has never existed before.', 'Move through it. The universe remembers where you were.'],
  ['Every orbit is being invented right now.', 'Tap anywhere and watch cause become geometry.'],
  ['This is not a video. Nothing here is repeating.', 'Your motion becomes gravity; gravity becomes light.'],
  ['A tiny universe is spending its entire life inside this rectangle.', 'Collapse it. It will return with different laws.'],
  ['Code can be a place, not just an instruction.', 'Stay long enough and the field starts drawing your path.'],
];

const PALETTE = [
  [155, 190, 255],
  [214, 178, 255],
  [104, 226, 209],
  [255, 190, 122],
  [236, 238, 255],
];

const METER_SEGMENTS = 9;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function AudioIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 14.5v-5M8 17v-10M12 19.5v-15M16 17v-10M20 14.5v-5" />
    </svg>
  );
}

function FullscreenIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {active ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      ) : (
        <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
      )}
    </svg>
  );
}

function RebirthIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 7V3m0 0h-4m4 0-3.1 3.1A7.5 7.5 0 1 0 19 12" />
    </svg>
  );
}

function PauseIcon({ paused }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paused ? <path d="m9 6 9 6-9 6Z" /> : <path d="M9 6v12M15 6v12" />}
    </svg>
  );
}

export default function DreamField() {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const gravityRef = useRef(92);
  const pausedRef = useRef(false);
  const fallbackFullscreenRef = useRef(false);

  const [gravity, setGravity] = useState(92);
  const [paused, setPaused] = useState(false);
  const [audioActive, setAudioActive] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [status, setStatus] = useState('Move to bend space · tap to fold it · arrows tilt reality');
  const [copy, setCopy] = useState(COPY[0]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const onFullscreenChange = () => {
      const nativeFullscreen = document.fullscreenElement === root;
      if (nativeFullscreen) {
        fallbackFullscreenRef.current = false;
        setFullscreen(true);
      } else if (!fallbackFullscreenRef.current) {
        setFullscreen(false);
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return undefined;

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return undefined;

    let disposed = false;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let centerX = 0;
    let centerY = 0;
    let time = 0;
    let lastFrame = performance.now();
    let animationFrame = 0;
    let seed = Math.floor(Math.random() * 200000) + 1;
    let pulse = 0;
    let lastMeterUpdate = 0;

    let audioContext = null;
    let audioSource = null;
    let audioStream = null;
    let analyser = null;
    let frequencyData = null;
    let lastBeat = 0;
    let bassFloor = 0.08;

    const audio = {
      active: false,
      level: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      beat: 0,
    };

    const pointer = { x: 0, y: 0, active: false, down: false };
    const tilt = { x: 0, y: 0 };
    let stars = [];
    let dust = [];
    let ribbons = [];
    let constellationNodes = [];
    let echoes = [];

    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const color = (index, alpha = 1) => {
      const [red, green, blue] = PALETTE[index % PALETTE.length];
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(280, bounds.width);
      height = Math.max(360, bounds.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      centerX = width / 2;
      centerY = height / 2;

      if (!pointer.active) {
        pointer.x = centerX;
        pointer.y = centerY;
      }
    };

    const averageBand = (minimumHz, maximumHz) => {
      if (!analyser || !frequencyData || !audioContext) return 0;
      const nyquist = audioContext.sampleRate / 2;
      const first = clamp(Math.floor((minimumHz / nyquist) * frequencyData.length), 0, frequencyData.length - 1);
      const last = clamp(Math.ceil((maximumHz / nyquist) * frequencyData.length), first + 1, frequencyData.length);

      let total = 0;
      for (let index = first; index < last; index += 1) total += frequencyData[index];
      return total / Math.max(1, last - first) / 255;
    };

    const updateAudio = (timestamp) => {
      if (!audio.active || !analyser || !frequencyData) {
        audio.level *= 0.9;
        audio.bass *= 0.88;
        audio.mid *= 0.88;
        audio.treble *= 0.88;
        audio.beat *= 0.82;
        return;
      }

      analyser.getByteFrequencyData(frequencyData);

      const rawBass = clamp(Math.pow(averageBand(35, 190), 0.78) * 1.55, 0, 1);
      const rawMid = clamp(Math.pow(averageBand(190, 2200), 0.82) * 1.6, 0, 1);
      const rawTreble = clamp(Math.pow(averageBand(2200, 9000), 0.86) * 2.05, 0, 1);
      const rawLevel = clamp(rawBass * 0.48 + rawMid * 0.34 + rawTreble * 0.18, 0, 1);

      audio.bass += (rawBass - audio.bass) * 0.2;
      audio.mid += (rawMid - audio.mid) * 0.17;
      audio.treble += (rawTreble - audio.treble) * 0.22;
      audio.level += (rawLevel - audio.level) * 0.18;
      bassFloor += (audio.bass - bassFloor) * 0.025;
      audio.beat *= 0.84;

      const beatThreshold = Math.max(0.22, bassFloor * 1.36 + 0.055);
      if (audio.bass > beatThreshold && timestamp - lastBeat > 210) {
        lastBeat = timestamp;
        audio.beat = 1;
        pulse = Math.max(pulse, 0.55 + audio.bass * 1.25);
        echoes.push({
          x: centerX,
          y: centerY,
          radius: Math.min(width, height) * 0.065,
          life: 0.52 + audio.bass * 0.3,
          tone: 0,
          speed: 3.3 + audio.bass * 2.4,
        });
      }

      if (timestamp - lastMeterUpdate > 90) {
        lastMeterUpdate = timestamp;
        setAudioLevel(audio.level);
      }
    };

    const fieldPoint = (x, y, depth = 1) => {
      let dx = x - centerX;
      let dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy) + 1;
      const audioGravity = 1 + audio.bass * 0.28 + audio.beat * 0.05;
      const gravityStrength = gravityRef.current * audioGravity;
      const swirl = (gravityStrength * 950) / (distance * distance + 9500) * depth;
      const soundWarp = audio.mid * 0.085 * Math.sin(distance * 0.025 + time * 0.0011);
      const angle = Math.atan2(dy, dx)
        + swirl
        + soundWarp
        + Math.sin(time * 0.00022 + distance * 0.012) * 0.045;
      const lens = 1 + Math.min(0.28, gravityStrength / (distance + 180) * (0.16 + audio.bass * 0.04));

      let nextX = centerX + Math.cos(angle) * distance * lens;
      let nextY = centerY + Math.sin(angle) * distance * lens;

      if (pointer.active) {
        dx = nextX - pointer.x;
        dy = nextY - pointer.y;
        const pointerDistance = Math.sqrt(dx * dx + dy * dy) + 1;
        const pull = gravityStrength * 180 / (pointerDistance * pointerDistance + 1300);
        nextX -= dx * pull;
        nextY -= dy * pull;
      }

      nextX += tilt.x * (distance / Math.max(width, 1)) * 36;
      nextY += tilt.y * (distance / Math.max(height, 1)) * 36;
      return [nextX, nextY];
    };

    const backdrop = () => {
      const extent = Math.max(width, height);
      const coreLift = audio.bass * 8 + audio.level * 4;
      const space = context.createRadialGradient(
        centerX,
        centerY,
        5,
        centerX,
        centerY,
        extent * (0.72 + audio.bass * 0.04),
      );
      space.addColorStop(0, `rgb(${17 + coreLift}, ${20 + coreLift}, ${36 + coreLift * 1.5})`);
      space.addColorStop(0.18, '#090b14');
      space.addColorStop(0.62, '#05060a');
      space.addColorStop(1, '#020304');
      context.fillStyle = space;
      context.fillRect(0, 0, width, height);

      const haze = context.createRadialGradient(
        centerX + Math.sin(time * 0.00008) * width * 0.09,
        centerY + Math.cos(time * 0.00006) * height * 0.08,
        0,
        centerX,
        centerY,
        extent * 0.55,
      );
      haze.addColorStop(0, color(1, 0.025 + audio.mid * 0.04));
      haze.addColorStop(0.34, color(2, 0.014 + audio.treble * 0.02));
      haze.addColorStop(1, 'rgba(0, 0, 0, 0)');
      context.fillStyle = haze;
      context.fillRect(0, 0, width, height);

      const vignette = context.createRadialGradient(
        centerX,
        centerY,
        Math.min(width, height) * 0.12,
        centerX,
        centerY,
        extent * 0.68,
      );
      vignette.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.76)');
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);
    };

    const drawSpectralVeil = () => {
      context.globalCompositeOperation = 'lighter';
      const minimum = Math.min(width, height);

      for (let layer = 0; layer < 4; layer += 1) {
        context.beginPath();
        context.lineWidth = 0.65 + layer * 0.35;
        context.strokeStyle = color(layer + 1, 0.018 + audio.mid * 0.025 + layer * 0.004);

        for (let index = 0; index <= 92; index += 1) {
          const progress = index / 92;
          const angle = progress * Math.PI * 2 + layer * 1.23 + time * (0.000018 + layer * 0.000003);
          const frequency = 3 + layer;
          const radius = minimum * (0.16 + layer * 0.075)
            + Math.sin(angle * frequency + time * 0.00022) * (12 + layer * 7 + audio.mid * 34)
            + Math.sin(angle * 2 - time * 0.00013) * (5 + audio.bass * 15);
          const [x, y] = fieldPoint(
            centerX + Math.cos(angle) * radius * (1.18 + layer * 0.025),
            centerY + Math.sin(angle) * radius * (0.7 + layer * 0.02),
            0.32,
          );

          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }

        context.stroke();
      }

      context.globalCompositeOperation = 'source-over';
    };

    const drawRibbons = () => {
      context.globalCompositeOperation = 'lighter';

      ribbons.forEach((ribbon) => {
        for (let layer = 0; layer < 3; layer += 1) {
          context.beginPath();
          context.strokeStyle = color(
            ribbon.tone,
            0.026 + 0.015 * (2 - layer) + audio.mid * 0.024 + audio.treble * 0.008,
          );
          context.lineWidth = 1 + layer * 4 + audio.bass * 1.3;

          for (let index = 0; index <= 96; index += 1) {
            const progress = index / 96;
            const baseAngle = progress * Math.PI * 2
              + ribbon.phase
              + time * 0.00004 * ribbon.spin * (1 + audio.mid * 1.2);
            const amplitude = ribbon.amplitude * (1 + audio.mid * 0.72);
            const radius = 55
              + progress * Math.min(width, height) * 0.44
              + Math.sin(progress * ribbon.frequency * Math.PI * 2 + time * 0.00025 + ribbon.phase) * amplitude;
            const x = centerX + Math.cos(baseAngle) * radius * 1.28;
            const y = centerY + Math.sin(baseAngle) * radius * 0.72;
            const [nextX, nextY] = fieldPoint(x, y, 0.45);

            if (index === 0) context.moveTo(nextX, nextY);
            else context.lineTo(nextX, nextY);
          }

          context.stroke();
        }
      });

      context.globalCompositeOperation = 'source-over';
    };

    const drawConstellations = () => {
      if (constellationNodes.length < 2) return;
      const points = constellationNodes.map((node) => {
        const angle = node.angle + time * node.speed * 0.00002;
        const radius = node.radius + Math.sin(time * 0.00017 + node.phase) * 8;
        return fieldPoint(
          centerX + Math.cos(angle) * radius * 1.1,
          centerY + Math.sin(angle) * radius * 0.72,
          0.65,
        );
      });

      context.globalCompositeOperation = 'lighter';
      context.lineWidth = 0.55;

      constellationNodes.forEach((node, index) => {
        const from = points[index];
        const candidates = [(index + 1) % points.length, (index + 5) % points.length];

        candidates.forEach((targetIndex, connectionIndex) => {
          const to = points[targetIndex];
          const dx = from[0] - to[0];
          const dy = from[1] - to[1];
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > Math.min(width, height) * 0.29) return;

          context.strokeStyle = color(
            node.tone + connectionIndex,
            0.018 + audio.treble * 0.035 + (1 - distance / Math.max(width, 1)) * 0.015,
          );
          context.beginPath();
          context.moveTo(from[0], from[1]);
          context.lineTo(to[0], to[1]);
          context.stroke();
        });

        context.fillStyle = color(node.tone, 0.2 + audio.treble * 0.35);
        context.beginPath();
        context.arc(from[0], from[1], 0.7 + audio.treble * 0.7, 0, Math.PI * 2);
        context.fill();
      });

      context.globalCompositeOperation = 'source-over';
    };

    const drawStars = (deltaTime) => {
      context.globalCompositeOperation = 'lighter';

      stars.forEach((star) => {
        star.angle += star.speed * deltaTime * 0.001 * (0.4 + star.depth) * (1 + audio.mid * 0.62);
        const breathing = Math.sin(time * 0.00037 + star.twinkle) * (7 + audio.bass * 4) * star.depth;
        const x = centerX + Math.cos(star.angle) * (star.radius + breathing) * 1.12;
        const y = centerY + Math.sin(star.angle) * (star.radius + breathing) * 0.72;
        const [nextX, nextY] = fieldPoint(x, y, star.depth);
        const twinkle = 0.7 + Math.sin(time * 0.0027 + star.twinkle) * 0.3;
        const size = star.size
          * (0.45 + star.depth)
          * clamp(twinkle, 0.25, 1.2)
          * (1 + audio.treble * (0.22 + star.depth * 0.38));

        context.fillStyle = color(star.tone, 0.15 + 0.55 * star.depth + audio.treble * 0.1);
        context.beginPath();
        context.arc(nextX, nextY, size, 0, Math.PI * 2);
        context.fill();

        if (star.depth > 0.75 && size > 0.95) {
          context.fillStyle = color(star.tone, 0.04 + audio.treble * 0.035);
          context.beginPath();
          context.arc(nextX, nextY, size * (4.6 + audio.treble * 2.2), 0, Math.PI * 2);
          context.fill();
        }
      });

      context.globalCompositeOperation = 'source-over';
    };

    const drawDust = (deltaTime) => {
      context.globalCompositeOperation = 'lighter';

      dust.forEach((particle) => {
        let dx = centerX - particle.x;
        let dy = centerY - particle.y;
        const radiusSquared = dx * dx + dy * dy + 5000;
        const pull = gravityRef.current * (45 + audio.bass * 17) / radiusSquared;
        particle.vx += dx * pull * deltaTime * 0.001;
        particle.vy += dy * pull * deltaTime * 0.001;

        if (pointer.active) {
          dx = pointer.x - particle.x;
          dy = pointer.y - particle.y;
          const pointerRadiusSquared = dx * dx + dy * dy + 900;
          particle.vx += dx * gravityRef.current * 40 / pointerRadiusSquared * deltaTime * 0.001;
          particle.vy += dy * gravityRef.current * 40 / pointerRadiusSquared * deltaTime * 0.001;
        }

        particle.vx *= 0.997;
        particle.vy *= 0.997;
        const audioVelocity = 1 + audio.mid * 0.5;
        particle.x += particle.vx * deltaTime * 0.08 * audioVelocity;
        particle.y += particle.vy * deltaTime * 0.08 * audioVelocity;

        if (particle.x < 0) particle.x += width;
        if (particle.x > width) particle.x -= width;
        if (particle.y < 0) particle.y += height;
        if (particle.y > height) particle.y -= height;

        context.fillStyle = color(particle.tone, 0.11 + audio.treble * 0.12);
        const particleSize = particle.size * (1 + audio.treble * 0.42);
        context.fillRect(particle.x, particle.y, particleSize, particleSize);
      });

      context.globalCompositeOperation = 'source-over';
    };

    const drawSingularity = () => {
      const minimum = Math.min(width, height);
      const base = minimum
        * (0.067 + 0.006 * Math.sin(time * 0.0012))
        * (1 + audio.bass * 0.24 + audio.beat * 0.06);
      const pulseStrength = pulse * (26 + audio.bass * 16);

      context.globalCompositeOperation = 'lighter';

      for (let index = 8; index >= 1; index -= 1) {
        const radius = base + index * (7.5 + audio.mid * 1.5) + pulseStrength;
        context.fillStyle = color(
          (index + 2) % 5,
          0.01 + index * 0.0027 + audio.bass * 0.007,
        );
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.fill();
      }

      for (let ring = 0; ring < 6; ring += 1) {
        context.save();
        context.translate(centerX, centerY);
        context.rotate(
          time * 0.00008 * (ring % 2 ? 1 : -1) * (1 + audio.mid * 1.1)
          + ring * 0.62,
        );
        context.scale(1.65 + audio.bass * 0.12, 0.31 + 0.034 * ring + audio.mid * 0.025);
        context.strokeStyle = color(ring, 0.07 + 0.021 * ring + audio.mid * 0.025);
        context.lineWidth = 0.9 + audio.treble * 0.7;
        context.beginPath();
        context.arc(0, 0, base + 20 + ring * 10 + pulseStrength * 0.28, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }

      context.globalCompositeOperation = 'source-over';
      const eventHorizon = context.createRadialGradient(
        centerX - base * 0.22,
        centerY - base * 0.22,
        0,
        centerX,
        centerY,
        base * 1.12,
      );
      eventHorizon.addColorStop(0, `rgba(255, 255, 255, ${0.93 + audio.treble * 0.07})`);
      eventHorizon.addColorStop(0.075, `rgba(190, 215, 255, ${0.58 + audio.treble * 0.18})`);
      eventHorizon.addColorStop(0.2, `rgba(104, 112, 180, ${0.18 + audio.mid * 0.1})`);
      eventHorizon.addColorStop(0.48, 'rgba(2, 3, 8, 0.93)');
      eventHorizon.addColorStop(1, 'rgba(0, 0, 0, 1)');
      context.fillStyle = eventHorizon;
      context.beginPath();
      context.arc(centerX, centerY, base, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = `rgba(240, 245, 255, ${0.28 + audio.treble * 0.2})`;
      context.lineWidth = 0.75 + audio.treble * 0.45;
      context.beginPath();
      context.arc(
        centerX,
        centerY,
        base + 2 + Math.sin(time * 0.002) * (1.4 + audio.bass * 2.4),
        0,
        Math.PI * 2,
      );
      context.stroke();
    };

    const drawEchoes = () => {
      context.globalCompositeOperation = 'lighter';
      echoes = echoes.filter((echo) => echo.life > 0);

      echoes.forEach((echo) => {
        echo.radius += echo.speed ?? 2.7;
        echo.life -= 0.018;
        context.strokeStyle = color(echo.tone, echo.life * (0.22 + audio.treble * 0.09));
        context.lineWidth = 0.8 + echo.life * 3 + audio.bass * 0.8;
        context.beginPath();
        context.arc(echo.x, echo.y, echo.radius, 0, Math.PI * 2);
        context.stroke();
      });

      context.globalCompositeOperation = 'source-over';
    };

    const drawPointer = () => {
      if (!pointer.active) return;
      context.strokeStyle = `rgba(255, 255, 255, ${0.1 + audio.level * 0.05})`;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(pointer.x, pointer.y, 11 + Math.sin(time * 0.004) * 3 + audio.bass * 3, 0, Math.PI * 2);
      context.stroke();
    };

    const drawGrain = () => {
      const count = width < 600 ? 24 : 42;
      context.fillStyle = `rgba(255, 255, 255, ${0.012 + audio.treble * 0.009})`;
      for (let index = 0; index < count; index += 1) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const size = Math.random() < 0.86 ? 0.55 : 1;
        context.fillRect(x, y, size, size);
      }
    };

    const draw = (timestamp) => {
      const deltaTime = pausedRef.current ? 0 : clamp(timestamp - lastFrame, 0, 32);
      lastFrame = timestamp;
      if (!pausedRef.current) time += deltaTime;

      updateAudio(timestamp);
      backdrop();
      drawSpectralVeil();
      drawRibbons();
      drawConstellations();
      drawDust(deltaTime);
      drawStars(deltaTime);
      drawEchoes();
      drawSingularity();
      drawPointer();
      drawGrain();
      pulse *= 0.963;

      if (!pausedRef.current) animationFrame = window.requestAnimationFrame(draw);
    };

    const scheduleDraw = () => {
      window.cancelAnimationFrame(animationFrame);
      lastFrame = performance.now();
      if (pausedRef.current) draw(lastFrame);
      else animationFrame = window.requestAnimationFrame(draw);
    };

    const reset = () => {
      seed = Math.floor(Math.random() * 200000) + 1;
      time = 0;
      pulse = 1;
      stars = [];
      dust = [];
      ribbons = [];
      constellationNodes = [];
      echoes = [];

      const starCount = width < 600 ? 470 : 930;
      const dustCount = width < 600 ? 170 : 340;
      const constellationCount = width < 600 ? 16 : 24;

      for (let index = 0; index < starCount; index += 1) {
        const angle = random() * Math.PI * 2;
        const radius = Math.pow(random(), 0.55) * Math.max(width, height) * 0.72;
        stars.push({
          angle,
          radius,
          depth: 0.15 + random() * 0.95,
          size: 0.35 + random() * 1.5,
          twinkle: random() * Math.PI * 2,
          speed: (0.03 + random() * 0.14) * (random() < 0.5 ? -1 : 1),
          tone: Math.floor(random() * PALETTE.length),
        });
      }

      for (let index = 0; index < dustCount; index += 1) {
        dust.push({
          x: random() * width,
          y: random() * height,
          vx: (random() - 0.5) * 0.16,
          vy: (random() - 0.5) * 0.16,
          size: 0.2 + random() * 1.2,
          tone: Math.floor(random() * PALETTE.length),
        });
      }

      for (let index = 0; index < 7; index += 1) {
        ribbons.push({
          phase: random() * Math.PI * 2,
          frequency: 1 + random() * 2.8,
          amplitude: 16 + random() * 38,
          tone: index % PALETTE.length,
          spin: (random() - 0.5) * 0.18,
        });
      }

      for (let index = 0; index < constellationCount; index += 1) {
        constellationNodes.push({
          angle: random() * Math.PI * 2,
          radius: (0.18 + random() * 0.44) * Math.min(width, height),
          phase: random() * Math.PI * 2,
          speed: (0.22 + random() * 0.55) * (random() < 0.5 ? -1 : 1),
          tone: Math.floor(random() * PALETTE.length),
        });
      }

      setCopy(COPY[Math.floor(random() * COPY.length)]);
      setStatus(audio.active ? 'A new universe, still listening.' : 'A new universe has been born.');
      scheduleDraw();
    };

    const togglePause = () => {
      const nextPaused = !pausedRef.current;
      pausedRef.current = nextPaused;
      setPaused(nextPaused);
      setStatus(nextPaused ? 'Time has stopped.' : audio.active ? 'Time is moving with the room.' : 'Time is moving again.');
      scheduleDraw();
    };

    const stopAudio = (announce = true) => {
      audio.active = false;
      if (!disposed) {
        setAudioActive(false);
        setAudioLevel(0);
      }

      if (audioSource) {
        try {
          audioSource.disconnect();
        } catch {
          // Already disconnected.
        }
      }

      if (audioStream) {
        audioStream.getTracks().forEach((track) => track.stop());
      }

      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(() => {});
      }

      audioSource = null;
      audioStream = null;
      analyser = null;
      frequencyData = null;
      audioContext = null;

      if (announce && !disposed) setStatus('Listening is off. The field is back to its own rhythm.');
    };

    const startAudio = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('Live audio input is not available in this browser.');
        return;
      }

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        setStatus('Web Audio is not available in this browser.');
        return;
      }

      setStatus('Asking for microphone access…');

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        });

        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const nextAudioContext = new AudioContextClass();
        const nextAnalyser = nextAudioContext.createAnalyser();
        nextAnalyser.fftSize = 512;
        nextAnalyser.smoothingTimeConstant = 0.74;
        nextAnalyser.minDecibels = -90;
        nextAnalyser.maxDecibels = -16;

        const nextSource = nextAudioContext.createMediaStreamSource(stream);
        nextSource.connect(nextAnalyser);
        await nextAudioContext.resume();

        audioContext = nextAudioContext;
        audioStream = stream;
        audioSource = nextSource;
        analyser = nextAnalyser;
        frequencyData = new Uint8Array(nextAnalyser.frequencyBinCount);
        audio.active = true;
        bassFloor = 0.08;

        setAudioActive(true);
        setStatus('Listening locally — audio is never recorded or uploaded.');
        if (pausedRef.current) draw(performance.now());
      } catch (error) {
        if (disposed) return;
        const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
        setStatus(
          denied
            ? 'Microphone access was not granted. The universe still works without it.'
            : 'The microphone could not be opened on this device.',
        );
      }
    };

    const toggleAudio = () => {
      if (audio.active) stopAudio();
      else startAudio();
    };

    const setPoint = (event) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.x = clamp(event.clientX - bounds.left, 0, width);
      pointer.y = clamp(event.clientY - bounds.top, 0, height);
      pointer.active = true;
    };

    const onPointerDown = (event) => {
      pointer.down = true;
      setPoint(event);
      canvas.setPointerCapture?.(event.pointerId);
      pulse = Math.min(2.7, pulse + 0.68);
      echoes.push({
        x: pointer.x,
        y: pointer.y,
        radius: 6,
        life: 1,
        tone: Math.floor(Math.random() * PALETTE.length),
        speed: 2.7,
      });
      setStatus(audio.active ? 'Your touch interrupted the music’s gravity.' : 'Space folded around your touch.');
      if (pausedRef.current) draw(performance.now());
    };

    const onPointerMove = (event) => {
      if (event.pointerType === 'mouse' || pointer.down) setPoint(event);
      if (pointer.down && Math.random() < 0.24) {
        echoes.push({
          x: pointer.x,
          y: pointer.y,
          radius: 2,
          life: 0.3,
          tone: Math.floor(Math.random() * PALETTE.length),
          speed: 2.1,
        });
      }
    };

    const onPointerUp = (event) => {
      pointer.down = false;
      if (event.pointerType !== 'mouse') pointer.active = false;
    };

    const onPointerLeave = (event) => {
      if (event.pointerType === 'mouse' && !pointer.down) pointer.active = false;
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && fallbackFullscreenRef.current) {
        event.preventDefault();
        fallbackFullscreenRef.current = false;
        setFullscreen(false);
        setStatus('Back inside the page.');
        return;
      }

      if (['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;

      let handled = true;
      if (event.key === 'ArrowLeft') tilt.x = clamp(tilt.x - 0.12, -1, 1);
      else if (event.key === 'ArrowRight') tilt.x = clamp(tilt.x + 0.12, -1, 1);
      else if (event.key === 'ArrowUp') tilt.y = clamp(tilt.y - 0.12, -1, 1);
      else if (event.key === 'ArrowDown') tilt.y = clamp(tilt.y + 0.12, -1, 1);
      else if (event.key === ' ') {
        pulse = 1.7;
        echoes.push({ x: centerX, y: centerY, radius: 8, life: 1, tone: 3, speed: 3 });
      } else handled = false;

      if (handled) {
        event.preventDefault();
        setStatus('Reality tilted.');
        if (pausedRef.current) draw(performance.now());
      }
    };

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      pausedRef.current = true;
      setPaused(true);
      setStatus('Motion is paused to respect your reduced-motion preference.');
    }

    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (stars.length === 0) reset();
      else if (pausedRef.current) draw(performance.now());
    });

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerLeave);
    root.addEventListener('keydown', onKeyDown);
    resizeObserver.observe(canvas);

    resize();
    reset();

    runtimeRef.current = {
      reset,
      togglePause,
      toggleAudio,
      redraw: () => {
        if (pausedRef.current) draw(performance.now());
      },
    };

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      root.removeEventListener('keydown', onKeyDown);
      stopAudio(false);
      runtimeRef.current = null;
    };
  }, []);

  const changeGravity = (event) => {
    const nextGravity = Number(event.target.value);
    setGravity(nextGravity);
    gravityRef.current = nextGravity;
    setStatus(`Gravity · ${nextGravity}%`);
    runtimeRef.current?.redraw();
  };

  const toggleFullscreen = async () => {
    const root = rootRef.current;
    if (!root) return;

    if (document.fullscreenElement === root) {
      await document.exitFullscreen?.();
      return;
    }

    if (fallbackFullscreenRef.current) {
      fallbackFullscreenRef.current = false;
      setFullscreen(false);
      setStatus('Back inside the page.');
      return;
    }

    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }

    if (root.requestFullscreen) {
      try {
        await root.requestFullscreen();
        setStatus('The field has the whole screen.');
        return;
      } catch {
        // Fall through to a CSS immersive mode for browsers that limit the Fullscreen API.
      }
    }

    fallbackFullscreenRef.current = true;
    setFullscreen(true);
    setStatus('Immersive mode is on.');
  };

  const meterStrength = Math.ceil(audioLevel * METER_SEGMENTS);

  return (
    <div
      className={[
        'dream-field',
        fullscreen ? 'dream-field--fullscreen' : '',
        audioActive ? 'dream-field--listening' : '',
      ].filter(Boolean).join(' ')}
      ref={rootRef}
      tabIndex={0}
      aria-label="Interactive generative universe. Move or drag across the field to bend it, tap to create a gravity pulse, use arrow keys to tilt it, or enable live audio response."
    >
      <div className="dream-field__stage">
        <canvas
          ref={canvasRef}
          className="dream-field__canvas"
          role="img"
          aria-label="An evolving generative field of stars, orbital filaments, gravity waves, constellation traces, and a luminous central singularity."
        />

        <div className="dream-field__hud" aria-hidden="true">
          <span className="dream-field__eyebrow">A FIELD THAT DREAMS BACK</span>
          <div className="dream-field__copy">
            <strong>{copy[0]}</strong>
            <span>{copy[1]}</span>
          </div>
        </div>

        <div className="dream-field__stage-actions" aria-label="Immersive controls">
          <button
            type="button"
            className={`dream-field__glass-button${audioActive ? ' is-active' : ''}`}
            aria-pressed={audioActive}
            onClick={() => runtimeRef.current?.toggleAudio()}
            title={audioActive ? 'Stop listening' : 'React to microphone audio'}
          >
            <AudioIcon />
            <span>{audioActive ? 'Listening' : 'Listen'}</span>
            <span className="dream-field__meter" aria-hidden="true">
              {Array.from({ length: METER_SEGMENTS }, (_, index) => (
                <i key={index} className={index < meterStrength ? 'is-lit' : ''} />
              ))}
            </span>
          </button>

          <button
            type="button"
            className="dream-field__glass-button dream-field__fullscreen-button"
            aria-pressed={fullscreen}
            onClick={toggleFullscreen}
            title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            <FullscreenIcon active={fullscreen} />
            <span>{fullscreen ? 'Exit' : 'Expand'}</span>
          </button>
        </div>
      </div>

      <div className="dream-field__controls" aria-label="Universe controls">
        <button
          type="button"
          className="dream-field__control-button"
          onClick={() => runtimeRef.current?.reset()}
        >
          <RebirthIcon />
          <span>Rebirth</span>
        </button>

        <button
          type="button"
          className="dream-field__control-button"
          onClick={() => runtimeRef.current?.togglePause()}
        >
          <PauseIcon paused={paused} />
          <span>{paused ? 'Continue' : 'Stillness'}</span>
        </button>

        <label className="dream-field__gravity">
          <span>Gravity</span>
          <input
            type="range"
            min="20"
            max="180"
            value={gravity}
            onChange={changeGravity}
            aria-label="Gravity strength"
          />
          <output>{gravity}</output>
        </label>

        <p className="dream-field__status" aria-live="polite">{status}</p>
      </div>
    </div>
  );
}
