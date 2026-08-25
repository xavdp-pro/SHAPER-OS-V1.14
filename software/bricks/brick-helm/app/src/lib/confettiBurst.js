/**
 * Slow falling confetti (no dependency) for personalized demo login.
 */
export function burstConfetti(durationMs = 6500) {
  if (typeof document === 'undefined') return;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:80';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const colors = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#f8fafc', '#fb7185'];
  const count = 140;
  const pieces = Array.from({ length: count }, () => ({
    x: Math.random() * window.innerWidth,
    // Stagger so pieces keep raining for several seconds
    y: -30 - Math.random() * window.innerHeight * 0.9,
    vx: (Math.random() - 0.5) * 0.55,
    vy: 0.55 + Math.random() * 0.75,
    w: 5 + Math.random() * 7,
    h: 7 + Math.random() * 9,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.06,
    color: colors[Math.floor(Math.random() * colors.length)],
    gravity: 0.012 + Math.random() * 0.01,
    sway: 0.25 + Math.random() * 0.45,
    swayPhase: Math.random() * Math.PI * 2,
  }));

  const start = performance.now();
  let raf = 0;
  const tick = (now) => {
    const t = now - start;
    const fade = Math.max(0, 1 - t / durationMs);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of pieces) {
      p.swayPhase += 0.02;
      p.vx = Math.sin(p.swayPhase) * p.sway * 0.35;
      p.vy += p.gravity;
      // Cap fall speed so it stays gentle
      if (p.vy > 1.6) p.vy = 1.6;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = fade;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < durationMs) {
      raf = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.remove();
    }
  };
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(tick);
}
