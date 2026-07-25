/**
 * DotGrid Background Effect
 * Adapted from React Bits (https://reactbits.dev/)
 * Native Vanilla JS implementation using Canvas & GSAP
 */

class DotGrid {
  constructor(container, options = {}) {
    if (!container) return;
    this.container = container;
    
    // Create wrapper & canvas element
    const wrapper = document.createElement('div');
    wrapper.className = 'dot-grid__wrap';
    
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'dot-grid__canvas';
    wrapper.appendChild(this.canvas);
    this.container.appendChild(wrapper);

    this.wrapper = wrapper;

    // Component configurations
    this.dotSize = options.dotSize !== undefined ? options.dotSize : 16;
    this.gap = options.gap !== undefined ? options.gap : 32;
    this.baseColorInput = options.baseColor || '#5227FF';
    this.activeColorInput = options.activeColor || '#5227FF';
    this.proximity = options.proximity !== undefined ? options.proximity : 150;
    this.speedTrigger = options.speedTrigger !== undefined ? options.speedTrigger : 100;
    this.shockRadius = options.shockRadius !== undefined ? options.shockRadius : 250;
    this.shockStrength = options.shockStrength !== undefined ? options.shockStrength : 5;
    this.maxSpeed = options.maxSpeed !== undefined ? options.maxSpeed : 5000;
    this.resistance = options.resistance !== undefined ? options.resistance : 750;
    this.returnDuration = options.returnDuration !== undefined ? options.returnDuration : 1.5;

    // State data
    this.dots = [];
    this.pointer = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      speed: 0,
      lastTime: 0,
      lastX: 0,
      lastY: 0
    };

    // Color definitions
    this.baseRgb = { r: 82, g: 39, b: 255, a: 1 };
    this.activeRgb = { r: 82, g: 39, b: 255, a: 1 };

