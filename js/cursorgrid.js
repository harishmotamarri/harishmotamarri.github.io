/**
 * CursorGrid Effect
 * Adapted from React Bits (https://reactbits.dev/)
 * Native Vanilla JS implementation using HTML5 Canvas 2D
 */

const FALLOFF_CURVES = {
  linear: t => t,
  smooth: t => t * t * (3 - 2 * t),
  sharp: t => t * t * t
};

const getResolvedRgb = colorInput => {
  let color = colorInput;
  if (color.startsWith('var(')) {
    const varName = color.match(/var\(([^)]+)\)/)[1].trim();
    color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }
  // Fallback to primary accent if variable is not resolved
  if (!color || !color.startsWith('#')) {
    color = '#b8ff3c';
  }
  const h = color.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const num = parseInt(v.slice(0, 6), 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
};

class CursorGrid {
  constructor(container, options = {}) {
    if (!container) return;
    this.container = container;

    // Apply styles to container
    this.container.classList.add('cursor-grid');

    this.options = {
      cellSize: options.cellSize || 70,
      color: options.color || '#D946EF',
      radius: options.radius !== undefined ? options.radius : 140,
      falloff: options.falloff || 'smooth',
      holdTime: options.holdTime !== undefined ? options.holdTime : 400,
      fadeDuration: options.fadeDuration !== undefined ? options.fadeDuration : 800,
      lineWidth: options.lineWidth !== undefined ? options.lineWidth : 1.2,
      maxOpacity: options.maxOpacity !== undefined ? options.maxOpacity : 1,
      fillOpacity: options.fillOpacity !== undefined ? options.fillOpacity : 0,
      gridOpacity: options.gridOpacity !== undefined ? options.gridOpacity : 0,
      cellRadius: options.cellRadius !== undefined ? options.cellRadius : 0,
      clickPulse: options.clickPulse !== undefined ? options.clickPulse : true,
      pulseSpeed: options.pulseSpeed !== undefined ? options.pulseSpeed : 600
    };

    this.init();
  }

