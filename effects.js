/**
 * Gym Check visual effects: pill navigation with scrollspy, count-up of key figures, card reveal and spotlight.
 * Effects ported from React Bits (reactbits.dev), Copyright (c) 2026 David Haz, MIT + Commons Clause, full license
 * text in LICENSE-react-bits.md (PillNav, CountUp, AnimatedContent, SpotlightCard; GradientText and StarBorder live
 * in style.css).
 * Every effect only decorates content that is already final in the DOM: without IntersectionObserver or with
 * prefers-reduced-motion nothing is hidden, counted or animated.
 * @module effects
 */

const COUNT_DURATION_MS = 1200;
const COUNT_THRESHOLD = 0.3;
const REVEAL_SELECTOR = 'main > section.needs-data > .card, main > section.needs-data > .kpi-grid';
const REVEAL_THRESHOLD = 0.1;
const SPY_BAND_BOTTOM = '-60%';
const SPY_LOCK_MS = 1000;
const SPY_SCROLL_IDLE_MS = 200;
const PAGE_EDGE_PX = 2;
const SPOTLIGHT_TARGETS = '.card, .kpi';

const countJobs = new WeakMap();
const sectionsInBand = new Set();
let countObserver = null;
let nav = null;
let activeLink = null;
let spyLocked = false;
let unlockTimer = 0;

/**
 * Tells whether the user asked for reduced motion; evaluated live on every call.
 * @returns {boolean} True if animations should be skipped.
 */
export function prefersReducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Tells whether IntersectionObserver is available.
 * @returns {boolean} True if visibility can be observed.
 */
function canObserve() {
  return typeof window.IntersectionObserver === 'function';
}

/**
 * Cubic ease-out, identical to cubic-bezier(0.33, 1, 0.68, 1) of the React Bits CountUp.
 * @param {number} t Progress from 0 to 1.
 * @returns {number} Eased progress.
 */
function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/**
 * Animates a node from 0 to its target and finally restores the exact original text.
 * Stops as soon as the node is no longer part of the document (re-render).
 * @param {HTMLElement} node Value node.
 * @param {{to: number, format: function(number): string, final: string}} job Target, formatter and final text.
 * @returns {void}
 */