    this.init();
  }

  // Parse color string (hex, rgb, rgba) into {r, g, b, a}
  parseColor(colorStr) {
    const str = colorStr.trim().toLowerCase();
    
    // Hex formats
    if (str.startsWith('#')) {
      const hex = str.slice(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return { r, g, b, a: 1 };
      } else if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
        return { r, g, b, a };
      }
    }

    // RGB / RGBA formats
    const rgbMatch = str.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1], 10),
        g: parseInt(rgbMatch[2], 10),
        b: parseInt(rgbMatch[3], 10),
        a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1
      };
    }

    // Default fallback
    return { r: 82, g: 39, b: 255, a: 1 };
  }

  // Resolves color input (which can be a CSS variable)
  getResolvedColor(colorInput) {
    let color = colorInput;
    if (color.startsWith('var(')) {
      const varName = color.match(/var\(([^)]+)\)/)[1].trim();
      color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    } else if (color.startsWith('--')) {
      color = getComputedStyle(document.documentElement).getPropertyValue(color).trim();
    }
    return this.parseColor(color);
  }

  updateColors() {
    this.baseRgb = this.getResolvedColor(this.baseColorInput);
    this.activeRgb = this.getResolvedColor(this.activeColorInput);
    
    // Programmatically scale opacity to ensure the grid stays in the background
    this.baseRgb.a = 0.025;  // 2.5% opacity (matching original site grid layout)
    this.activeRgb.a = 0.15;  // 15% opacity (subtle, non-distracting highlight on hover)
  }

  init() {
    // Initial color calculation
    this.updateColors();

    // Monitor theme shifts on html root to re-resolve CSS variables
    this.observer = new MutationObserver(() => {
      this.updateColors();
    });
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    // Create reuseable Path2D for circle drawing
    this.circlePath = new Path2D();
    this.circlePath.arc(0, 0, this.dotSize / 2, 0, Math.PI * 2);

    this.buildGrid();
    this.setupResize();
    this.setupEvents();
    this.startDrawLoop();
  }

  buildGrid() {
    const wrap = this.wrapper;
    const canvas = this.canvas;
    if (!wrap || !canvas) return;

    const { width, height } = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    
    this.ctx = canvas.getContext('2d');
    if (this.ctx) {
      this.ctx.scale(dpr, dpr);
    }

    const cols = Math.floor((width + this.gap) / (this.dotSize + this.gap));
    const rows = Math.floor((height + this.gap) / (this.dotSize + this.gap));
    const cell = this.dotSize + this.gap;

    const gridW = cell * cols - this.gap;
    const gridH = cell * rows - this.gap;

    const extraX = width - gridW;
    const extraY = height - gridH;

    const startX = extraX / 2 + this.dotSize / 2;
    const startY = extraY / 2 + this.dotSize / 2;

    const dots = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cx = startX + x * cell;
        const cy = startY + y * cell;
        dots.push({ cx, cy, xOffset: 0, yOffset: 0, _inertiaApplied: false });
      }
    }
    this.dots = dots;
  }

  setupResize() {
    this.resizeHandler = () => this.buildGrid();
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver(this.resizeHandler);
      this.ro.observe(this.wrapper);
    } else {
      window.addEventListener('resize', this.resizeHandler);
    }
  }

  setupEvents() {
    const throttle = (func, limit) => {
      let lastCall = 0;
      return function (...args) {
        const now = performance.now();
        if (now - lastCall >= limit) {
          lastCall = now;
          func.apply(this, args);
        }
      };
    };

    const onMove = e => {
      const now = performance.now();
      const pr = this.pointer;
      const dt = pr.lastTime ? now - pr.lastTime : 16;
      const dx = e.clientX - pr.lastX;
      const dy = e.clientY - pr.lastY;
      
      let vx = (dx / dt) * 1000;
      let vy = (dy / dt) * 1000;
      let speed = Math.hypot(vx, vy);
      
      if (speed > this.maxSpeed) {
        const scale = this.maxSpeed / speed;
        vx *= scale;
        vy *= scale;
        speed = this.maxSpeed;
      }
      
      pr.lastTime = now;
      pr.lastX = e.clientX;
      pr.lastY = e.clientY;
      pr.vx = vx;
      pr.vy = vy;
      pr.speed = speed;

      const rect = this.canvas.getBoundingClientRect();
      pr.x = e.clientX - rect.left;
      pr.y = e.clientY - rect.top;

      const proxSq = this.proximity * this.proximity;

      for (const dot of this.dots) {
        const dist = Math.hypot(dot.cx - pr.x, dot.cy - pr.y);
        
        if (speed > this.speedTrigger && dist < this.proximity && !dot._inertiaApplied) {
          dot._inertiaApplied = true;
          
          if (window.gsap) {
            window.gsap.killTweensOf(dot);
            
            const pushX = dot.cx - pr.x + vx * 0.005;
            const pushY = dot.cy - pr.y + vy * 0.005;

            // Emulate InertiaPlugin physics using standard GSAP power2.out tween,
            // then return using elastic.out. This avoids the paid plugin dependency.
            window.gsap.to(dot, {
              xOffset: pushX,
              yOffset: pushY,
              duration: 0.35,
              ease: 'power2.out',
              onComplete: () => {
                window.gsap.to(dot, {
                  xOffset: 0,
                  yOffset: 0,
                  duration: this.returnDuration,
                  ease: 'elastic.out(1, 0.75)'
                });
                dot._inertiaApplied = false;
              }
            });
          } else {
            dot._inertiaApplied = false;
          }
        }
      }
    };

    const onClick = e => {
      const rect = this.canvas.getBoundingClientRect();
      const clickX = e.clientX;
      const clickY = e.clientY;

      // Only fire shockwave if click falls within the canvas layout bounds
      if (
        clickX >= rect.left &&
        clickX <= rect.right &&
        clickY >= rect.top &&
        clickY <= rect.bottom
      ) {
        const cx = clickX - rect.left;
        const cy = clickY - rect.top;
        
        for (const dot of this.dots) {
          const dist = Math.hypot(dot.cx - cx, dot.cy - cy);
          if (dist < this.shockRadius && !dot._inertiaApplied) {
            dot._inertiaApplied = true;
            
            if (window.gsap) {
              window.gsap.killTweensOf(dot);
              const falloff = Math.max(0, 1 - dist / this.shockRadius);
              const pushX = (dot.cx - cx) * this.shockStrength * falloff;
              const pushY = (dot.cy - cy) * this.shockStrength * falloff;
              
              window.gsap.to(dot, {
                xOffset: pushX,
                yOffset: pushY,
                duration: 0.4,
                ease: 'power2.out',
                onComplete: () => {
                  window.gsap.to(dot, {
                    xOffset: 0,
                    yOffset: 0,
                    duration: this.returnDuration,
                    ease: 'elastic.out(1, 0.75)'
                  });
                  dot._inertiaApplied = false;
                }
              });
            } else {
              dot._inertiaApplied = false;
            }
          }
        }
      }
    };

    this.throttledMove = throttle(onMove, 30);
    window.addEventListener('mousemove', this.throttledMove, { passive: true });
    
    this.clickHandler = onClick;
    window.addEventListener('click', this.clickHandler);
  }

  startDrawLoop() {
    const draw = () => {
      if (!this.ctx) return;
      
      const width = this.canvas.width / window.devicePixelRatio;
      const height = this.canvas.height / window.devicePixelRatio;
      this.ctx.clearRect(0, 0, width, height);

      const { x: px, y: py } = this.pointer;
      const proxSq = this.proximity * this.proximity;

      for (const dot of this.dots) {
        const ox = dot.cx + dot.xOffset;
        const oy = dot.cy + dot.yOffset;
        const dx = dot.cx - px;
        const dy = dot.cy - py;
        const dsq = dx * dx + dy * dy;

        let fillStyle = `rgba(${this.baseRgb.r}, ${this.baseRgb.g}, ${this.baseRgb.b}, ${this.baseRgb.a})`;
        
        if (dsq <= proxSq) {
          const dist = Math.sqrt(dsq);
          const t = 1 - dist / this.proximity;
          const r = Math.round(this.baseRgb.r + (this.activeRgb.r - this.baseRgb.r) * t);
          const g = Math.round(this.baseRgb.g + (this.activeRgb.g - this.baseRgb.g) * t);
          const b = Math.round(this.baseRgb.b + (this.activeRgb.b - this.baseRgb.b) * t);
          const a = this.baseRgb.a + (this.activeRgb.a - this.baseRgb.a) * t;
          fillStyle = `rgba(${r},${g},${b},${a})`;
        }

        this.ctx.save();
        this.ctx.translate(ox, oy);
        this.ctx.fillStyle = fillStyle;
        this.ctx.fill(this.circlePath);
        this.ctx.restore();
      }

      this.rafId = requestAnimationFrame(draw);
    };

    this.rafId = requestAnimationFrame(draw);
  }

  destroy() {
    if (this.observer) this.observer.disconnect();
    if (this.ro) this.ro.disconnect();
    else window.removeEventListener('resize', this.resizeHandler);
    
    window.removeEventListener('mousemove', this.throttledMove);
    window.removeEventListener('click', this.clickHandler);
    cancelAnimationFrame(this.rafId);
  }
}

// Auto-initialize when content loads
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('dot-grid');
  if (container) {
    new DotGrid(container, {
      dotSize: 6,           // Smaller, cleaner dots
      gap: 24,              // Greater distance for a less cluttered view
      baseColor: 'var(--border)', // Inherits the theme border color
      activeColor: 'var(--accent)', // Inherits the theme primary accent color
      proximity: 130,
      shockRadius: 250,
      shockStrength: 5,
      resistance: 750,
      returnDuration: 1.5
    });
  }
});
