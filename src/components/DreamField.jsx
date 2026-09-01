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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export default function DreamField() {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const runtimeRef = useRef(null);
  const gravityRef = useRef(92);
  const pausedRef = useRef(false);

  const [gravity, setGravity] = useState(92);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState('Drag the field · tap to collapse space · focus and use arrow keys to tilt reality');
  const [copy, setCopy] = useState(COPY[0]);

  gravityRef.current = gravity;
  pausedRef.current = paused;

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return undefined;

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return undefined;

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

    const pointer = { x: 0, y: 0, active: false, down: false };
    const tilt = { x: 0, y: 0 };
    let stars = [];
    let dust = [];
    let ribbons = [];
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

    const fieldPoint = (x, y, depth = 1) => {
      let dx = x - centerX;
      let dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy) + 1;
      const gravityStrength = gravityRef.current;
      const swirl = (gravityStrength * 950) / (distance * distance + 9500) * depth;
      const angle = Math.atan2(dy, dx) + swirl + Math.sin(time * 0.00022 + distance * 0.012) * 0.045;
      const lens = 1 + Math.min(0.23, gravityStrength / (distance + 180) * 0.16);

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
      const space = context.createRadialGradient(centerX, centerY, 5, centerX, centerY, Math.max(width, height) * 0.72);
      space.addColorStop(0, '#111424');
      space.addColorStop(0.18, '#090b14');
      space.addColorStop(0.62, '#05060a');
      space.addColorStop(1, '#020304');
      context.fillStyle = space;
      context.fillRect(0, 0, width, height);

      const vignette = context.createRadialGradient(
        centerX,
        centerY,
        Math.min(width, height) * 0.12,
        centerX,
        centerY,
        Math.max(width, height) * 0.68,
      );
      vignette.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);
    };

    const drawRibbons = () => {
      context.globalCompositeOperation = 'lighter';

      ribbons.forEach((ribbon) => {
        for (let layer = 0; layer < 3; layer += 1) {
          context.beginPath();
          context.strokeStyle = color(ribbon.tone, 0.032 + 0.018 * (2 - layer));
          context.lineWidth = 1 + layer * 4;

          for (let index = 0; index <= 90; index += 1) {
            const progress = index / 90;
            const baseAngle = progress * Math.PI * 2 + ribbon.phase + time * 0.00004 * ribbon.spin;
            const radius = 55 + progress * Math.min(width, height) * 0.44
              + Math.sin(progress * ribbon.frequency * Math.PI * 2 + time * 0.00025 + ribbon.phase) * ribbon.amplitude;
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

    const drawStars = (deltaTime) => {
      context.globalCompositeOperation = 'lighter';

      stars.forEach((star) => {
        star.angle += star.speed * deltaTime * 0.001 * (0.4 + star.depth);
        const breathing = Math.sin(time * 0.00037 + star.twinkle) * 7 * star.depth;
        const x = centerX + Math.cos(star.angle) * (star.radius + breathing) * 1.12;
        const y = centerY + Math.sin(star.angle) * (star.radius + breathing) * 0.72;
        const [nextX, nextY] = fieldPoint(x, y, star.depth);
        const twinkle = 0.7 + Math.sin(time * 0.0027 + star.twinkle) * 0.3;
        const size = star.size * (0.45 + star.depth) * clamp(twinkle, 0.25, 1.2);

        context.fillStyle = color(star.tone, 0.16 + 0.58 * star.depth);
        context.beginPath();
        context.arc(nextX, nextY, size, 0, Math.PI * 2);
        context.fill();

        if (star.depth > 0.78 && size > 1) {
          context.fillStyle = color(star.tone, 0.055);
          context.beginPath();
          context.arc(nextX, nextY, size * 4.8, 0, Math.PI * 2);
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
        const pull = gravityRef.current * 45 / radiusSquared;
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
        particle.x += particle.vx * deltaTime * 0.08;
        particle.y += particle.vy * deltaTime * 0.08;

        if (particle.x < 0) particle.x += width;
        if (particle.x > width) particle.x -= width;
        if (particle.y < 0) particle.y += height;
        if (particle.y > height) particle.y -= height;

        context.fillStyle = color(particle.tone, 0.14);
        context.fillRect(particle.x, particle.y, particle.size, particle.size);
      });

      context.globalCompositeOperation = 'source-over';
    };

    const drawSingularity = () => {
      const base = Math.min(width, height) * (0.067 + 0.006 * Math.sin(time * 0.0012));
      const pulseStrength = pulse * 26;
      context.globalCompositeOperation = 'lighter';

      for (let index = 7; index >= 1; index -= 1) {
        const radius = base + index * 8 + pulseStrength;
        context.fillStyle = color((index + 2) % 5, 0.012 + index * 0.003);
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.fill();
      }

      for (let ring = 0; ring < 5; ring += 1) {
        context.save();
        context.translate(centerX, centerY);
        context.rotate(time * 0.00008 * (ring % 2 ? 1 : -1) + ring * 0.62);
        context.scale(1.65, 0.33 + 0.035 * ring);
        context.strokeStyle = color(ring, 0.08 + 0.025 * ring);
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(0, 0, base + 20 + ring * 10 + pulseStrength * 0.28, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }

      context.globalCompositeOperation = 'source-over';
      const eventHorizon = context.createRadialGradient(
        centerX - base * 0.2,
        centerY - base * 0.2,
        0,
        centerX,
        centerY,
        base * 1.1,
      );
      eventHorizon.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      eventHorizon.addColorStop(0.08, 'rgba(190, 215, 255, 0.65)');
      eventHorizon.addColorStop(0.22, 'rgba(84, 92, 150, 0.22)');
      eventHorizon.addColorStop(0.48, 'rgba(2, 3, 8, 0.92)');
      eventHorizon.addColorStop(1, 'rgba(0, 0, 0, 1)');
      context.fillStyle = eventHorizon;
      context.beginPath();
      context.arc(centerX, centerY, base, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = 'rgba(240, 245, 255, 0.34)';
      context.lineWidth = 0.8;
      context.beginPath();
      context.arc(centerX, centerY, base + 2 + Math.sin(time * 0.002) * 1.4, 0, Math.PI * 2);
      context.stroke();
    };

    const drawEchoes = () => {
      context.globalCompositeOperation = 'lighter';
      echoes = echoes.filter((echo) => echo.life > 0);

      echoes.forEach((echo) => {
        echo.radius += 2.7;
        echo.life -= 0.018;
        context.strokeStyle = color(echo.tone, echo.life * 0.24);
        context.lineWidth = 1 + echo.life * 3;
        context.beginPath();
        context.arc(echo.x, echo.y, echo.radius, 0, Math.PI * 2);
        context.stroke();
      });

      context.globalCompositeOperation = 'source-over';
    };

    const drawPointer = () => {
      if (!pointer.active) return;
      context.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(pointer.x, pointer.y, 11 + Math.sin(time * 0.004) * 3, 0, Math.PI * 2);
      context.stroke();
    };

    const draw = (timestamp) => {
      const deltaTime = pausedRef.current ? 0 : clamp(timestamp - lastFrame, 0, 32);
      lastFrame = timestamp;
      if (!pausedRef.current) time += deltaTime;

      backdrop();
      drawRibbons();
      drawDust(deltaTime);
      drawStars(deltaTime);
      drawEchoes();
      drawSingularity();
      drawPointer();
      pulse *= 0.965;

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
      echoes = [];

      const starCount = width < 600 ? 430 : 850;
      const dustCount = width < 600 ? 150 : 320;

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

      for (let index = 0; index < 6; index += 1) {
        ribbons.push({
          phase: random() * Math.PI * 2,
          frequency: 1 + random() * 2.8,
          amplitude: 18 + random() * 42,
          tone: index % PALETTE.length,
          spin: (random() - 0.5) * 0.18,
        });
      }

      setCopy(COPY[Math.floor(random() * COPY.length)]);
      setStatus('A new universe has been born.');
      scheduleDraw();
    };

    const togglePause = () => {
      const nextPaused = !pausedRef.current;
      pausedRef.current = nextPaused;
      setPaused(nextPaused);
      setStatus(nextPaused ? 'Time has stopped.' : 'Time is moving again.');
      scheduleDraw();
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
      pulse = Math.min(2.5, pulse + 0.65);
      echoes.push({
        x: pointer.x,
        y: pointer.y,
        radius: 6,
        life: 1,
        tone: Math.floor(Math.random() * PALETTE.length),
      });
      setStatus('Space folded around your touch.');
      if (pausedRef.current) draw(performance.now());
    };

    const onPointerMove = (event) => {
      if (event.pointerType === 'mouse' || pointer.down) setPoint(event);
      if (pointer.down && Math.random() < 0.28) {
        echoes.push({
          x: pointer.x,
          y: pointer.y,
          radius: 2,
          life: 0.35,
          tone: Math.floor(Math.random() * PALETTE.length),
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
      if (['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;

      let handled = true;
      if (event.key === 'ArrowLeft') tilt.x = clamp(tilt.x - 0.12, -1, 1);
      else if (event.key === 'ArrowRight') tilt.x = clamp(tilt.x + 0.12, -1, 1);
      else if (event.key === 'ArrowUp') tilt.y = clamp(tilt.y - 0.12, -1, 1);
      else if (event.key === 'ArrowDown') tilt.y = clamp(tilt.y + 0.12, -1, 1);
      else if (event.key === ' ') {
        pulse = 1.7;
        echoes.push({ x: centerX, y: centerY, radius: 8, life: 1, tone: 3 });
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
      redraw: () => {
        if (pausedRef.current) draw(performance.now());
      },
    };

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      root.removeEventListener('keydown', onKeyDown);
      runtimeRef.current = null;
    };
  }, []);

  const changeGravity = (event) => {
    const nextGravity = Number(event.target.value);
    setGravity(nextGravity);
    gravityRef.current = nextGravity;
    setStatus(`Gravity: ${nextGravity}%`);
    runtimeRef.current?.redraw();
  };

  return (
    <div
      className="dream-field"
      ref={rootRef}
      tabIndex={0}
      aria-label="Interactive generative universe. Move or drag across the field to bend it, tap to create a gravity pulse, and use arrow keys to tilt the field."
    >
      <div className="dream-field__stage">
        <canvas
          ref={canvasRef}
          className="dream-field__canvas"
          role="img"
          aria-label="An evolving generative field of stars, orbital filaments, gravity waves, and a luminous central singularity."
        />
        <div className="dream-field__hud" aria-hidden="true">
          <span className="dream-field__eyebrow">A FIELD THAT DREAMS BACK</span>
          <div className="dream-field__copy">
            <strong>{copy[0]}</strong>
            <span>{copy[1]}</span>
          </div>
        </div>
      </div>

      <div className="dream-field__controls" aria-label="Universe controls">
        <button type="button" onClick={() => runtimeRef.current?.reset()}>
          ↻ Rebirth
        </button>
        <button type="button" onClick={() => runtimeRef.current?.togglePause()}>
          {paused ? '▶ Continue' : 'Ⅱ Stillness'}
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
        </label>
        <p className="dream-field__status" aria-live="polite">{status}</p>
      </div>
    </div>
  );
}
