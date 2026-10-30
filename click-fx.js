
/* ============================================================================
   click-fx.js — PREMIUM DIGITAL CLICK EFFECT
   Style: Apple-like / Fintech / Modern SaaS
   Usage: <script src="click-fx.js"></script>
   ============================================================================ */

(function () {
  'use strict';

  if (window.ClickFX) return;

  const CONFIG = {
    enabled: true,

    // Premium blue palette
    primary: [59, 130, 246],
    secondary: [34, 211, 238],
    white: [219, 242, 255],

    duration: 580,
    maxEffects: 18,
    maxDPR: 2
  };

  const reducedMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let canvas = null;
  let ctx = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let animation = 0;

  const effects = [];

  const rgba = (color, alpha) =>
    `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;

  const random = (min, max) =>
    min + Math.random() * (max - min);

  const ease = t => 1 - Math.pow(1 - t, 4);

  // --------------------------------------------------------------------------
  // CANVAS
  // --------------------------------------------------------------------------

  function initCanvas() {
    if (canvas) return;

    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');

    canvas.style.cssText = `
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483000;
      overflow: hidden;
    `;

    (document.body || document.documentElement)
      .appendChild(canvas);

    ctx = canvas.getContext('2d', { alpha: true });

    resize();

    window.addEventListener('resize', resize, {
      passive: true
    });
  }

  function resize() {
    if (!canvas) return;

    dpr = Math.min(
      window.devicePixelRatio || 1,
      CONFIG.maxDPR
    );

    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // --------------------------------------------------------------------------
  // CREATE EFFECT
  // --------------------------------------------------------------------------

  function createEffect(x, y) {
    const effect = {
      x,
      y,
      start: performance.now(),
      rotation: random(0, Math.PI * 2),

      particles: Array.from({ length: 7 }, () => ({
        angle: random(0, Math.PI * 2),
        distance: random(19, 39),
        size: random(1.2, 2.2),
        color: Math.random() > 0.5
          ? CONFIG.primary
          : CONFIG.secondary,
        delay: random(0, 0.12)
      }))
    };

    if (effects.length >= CONFIG.maxEffects) {
      effects.shift();
    }

    effects.push(effect);

    if (!animation) {
      animation = requestAnimationFrame(render);
    }
  }

  // --------------------------------------------------------------------------
  // DRAW EFFECT
  // --------------------------------------------------------------------------

  function draw(effect, now) {
    const progress = (now - effect.start) / CONFIG.duration;

    if (progress >= 1) return false;

    const t = ease(progress);
    const fade = Math.pow(1 - progress, 1.8);

    const { x, y } = effect;

    // 1. Soft ambient glow

    const glowRadius = 25 + t * 23;

    const glow = ctx.createRadialGradient(
      x, y, 0,
      x, y, glowRadius
    );

    glow.addColorStop(0, rgba(CONFIG.secondary, 0.20 * fade));
    glow.addColorStop(0.35, rgba(CONFIG.primary, 0.10 * fade));
    glow.addColorStop(1, rgba(CONFIG.primary, 0));

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // 2. Main expanding ring

    ctx.beginPath();
    ctx.arc(x, y, 5 + t * 34, 0, Math.PI * 2);

    ctx.lineWidth = 1.7 * (1 - progress * 0.45);
    ctx.strokeStyle = rgba(CONFIG.secondary, 0.65 * fade);
    ctx.stroke();

    // 3. Secondary rotating ring

    ctx.save();

    ctx.translate(x, y);
    ctx.rotate(effect.rotation + t * 0.7);

    ctx.beginPath();
    ctx.arc(
      0, 0,
      13 + t * 25,
      -0.9,
      0.9
    );

    ctx.lineWidth = 1.2;
    ctx.strokeStyle = rgba(CONFIG.primary, 0.75 * fade);
    ctx.stroke();

    ctx.restore();

    // 4. Central light point

    const centerAlpha = Math.max(0, 1 - progress * 5);

    const center = ctx.createRadialGradient(
      x, y, 0,
      x, y, 8
    );

    center.addColorStop(0, rgba(CONFIG.white, centerAlpha));
    center.addColorStop(0.35, rgba(CONFIG.secondary, centerAlpha * 0.7));
    center.addColorStop(1, rgba(CONFIG.primary, 0));

    ctx.fillStyle = center;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();

    // 5. Minimal floating particles

    effect.particles.forEach(particle => {
      const pt = Math.max(
        0,
        Math.min(
          1,
          (progress - particle.delay) / (1 - particle.delay)
        )
      );

      if (!pt) return;

      const distance = particle.distance * ease(pt);
      const alpha = (1 - pt) * fade;

      const px = x + Math.cos(particle.angle) * distance;
      const py = y + Math.sin(particle.angle) * distance;

      ctx.fillStyle = rgba(particle.color, alpha);

      ctx.beginPath();
      ctx.arc(
        px,
        py,
        particle.size * (1 - pt * 0.35),
        0,
        Math.PI * 2
      );

      ctx.fill();
    });

    return true;
  }

  // --------------------------------------------------------------------------
  // ANIMATION LOOP
  // --------------------------------------------------------------------------

  function render(now) {
    animation = 0;

    ctx.clearRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'lighter';

    for (let i = effects.length - 1; i >= 0; i--) {
      if (!draw(effects[i], now)) {
        effects.splice(i, 1);
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    if (effects.length) {
      animation = requestAnimationFrame(render);
    } else {
      ctx.clearRect(0, 0, width, height);
    }
  }

  // --------------------------------------------------------------------------
  // GLOBAL CLICK LISTENER
  // --------------------------------------------------------------------------

  document.addEventListener('pointerdown', function (event) {
    if (!CONFIG.enabled || reducedMotion) return;

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    initCanvas();

    createEffect(
      event.clientX,
      event.clientY
    );

  }, {
    capture: true,
    passive: true
  });

  // --------------------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------------------

  window.ClickFX = {
    enable() {
      CONFIG.enabled = true;
    },

    disable() {
      CONFIG.enabled = false;
      effects.length = 0;

      if (animation) {
        cancelAnimationFrame(animation);
        animation = 0;
      }

      if (ctx) {
        ctx.clearRect(0, 0, width, height);
      }
    },

    setColors(primary, secondary) {
      if (primary) CONFIG.primary = primary;
      if (secondary) CONFIG.secondary = secondary;
    },

    setDuration(ms) {
      CONFIG.duration = Math.max(200, Math.min(ms, 1500));
    }
  };

})();