  init() {
    this.canvas = document.createElement('canvas');
    this.canvas.classList.add('cursor-grid__canvas');
    this.container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.cols = 0;
    this.rows = 0;
    this.offX = 0;
    this.offY = 0;
    this.alphas = new Float32Array(0);
    this.touched = new Float64Array(0);
    this.w = 0;
    this.h = 0;
    this.pulses = [];
    this.raf = 0;
    this.running = false;
    this.lastFrame = 0;

    this.rebuild = () => {
      const p = this.options;
      this.w = this.container.offsetWidth;
      this.h = this.container.offsetHeight;
      this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
      this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
      this.canvas.style.width = `${this.w}px`;
      this.canvas.style.height = `${this.h}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.cols = Math.ceil(this.w / p.cellSize) + 1;
      this.rows = Math.ceil(this.h / p.cellSize) + 1;
      
      this.offX = (this.w - this.cols * p.cellSize) / 2;
      this.offY = (this.h - this.rows * p.cellSize) / 2;
      this.alphas = new Float32Array(this.cols * this.rows);
      this.touched = new Float64Array(this.cols * this.rows);
    };

    this.cellCenter = i => {
      const p = this.options;
      const cx = this.offX + (i % this.cols) * p.cellSize + p.cellSize / 2;
      const cy = this.offY + Math.floor(i / this.cols) * p.cellSize + p.cellSize / 2;
      return [cx, cy];
    };

    this.energize = (x, y, boost) => {
      const p = this.options;
      const r = Math.max(p.radius, 1);
      const ease = FALLOFF_CURVES[p.falloff] ?? FALLOFF_CURVES.linear;
      const now = performance.now();
      const minCol = Math.max(0, Math.floor((x - r - this.offX) / p.cellSize));
      const maxCol = Math.min(this.cols - 1, Math.floor((x + r - this.offX) / p.cellSize));
      const minRow = Math.max(0, Math.floor((y - r - this.offY) / p.cellSize));
      const maxRow = Math.min(this.rows - 1, Math.floor((y + r - this.offY) / p.cellSize));
      for (let cRow = minRow; cRow <= maxRow; cRow++) {
        for (let cCol = minCol; cCol <= maxCol; cCol++) {
          const i = cRow * this.cols + cCol;
          const [cx, cy] = this.cellCenter(i);
          const dist = Math.hypot(cx - x, cy - y);
          if (dist > r) continue;
          const level = ease(1 - dist / r) * p.maxOpacity * (boost ?? 1);
          if (level > this.alphas[i]) {
            this.alphas[i] = level;
            this.touched[i] = now;
          } else if (level > 0) {
            this.touched[i] = now;
          }
        }
      }
    };

    this.draw = now => {
      const p = this.options;
      const dt = Math.min(now - this.lastFrame, 50);
      this.lastFrame = now;
      this.ctx.clearRect(0, 0, this.w, this.h);
      const [cr, cg, cb] = getResolvedRgb(p.color);

      // Faint static lattice
      if (p.gridOpacity > 0) {
        this.ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${p.gridOpacity})`;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        for (let cCol = 0; cCol <= this.cols; cCol++) {
          const x = Math.round(this.offX + cCol * p.cellSize) + 0.5;
          this.ctx.moveTo(x, 0);
          this.ctx.lineTo(x, this.h);
        }
        for (let cRow = 0; cRow <= this.rows; cRow++) {
          const y = Math.round(this.offY + cRow * p.cellSize) + 0.5;
          this.ctx.moveTo(0, y);
          this.ctx.lineTo(this.w, y);
        }
        this.ctx.stroke();
      }

      // Expanding click pulses
      for (let pi = this.pulses.length - 1; pi >= 0; pi--) {
        const pulse = this.pulses[pi];
        const age = (now - pulse.t0) / 1000;
        const ringR = age * p.pulseSpeed;
        if (ringR > Math.hypot(this.w, this.h)) {
          this.pulses.splice(pi, 1);
          continue;
        }
        const band = p.cellSize;
        const minCol = Math.max(0, Math.floor((pulse.x - ringR - band - this.offX) / p.cellSize));
        const maxCol = Math.min(this.cols - 1, Math.floor((pulse.x + ringR + band - this.offX) / p.cellSize));
        const minRow = Math.max(0, Math.floor((pulse.y - ringR - band - this.offY) / p.cellSize));
        const maxRow = Math.min(this.rows - 1, Math.floor((pulse.y + ringR + band - this.offY) / p.cellSize));
        for (let cRow = minRow; cRow <= maxRow; cRow++) {
          for (let cCol = minCol; cCol <= maxCol; cCol++) {
            const i = cRow * this.cols + cCol;
            const [cx, cy] = this.cellCenter(i);
            const dist = Math.hypot(cx - pulse.x, cy - pulse.y);
            if (Math.abs(dist - ringR) < band / 2 && p.maxOpacity > this.alphas[i]) {
              this.alphas[i] = p.maxOpacity;
              this.touched[i] = now;
            }
          }
        }
      }

      let anyVisible = this.pulses.length > 0;
      const fadeStep = dt / Math.max(p.fadeDuration, 16);
      const half = p.cellSize / 2;

      for (let i = 0; i < this.alphas.length; i++) {
        let a = this.alphas[i];
        if (a <= 0) continue;
        if (now - this.touched[i] > p.holdTime) {
          a = Math.max(0, a - fadeStep);
          this.alphas[i] = a;
          if (a <= 0) continue;
        }
        anyVisible = true;

        const [cx, cy] = this.cellCenter(i);
        const gradient = this.ctx.createRadialGradient(cx, cy, half * 0.1, cx, cy, p.cellSize);
        gradient.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${a})`);
        gradient.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);

        const x = cx - half + 0.5;
        const y = cy - half + 0.5;
        const s = p.cellSize - 1;

        this.ctx.beginPath();
        if (p.cellRadius > 0) {
          this.ctx.roundRect(x, y, s, s, p.cellRadius);
        } else {
          this.ctx.rect(x, y, s, s);
        }
        if (p.fillOpacity > 0) {
          this.ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${a * p.fillOpacity})`;
          this.ctx.fill();
        }
        this.ctx.strokeStyle = gradient;
        this.ctx.lineWidth = p.lineWidth;
        this.ctx.stroke();
      }

      if (anyVisible) {
        this.raf = requestAnimationFrame(this.draw);
      } else {
        this.running = false;
        if (this.options.gridOpacity <= 0) this.ctx.clearRect(0, 0, this.w, this.h);
      }
    };

    this.wake = () => {
      if (this.running) return;
      this.running = true;
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.draw);
    };

    this.toLocal = e => {
      const rect = this.canvas.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    };

    this.onPointerMove = e => {
      const [x, y] = this.toLocal(e);
      this.energize(x, y);
      this.wake();
    };

    this.onPointerDown = e => {
      if (!this.options.clickPulse) return;
      const [x, y] = this.toLocal(e);
      this.pulses.push({ x, y, t0: performance.now() });
      this.wake();
    };

    this.ro = new ResizeObserver(() => {
      this.rebuild();
      this.wake();
    });
    this.ro.observe(this.container);
    
    this.rebuild();
    this.wake();

    this.container.addEventListener('pointermove', this.onPointerMove);
    this.container.addEventListener('pointerdown', this.onPointerDown);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    this.container.removeEventListener('pointermove', this.onPointerMove);
    this.container.removeEventListener('pointerdown', this.onPointerDown);
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}

// Make globally available
window.CursorGrid = CursorGrid;

// Auto-initialize when content loads
document.addEventListener('DOMContentLoaded', () => {
  const targets = ['skills-cursor-grid', 'achievements-cursor-grid'];
  targets.forEach(id => {
    const container = document.getElementById(id);
    if (container) {
      new CursorGrid(container, {
        cellSize: 64,
        color: 'var(--accent)',
        radius: 130,
        falloff: 'smooth',
        holdTime: 300,
        fadeDuration: 700,
        lineWidth: 1.2,
        maxOpacity: 0.85,
        fillOpacity: 0.08,
        gridOpacity: 0.03,
        cellRadius: 8,
        clickPulse: true,
        pulseSpeed: 550
      });
    }
  });
});
