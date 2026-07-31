/**
 * TargetCursor Effect
 * Adapted from React Bits (https://reactbits.dev/)
 * Native Vanilla JS implementation using GSAP
 */

class TargetCursor {
  constructor(options = {}) {
    this.isMobile = (() => {
      if (typeof window === 'undefined') return false;
      const hasTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth <= 768;
      const userAgent = navigator.userAgent || navigator.vendor || window.opera;
      const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
      const isMobileUserAgent = mobileRegex.test(userAgent.toLowerCase());
      return (hasTouchScreen && isSmallScreen) || isMobileUserAgent;
    })();

    if (this.isMobile) return;

    this.container = document.getElementById('target-cursor');
    if (!this.container) return;

    this.dot = this.container.querySelector('.target-cursor-dot');
    this.corners = this.container.querySelectorAll('.target-cursor-corner');

    // Props / Config
    this.targetSelector = options.targetSelector || 'a, button, .proj-summary, .skill-cat, .ach-card, .blog-card, .contact-link, .btn-primary, .btn-outline, .btn-resume, .nav-resume, [role="button"], .cursor-target';
    this.spinDuration = options.spinDuration !== undefined ? options.spinDuration : 2;
    this.hideDefaultCursor = options.hideDefaultCursor !== undefined ? options.hideDefaultCursor : true;
    this.hoverDuration = options.hoverDuration !== undefined ? options.hoverDuration : 0.2;
    this.parallaxOn = options.parallaxOn !== undefined ? options.parallaxOn : true;
    this.cursorColorInput = options.cursorColor || 'var(--accent)';
    this.cursorColorOnTargetInput = options.cursorColorOnTarget || 'var(--accent2)';

    this.borderWidth = 3;
    this.cornerSize = 12;

    this.isActive = false;
    this.targetCornerPositions = null;
    this.activeStrength = { current: 0 };
    this.spinTl = null;
    this.activeTarget = null;
    this.currentLeaveHandler = null;
    this.resumeTimeout = null;

    this.init();
  }

