/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  main.js — Đại Dương X  •  Scene Orchestrator  •  v5.0          ║
 * ║  Pure HTML + Three.js CDN (importmap), no build step             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 *  Flow:
 *    Preloader → Intro (Globe idle) → Enter click → Scroll Globe
 *    → at GLOBE_END → Lazy-init Timeline → Scroll Timeline → Ending
 */

import * as THREE from 'three';
import { GlobeScene }    from './GlobeScene.js';
import { TimelineScene } from './TimelineScene.js';

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fraction of total page scroll where Globe phase ends.
 * 0.05 = TEST MODE  (timeline appears quickly)
 * 0.28 = PRODUCTION (globe gets full cinematic zoom)
 */
const GLOBE_END = 0.05;

// ─────────────────────────────────────────────────────────────────────────────
//  DOM
// ─────────────────────────────────────────────────────────────────────────────

const canvas            = document.getElementById('webgl-canvas');
const elPreloader       = document.getElementById('preloader');
const elIntroduction    = document.getElementById('introduction');
const elHeader          = document.getElementById('site-header');
const elScrollIndicator = document.getElementById('scroll-indicator');
const elUIBottom        = document.getElementById('ui-bottom');
const elUIShare         = document.getElementById('ui-share');
const elPartners        = document.getElementById('partners');

// ─────────────────────────────────────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const showUI = (el) => { if (el) el.style.display = ''; };
const hideUI = (el) => { if (el) el.style.display = 'none'; };

function gtmPush (obj) {
  try { window.dataLayer && window.dataLayer.push(obj); } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERER  — created ONCE, shared between scenes
//  NOTE: Never create a second WebGLRenderer or PMREMGenerator at top-level.
// ─────────────────────────────────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace    = THREE.SRGBColorSpace;
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled   = false;

// ─────────────────────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────────────────────

let globeScene    = null;      // GlobeScene instance
let timelineScene = null;      // TimelineScene (lazy-init on transition)
let activeScene   = 'globe';   // 'globe' | 'timeline'

let isEntering         = false; // user has clicked Enter
let hasEnteredTimeline = false; // one-time Globe→Timeline switch
let endingTriggered    = false; // one-time ending UI reveal

let rawScroll = 0;  // current global scroll progress 0..1

// ─────────────────────────────────────────────────────────────────────────────
//  RESIZE
// ─────────────────────────────────────────────────────────────────────────────

function onResize () {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  globeScene?.onResize(w, h);
  timelineScene?.onResize(w, h);
}
window.addEventListener('resize', onResize);

// ─────────────────────────────────────────────────────────────────────────────
//  SCROLL  —  absolute progress (drives scene animation)
// ─────────────────────────────────────────────────────────────────────────────

function getScrollProgress () {
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  return maxY > 0 ? Math.min(1, window.scrollY / maxY) : 0;
}

window.addEventListener('scroll', () => {
  if (!isEntering) return;

  rawScroll = getScrollProgress();

  // ── Globe phase ──────────────────────────────────────────────────────────
  if (activeScene === 'globe') {
    // Map rawScroll [0 → GLOBE_END] → globeT [0 → 1]
    const globeT = Math.min(1, rawScroll / GLOBE_END);
    globeScene?.setProgress(globeT);

    if (rawScroll >= GLOBE_END && !hasEnteredTimeline) {
      switchToTimeline();
    }

  // ── Timeline phase ────────────────────────────────────────────────────────
  } else if (activeScene === 'timeline' && timelineScene) {
    // Map rawScroll [GLOBE_END → 1] → timelineT [0 → 1]
    const timelineT = Math.max(0, (rawScroll - GLOBE_END) / (1 - GLOBE_END));
    timelineScene.setProgress(Math.min(1, timelineT));

    if (timelineT >= 0.98 && !endingTriggered) {
      endingTriggered = true;
      onEnding();
    }
  }
}, { passive: true });

// ─────────────────────────────────────────────────────────────────────────────
//  WHEEL  —  scroll delta → TimelineScene camera shake + bow wake
//
//  addScrollDelta SETS (not +=) _delta inside TimelineScene.
//  Decay is handled by _delta *= 0.88 in update().
//  Scale: mouse wheel deltaY ≈ 100–300 → × 0.02 = 2–6 → clamped to ±5 ✓
//         trackpad  deltaY ≈   1–10  → × 0.02 = 0.02–0.2 ✓
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('wheel', (e) => {
  if (!isEntering || activeScene !== 'timeline' || !timelineScene) return;
  timelineScene.addScrollDelta(e.deltaY * 0.02);
}, { passive: true });

// ─────────────────────────────────────────────────────────────────────────────
//  SCENE TRANSITION  Globe → Timeline
// ─────────────────────────────────────────────────────────────────────────────

function switchToTimeline () {
  if (hasEnteredTimeline) return;
  hasEnteredTimeline = true;
  activeScene = 'timeline';

  // Hide Globe-phase UI elements
  hideUI(elScrollIndicator);   // ← critical fix: must hide here
  hideUI(elIntroduction);      // should already be hidden, belt-and-suspenders

  console.log('[DaiDuongX] → Switching to Timeline...');

  // Lazy-init TimelineScene (renderer already exists, pass it in)
  timelineScene = new TimelineScene(renderer);
  timelineScene.init()
    .then(() => {
      console.log('[DaiDuongX] TimelineScene ready ✓');
      showUI(elHeader);
      gtmPush({ event: 'open_chapter', id: 1, title: 'Hành Trình Bắt Đầu' });

      // Sync ship position to current scroll immediately (no jump)
      const timelineT = Math.max(0, (rawScroll - GLOBE_END) / (1 - GLOBE_END));
      timelineScene.setProgress(Math.min(1, timelineT));
    })
    .catch(err => console.error('[DaiDuongX] TimelineScene init error:', err));
}

// ─────────────────────────────────────────────────────────────────────────────
//  ENDING
// ─────────────────────────────────────────────────────────────────────────────

function onEnding () {
  showUI(elUIShare);
  showUI(elPartners);
  showUI(elUIBottom);
  gtmPush({ event: 'ending_reached' });
  console.log('[DaiDuongX] Ending reached 🎉');
}

// ─────────────────────────────────────────────────────────────────────────────
//  INTRO / ENTER BUTTON
// ─────────────────────────────────────────────────────────────────────────────

function showIntroScreen () {
  hideUI(elPreloader);
  showUI(elIntroduction);
  showUI(elScrollIndicator);
  document.body.classList.add('intro-visible');
}

function onEnterClick () {
  if (isEntering) return;
  isEntering = true;

  hideUI(elIntroduction);
  document.body.classList.remove('intro-visible');

  // Unlock scroll (was blocked during preload)
  document.body.style.overflow            = '';
  document.documentElement.style.overflow = '';

  // Ensure we start from top
  window.scrollTo({ top: 0, behavior: 'instant' });
  rawScroll = 0;

  gtmPush({ event: 'site_entered' });
  console.log('[DaiDuongX] Entered — scroll unlocked');
}

function bindEnterButton () {
  // Try common selectors for the Enter / CTA button inside #introduction
  const selectors = [
    '#introduction .enter-btn',
    '#introduction [data-action="enter"]',
    '#introduction .cta-btn',
    '#introduction button',
    '#introduction a',
  ];

  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn) {
      btn.addEventListener('click', (e) => { e.preventDefault(); onEnterClick(); }, { once: true });
      return;
    }
  }

  // Fallback: click anywhere on the intro panel
  elIntroduction?.addEventListener('click', onEnterClick, { once: true });
}

