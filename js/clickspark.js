/**
 * ClickSpark Effect
 * Adapted from React Bits (https://reactbits.dev/)
 * Native Vanilla JS implementation using Canvas 2D
 */

class ClickSpark {
  constructor(options = {}) {
    this.sparkColorInput = options.sparkColor || 'var(--accent)';
    this.sparkSize = options.sparkSize !== undefined ? options.sparkSize : 10;
    this.sparkRadius = options.sparkRadius !== undefined ? options.sparkRadius : 15;
    this.sparkCount = options.sparkCount !== undefined ? options.sparkCount : 8;
    this.duration = options.duration !== undefined ? options.duration : 400;
    this.easing = options.easing || 'ease-out';
    this.extraScale = options.extraScale !== undefined ? options.extraScale : 1.0;

    this.sparks = [];
    this.animationId = null;
    this.resizeHandler = null;
    this.clickHandler = null;

    this.init();
  }

  getResolvedColor() {
    let color = this.sparkColorInput;
    if (color.startsWith('var(')) {
      const varName = color.match(/var\(([^)]+)\)/)[1].trim();
      color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    } else if (color.startsWith('--')) {
      color = getComputedStyle(document.documentElement).getPropertyValue(color).trim();
    }
    return color || '#b8ff3c';
  }

  init() {
    this.canvas = document.createElement('canvas');
    this.canvas.classList.add('click-spark-canvas');
    
    // Apply styling so it covers the viewport cleanly
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100vw';
    this.canvas.style.height = '100vh';
    this.canvas.style.zIndex = '99999';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.userSelect = 'none';
    this.canvas.style.display = 'block';

    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.resizeHandler = this.resizeCanvas.bind(this);
    window.addEventListener('resize', this.resizeHandler);
    this.resizeCanvas();

    this.clickHandler = this.handleClick.bind(this);
    window.addEventListener('click', this.clickHandler, { passive: true });
  }

  resizeCanvas() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  easeFunc(t) {
    switch (this.easing) {
      case 'linear':
        return t;
      case 'ease-in':
        return t * t;
      case 'ease-in-out':
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      default:
        return t * (2 - t); // ease-out
    }
  }

  handleClick(e) {
    const x = e.clientX;
    const y = e.clientY;
    const now = performance.now();
    const resolvedColor = this.getResolvedColor();

    const wasEmpty = this.sparks.length === 0;

    for (let i = 0; i < this.sparkCount; i++) {
      this.sparks.push({
        x,
        y,
        angle: (2 * Math.PI * i) / this.sparkCount,
        startTime: now,
        color: resolvedColor
      });
    }

    if (wasEmpty) {
      this.startLoop();
    }
  }

  startLoop() {
    if (this.animationId) return;
    const loop = (timestamp) => {
      this.draw(timestamp);
      if (this.sparks.length > 0) {
        this.animationId = requestAnimationFrame(loop);
      } else {
        this.animationId = null;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    };
    this.animationId = requestAnimationFrame(loop);
  }

  draw(timestamp) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.sparks = this.sparks.filter(spark => {
      const elapsed = timestamp - spark.startTime;
      if (elapsed >= this.duration) {
        return false;
      }

      const progress = elapsed / this.duration;
      const eased = this.easeFunc(progress);

      const distance = eased * this.sparkRadius * this.extraScale;
      const lineLength = this.sparkSize * (1 - eased);

      const x1 = spark.x + distance * Math.cos(spark.angle);
      const y1 = spark.y + distance * Math.sin(spark.angle);
      const x2 = spark.x + (distance + lineLength) * Math.cos(spark.angle);
      const y2 = spark.y + (distance + lineLength) * Math.sin(spark.angle);

      this.ctx.strokeStyle = spark.color;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();

      return true;
    });
  }

  destroy() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('click', this.clickHandler);
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}

// Make globally available
window.ClickSpark = ClickSpark;

// Auto-initialize when content loads
document.addEventListener('DOMContentLoaded', () => {
  new ClickSpark({
    sparkColor: 'var(--accent)',
    sparkSize: 12,
    sparkRadius: 18,
    sparkCount: 8,
    duration: 450,
    easing: 'ease-out',
    extraScale: 1.2
  });
});