  getContainingBlock(element) {
    let node = element?.parentElement;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (
        style.transform !== 'none' ||
        style.perspective !== 'none' ||
        style.filter !== 'none' ||
        style.willChange.includes('transform') ||
        style.willChange.includes('perspective') ||
        style.willChange.includes('filter') ||
        /paint|layout|strict|content/.test(style.contain)
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  getContainingBlockOffset(block) {
    if (!block) return { x: 0, y: 0 };
    const rect = block.getBoundingClientRect();
    return { x: rect.left + block.clientLeft, y: rect.top + block.clientTop };
  }

  getResolvedColor(colorInput) {
    let color = colorInput;
    if (color.startsWith('var(')) {
      const varName = color.match(/var\(([^)]+)\)/)[1].trim();
      color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    } else if (color.startsWith('--')) {
      color = getComputedStyle(document.documentElement).getPropertyValue(color).trim();
    }
    return color;
  }

  updateColors() {
    this.resolvedColor = this.getResolvedColor(this.cursorColorInput);
    this.resolvedColorOnTarget = this.cursorColorOnTargetInput ? this.getResolvedColor(this.cursorColorOnTargetInput) : null;
    
    if (!this.isActive) {
      gsap.set(this.corners, { borderColor: this.resolvedColor });
      gsap.set(this.dot, { backgroundColor: this.resolvedColor });
    } else if (this.resolvedColorOnTarget) {
      gsap.set(this.corners, { borderColor: this.resolvedColorOnTarget });
      gsap.set(this.dot, { backgroundColor: this.resolvedColorOnTarget });
    }
  }

  moveCursor(x, y) {
    if (!this.container) return;
    const { x: offsetX, y: offsetY } = this.getContainingBlockOffset(this.containingBlock);
    gsap.to(this.container, {
      x: x - offsetX,
      y: y - offsetY,
      duration: 0.1,
      ease: 'power3.out'
    });
  }

  init() {
    this.originalCursor = document.body.style.cursor;
    if (this.hideDefaultCursor) {
      document.body.style.cursor = 'none';
    }

    this.containingBlock = this.getContainingBlock(this.container);
    const initialOffset = this.getContainingBlockOffset(this.containingBlock);
    
    // Initial color setup
    this.updateColors();

    // Theme mutation observer
    this.observer = new MutationObserver(() => {
      this.updateColors();
    });
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    gsap.set(this.container, {
      xPercent: -50,
      yPercent: -50,
      x: window.innerWidth / 2 - initialOffset.x,
      y: window.innerHeight / 2 - initialOffset.y
    });

    this.createSpinTimeline();
    this.setupEvents();
  }

  createSpinTimeline() {
    if (this.spinTl) {
      this.spinTl.kill();
    }
    this.spinTl = gsap
      .timeline({ repeat: -1 })
      .to(this.container, { rotation: '+=360', duration: this.spinDuration, ease: 'none' });
  }

  setupEvents() {
    this.tickerFn = () => {
      if (!this.targetCornerPositions || !this.container || !this.corners) {
        return;
      }

      const strength = this.activeStrength.current;
      if (strength === 0) return;

      const cursorX = gsap.getProperty(this.container, 'x');
      const cursorY = gsap.getProperty(this.container, 'y');

      const corners = Array.from(this.corners);
      corners.forEach((corner, i) => {
        const currentX = gsap.getProperty(corner, 'x');
        const currentY = gsap.getProperty(corner, 'y');

        const targetX = this.targetCornerPositions[i].x - cursorX;
        const targetY = this.targetCornerPositions[i].y - cursorY;

        const finalX = currentX + (targetX - currentX) * strength;
        const finalY = currentY + (targetY - currentY) * strength;

        const duration = strength >= 0.99 ? (this.parallaxOn ? 0.2 : 0) : 0.05;

        gsap.to(corner, {
          x: finalX,
          y: finalY,
          duration: duration,
          ease: duration === 0 ? 'none' : 'power1.out',
          overwrite: 'auto'
        });
      });
    };

    const moveHandler = e => this.moveCursor(e.clientX, e.clientY);
    window.addEventListener('mousemove', moveHandler);

    const scrollHandler = () => {
      if (!this.activeTarget || !this.container) return;
      const { x: offsetX, y: offsetY } = this.getContainingBlockOffset(this.containingBlock);
      const mouseX = gsap.getProperty(this.container, 'x') + offsetX;
      const mouseY = gsap.getProperty(this.container, 'y') + offsetY;
      const elementUnderMouse = document.elementFromPoint(mouseX, mouseY);
      
      const isStillOverTarget =
        elementUnderMouse &&
        (elementUnderMouse === this.activeTarget || elementUnderMouse.closest(this.targetSelector) === this.activeTarget);
      
      if (!isStillOverTarget) {
        if (this.currentLeaveHandler) {
          this.currentLeaveHandler();
        }
      }
    };
    window.addEventListener('scroll', scrollHandler, { passive: true });

    const mouseDownHandler = () => {
      if (!this.dot) return;
      gsap.to(this.dot, { scale: 0.7, duration: 0.3 });
      gsap.to(this.container, { scale: 0.9, duration: 0.2 });
    };

    const mouseUpHandler = () => {
      if (!this.dot) return;
      gsap.to(this.dot, { scale: 1, duration: 0.3 });
      gsap.to(this.container, { scale: 1, duration: 0.2 });
    };

    window.addEventListener('mousedown', mouseDownHandler);
    window.addEventListener('mouseup', mouseUpHandler);

    const cleanupTarget = target => {
      if (this.currentLeaveHandler) {
        target.removeEventListener('mouseleave', this.currentLeaveHandler);
      }
      this.currentLeaveHandler = null;
    };

    const enterHandler = e => {
      const directTarget = e.target;
      const allTargets = [];
      let current = directTarget;
      while (current && current !== document.body) {
        if (current.matches && current.matches(this.targetSelector)) {
          allTargets.push(current);
        }
        current = current.parentElement;
      }
      
      const target = allTargets[0] || null;
      if (!target || !this.container || !this.corners) return;
      if (this.activeTarget === target) return;
      if (this.activeTarget) {
        cleanupTarget(this.activeTarget);
      }
      if (this.resumeTimeout) {
        clearTimeout(this.resumeTimeout);
        this.resumeTimeout = null;
      }

      this.activeTarget = target;
      const corners = Array.from(this.corners);
      corners.forEach(corner => gsap.killTweensOf(corner, 'x,y'));

      gsap.killTweensOf(this.container, 'rotation');
      this.spinTl?.pause();
      gsap.set(this.container, { rotation: 0 });

      if (this.resolvedColorOnTarget) {
        gsap.to(corners, {
          borderColor: this.resolvedColorOnTarget,
          duration: 0.15,
          ease: 'power2.out'
        });
        if (this.dot) {
          gsap.to(this.dot, {
            backgroundColor: this.resolvedColorOnTarget,
            duration: 0.15,
            ease: 'power2.out'
          });
        }
      }

      const rect = target.getBoundingClientRect();
      const { x: offsetX, y: offsetY } = this.getContainingBlockOffset(this.containingBlock);
      const cursorX = gsap.getProperty(this.container, 'x');
      const cursorY = gsap.getProperty(this.container, 'y');

      this.targetCornerPositions = [
        { x: rect.left - this.borderWidth - offsetX, y: rect.top - this.borderWidth - offsetY },
        { x: rect.right + this.borderWidth - this.cornerSize - offsetX, y: rect.top - this.borderWidth - offsetY },
        { x: rect.right + this.borderWidth - this.cornerSize - offsetX, y: rect.bottom + this.borderWidth - this.cornerSize - offsetY },
        { x: rect.left - this.borderWidth - offsetX, y: rect.bottom + this.borderWidth - this.cornerSize - offsetY }
      ];

      this.isActive = true;
      gsap.ticker.add(this.tickerFn);

      gsap.to(this.activeStrength, {
        current: 1,
        duration: this.hoverDuration,
        ease: 'power2.out'
      });

      corners.forEach((corner, i) => {
        gsap.to(corner, {
          x: this.targetCornerPositions[i].x - cursorX,
          y: this.targetCornerPositions[i].y - cursorY,
          duration: 0.2,
          ease: 'power2.out'
        });
      });

      const leaveHandler = () => {
        gsap.ticker.remove(this.tickerFn);

        this.isActive = false;
        this.targetCornerPositions = null;
        gsap.set(this.activeStrength, { current: 0, overwrite: true });
        this.activeTarget = null;

        if (this.resolvedColorOnTarget && this.corners) {
          gsap.to(Array.from(this.corners), {
            borderColor: this.resolvedColor,
            duration: 0.15,
            ease: 'power2.out'
          });
          if (this.dot) {
            gsap.to(this.dot, {
              backgroundColor: this.resolvedColor,
              duration: 0.15,
              ease: 'power2.out'
            });
          }
        }

        if (this.corners) {
          const corners = Array.from(this.corners);
          gsap.killTweensOf(corners, 'x,y');
          const positions = [
            { x: -this.cornerSize * 1.5, y: -this.cornerSize * 1.5 },
            { x: this.cornerSize * 0.5, y: -this.cornerSize * 1.5 },
            { x: this.cornerSize * 0.5, y: this.cornerSize * 0.5 },
            { x: -this.cornerSize * 1.5, y: this.cornerSize * 0.5 }
          ];
          const tl = gsap.timeline();
          corners.forEach((corner, index) => {
            tl.to(
              corner,
              {
                x: positions[index].x,
                y: positions[index].y,
                duration: 0.3,
                ease: 'power3.out'
              },
              0
            );
          });
        }

        this.resumeTimeout = setTimeout(() => {
          if (!this.activeTarget && this.container && this.spinTl) {
            const currentRotation = gsap.getProperty(this.container, 'rotation');
            const normalizedRotation = currentRotation % 360;
            this.spinTl.kill();
            this.spinTl = gsap
              .timeline({ repeat: -1 })
              .to(this.container, { rotation: '+=360', duration: this.spinDuration, ease: 'none' });
            
            gsap.to(this.container, {
              rotation: normalizedRotation + 360,
              duration: this.spinDuration * (1 - normalizedRotation / 360),
              ease: 'none',
              onComplete: () => {
                this.spinTl?.restart();
              }
            });
          }
          this.resumeTimeout = null;
        }, 50);

        cleanupTarget(target);
      };

      this.currentLeaveHandler = leaveHandler;
      target.addEventListener('mouseleave', leaveHandler);
    };

    window.addEventListener('mouseover', enterHandler, { passive: true });

    this.resizeHandler = () => {
      this.containingBlock = this.getContainingBlock(this.container);
    };
    window.addEventListener('resize', this.resizeHandler);

    this.cleanup = () => {
      gsap.ticker.remove(this.tickerFn);
      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('mouseover', enterHandler);
      window.removeEventListener('scroll', scrollHandler);
      window.removeEventListener('resize', this.resizeHandler);
      window.removeEventListener('mousedown', mouseDownHandler);
      window.removeEventListener('mouseup', mouseUpHandler);
      if (this.activeTarget) cleanupTarget(this.activeTarget);
      this.spinTl?.kill();
      if (this.observer) this.observer.disconnect();
      document.body.style.cursor = this.originalCursor;
    };
  }

  destroy() {
    if (this.cleanup) this.cleanup();
  }
}

// Auto-initialize when content loads
document.addEventListener('DOMContentLoaded', () => {
  const isAdminPage = window.location.pathname.includes('admin');
  window.targetCursorInstance = new TargetCursor({
    spinDuration: 4,
    hideDefaultCursor: !isAdminPage,
    parallaxOn: true,
    cursorColor: 'var(--accent)',
    cursorColorOnTarget: 'var(--accent2)'
  });
});