// ─────────────────────────────────────────────────────────────────────────────
//  ANIMATION LOOP
// ─────────────────────────────────────────────────────────────────────────────

let _lastRAFTime = performance.now();

function animate (now) {
  requestAnimationFrame(animate);

  const dt = Math.min((now - _lastRAFTime) * 0.001, 0.05); // seconds, capped 50 ms
  _lastRAFTime = now;

  if (activeScene === 'globe') {
    // ── Globe ────────────────────────────────────────────────────────────────
    if (globeScene) {
      globeScene.update(dt);
      globeScene.render();
    }

  } else {
    // ── Timeline ─────────────────────────────────────────────────────────────
    if (timelineScene?.ready) {
      // TimelineScene loaded → normal render
      timelineScene.update(dt);
      timelineScene.render();
    } else {
      // Still loading (GLB/textures in flight) → keep globe as fallback
      if (globeScene) {
        globeScene.update(dt);
        globeScene.render();
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────

async function init () {
  // Block scroll while assets load
  document.body.style.overflow            = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  showUI(elPreloader);

  try {
    globeScene = new GlobeScene(renderer);
    await globeScene.init();

    console.log('[DaiDuongX] GlobeScene ready ✓');
    gtmPush({ event: 'site_loaded' });

    showIntroScreen();
    bindEnterButton();

  } catch (err) {
    console.error('[DaiDuongX] GlobeScene init failed:', err);
    // Graceful degradation: hide preloader anyway
    hideUI(elPreloader);
    showUI(elIntroduction);
    bindEnterButton();
  }

  // Start RAF regardless of init outcome
  requestAnimationFrame(animate);
}

init();