function runCount(node, job) {
  const start = performance.now();
  const step = (now) => {
    if (!node.isConnected) {
      return;
    }
    const t = Math.min(1, Math.max(0, (now - start) / COUNT_DURATION_MS));
    if (t >= 1) {
      node.textContent = job.final;
      return;
    }
    node.textContent = job.format(job.to * easeOutCubic(t));
    window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

/**
 * Starts pending count-ups of value nodes that became visible and drops nodes that left the document.
 * @param {IntersectionObserverEntry[]} entries Observer entries.
 * @returns {void}
 */
function onCountVisible(entries) {
  entries.forEach((entry) => {
    const node = entry.target;
    if (!node.isConnected) {
      countObserver.unobserve(node);
      countJobs.delete(node);
      return;
    }
    if (!entry.isIntersecting) {
      return;
    }
    countObserver.unobserve(node);
    const job = countJobs.get(node);
    countJobs.delete(node);
    if (job) {
      runCount(node, job);
    }
  });
}

/**
 * Counts a value node up from 0 once it becomes visible; the node keeps its final text until then.
 * Does nothing for non-finite or zero targets, with reduced motion or without IntersectionObserver.
 * @param {HTMLElement} node Value node whose textContent is the final text.
 * @param {number} to Target number.
 * @param {function(number): string} format Formatter for intermediate values.
 * @returns {void}
 */
export function countUp(node, to, format) {
  if (!Number.isFinite(to) || to === 0 || prefersReducedMotion() || !canObserve()) {
    return;
  }
  countJobs.set(node, { to, format, final: node.textContent });
  countObserver ??= new window.IntersectionObserver(onCountVisible, { threshold: COUNT_THRESHOLD });
  countObserver.observe(node);
}

/**
 * Moves the glide indicator under the active link; the indicator is only shown after a real measurement.
 * @returns {void}
 */
function measureIndicator() {
  if (!nav || !activeLink) {
    return;
  }
  const width = activeLink.offsetWidth;
  nav.style.setProperty('--pill-x', `${activeLink.offsetLeft}px`);
  nav.style.setProperty('--pill-w', `${width}px`);
  nav.classList.toggle('has-indicator', width > 0);
}

/**
 * Scrolls the navigation horizontally so that a link is centered.
 * @param {HTMLElement} link Navigation link.
 * @returns {void}
 */
function centerLink(link) {
  const left = link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
  nav.scrollTo?.({ left: Math.max(0, left), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/**
 * Marks a navigation link as current, moves the indicator to it and centers it.
 * @param {HTMLElement|null} link Navigation link.
 * @returns {void}
 */
function setActiveLink(link) {
  if (!nav || !link) {
    return;
  }
  activeLink = link;
  nav.querySelectorAll('a').forEach((a) => {
    if (a === link) {
      a.setAttribute('aria-current', 'true');
    } else {
      a.removeAttribute('aria-current');
    }
  });
  measureIndicator();
  centerLink(link);
}

/**
 * Releases the scrollspy lock set by a navigation click.
 * @returns {void}
 */
function unlockSpy() {
  window.clearTimeout(unlockTimer);
  spyLocked = false;
}

/**
 * (Re)starts the timer that releases the scrollspy lock; fallback for browsers without scrollend.
 * @param {number} ms Delay in milliseconds.
 * @returns {void}
 */
function armUnlock(ms) {
  window.clearTimeout(unlockTimer);
  unlockTimer = window.setTimeout(unlockSpy, ms);
}

/**
 * Locks the scrollspy after a navigation click until the jump has ended, so passing sections do not take over.
 * @returns {void}
 */
function lockSpy() {
  spyLocked = true;
  armUnlock(SPY_LOCK_MS);
}

/**
 * Picks the section to mark as current: the first one at the top of the page, the last one at the bottom,
 * otherwise the first visible section in document order that crosses the band below the header.
 * @returns {HTMLElement|undefined} Section or undefined if none applies.
 */
function spyTarget() {
  const sections = [...document.querySelectorAll('main > section')].filter((s) => !s.hidden);
  if (window.scrollY <= PAGE_EDGE_PX) {
    return sections[0];
  }
  if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - PAGE_EDGE_PX) {
    return sections[sections.length - 1];
  }
  return sections.find((s) => sectionsInBand.has(s));
}

/**
 * Marks the link of the current section unless the scrollspy is locked by a click.
 * @returns {void}
 */
function syncActive() {
  if (!nav || spyLocked) {
    return;
  }
  const section = spyTarget();
  const link = section && nav.querySelector(`a[href="#${section.id}"]`);
  if (link && !link.hidden && link !== activeLink) {
    setActiveLink(link);
  }
}

/**
 * Tracks the sections crossing the band below the header, entry by entry in delivery order.
 * @param {IntersectionObserverEntry[]} entries Observer entries.
 * @returns {void}
 */
function onSectionInBand(entries) {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      sectionsInBand.add(entry.target);
    } else {
      sectionsInBand.delete(entry.target);
    }
  });
  syncActive();
}

/**
 * Binds the pill navigation: click activation with scrollspy lock, scrollspy over the main sections, page edges
 * on scroll and re-measuring on resize.
 * @returns {void}
 */
function initNav() {
  nav = document.querySelector('.pill-nav');
  if (!nav) {
    return;
  }
  nav.addEventListener('click', (e) => {
    const link = e.target.closest?.('a[href^="#"]');
    if (link) {
      lockSpy();
      setActiveLink(link);
    }
  });
  if (canObserve()) {
    const headerHeight = Math.ceil(document.querySelector('.site-header')?.offsetHeight ?? 0);
    const spy = new window.IntersectionObserver(onSectionInBand, {
      rootMargin: `-${headerHeight + 1}px 0px ${SPY_BAND_BOTTOM} 0px`,
    });
    document.querySelectorAll('main > section').forEach((section) => spy.observe(section));
  }
  let scrollPending = false;
  document.addEventListener('scroll', () => {
    if (spyLocked) {
      armUnlock(SPY_SCROLL_IDLE_MS);
      return;
    }
    if (scrollPending) {
      return;
    }
    scrollPending = true;
    window.requestAnimationFrame(() => {
      scrollPending = false;
      syncActive();
    });
  }, { passive: true });
  document.addEventListener('scrollend', unlockSpy);
  let pending = false;
  window.addEventListener('resize', () => {
    if (pending) {
      return;
    }
    pending = true;
    window.requestAnimationFrame(() => {
      pending = false;
      measureIndicator();
    });
  });
}

/**
 * Re-synchronizes the navigation after rendering: a hidden or missing active link falls back to the first
 * visible link, then the indicator is measured again.
 * @returns {void}
 */
export function updateNav() {
  if (!nav) {
    return;
  }
  const links = [...nav.querySelectorAll('a')];
  if (!activeLink || activeLink.hidden || !links.includes(activeLink)) {
    setActiveLink(links.find((a) => !a.hidden) ?? null);
    return;
  }
  measureIndicator();
}

/**
 * Fades the data cards in when they scroll into view; content is only hidden under html.fx.
 * @returns {void}
 */
function initReveal() {
  if (!canObserve() || prefersReducedMotion()) {
    return;
  }
  document.documentElement.classList.add('fx');
  const observer = new window.IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: REVEAL_THRESHOLD });
  document.querySelectorAll(REVEAL_SELECTOR).forEach((node) => observer.observe(node));
}

/**
 * Lets a light follow the pointer on cards and key figures; only for fine pointers that can hover.
 * @returns {void}
 */
function initSpotlight() {
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
    return;
  }
  let last = null;
  let frame = 0;
  document.addEventListener('pointermove', (e) => {
    last = e;
    if (frame) {
      return;
    }
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      let card = last.target.closest?.(SPOTLIGHT_TARGETS);
      while (card) {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${last.clientX - rect.left}px`);
        card.style.setProperty('--my', `${last.clientY - rect.top}px`);
        card = card.parentElement?.closest(SPOTLIGHT_TARGETS);
      }
    });
  }, { passive: true });
}

/**
 * Starts navigation, reveal and spotlight; call once before the first render.
 * @returns {void}
 */
export function initEffects() {
  initNav();
  initReveal();
  initSpotlight();
}
