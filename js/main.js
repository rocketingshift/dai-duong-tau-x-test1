/**
 * main.js v5.1 — Đại Dương X
 * ─────────────────────────────────────────────────────────────────
 * • Renderer tạo MỘT LẦN, pass vào cả 2 scenes
 * • Wheel  → SET _delta (không +=), scale 0.02, decay 0.92/frame
 * • Scroll → đọc absProgress từ native scrollY
 * • Lazy-init TimelineScene tại GLOBE_END threshold
 * • Globe render làm fallback trong khi Timeline đang load
 * • GLOBE_END = 0.05 (test) / 0.28 (production)
 * ─────────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import { GlobeScene }    from './GlobeScene.js';
import { TimelineScene } from './TimelineScene.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const GLOBE_END   = 0.05;   // ← 0.05 = test | 0.28 = production
const DELTA_SCALE = 0.02;   // wheel.deltaY multiplier
const DELTA_MAX   = 5;      // clamp delta [-5, +5]
const DELTA_DECAY = 0.92;   // per-frame decay
const SMOOTH_K    = 0.08;   // smoothAbs coefficient
const SMOOTH_K2   = 0.08;   // smootherAbs coefficient
const DELTA_K     = 0.15;   // smoothDelta coefficient

// ═══════════════════════════════════════════════════════════════════
// MUTABLE STATE
// ═══════════════════════════════════════════════════════════════════
const S = {
  // lifecycle
  entered:       false,
  timelineInit:  false,
  timelineReady: false,
  endingFired:   false,

  // raw input
  absProgress:   0,   // 0–100  (% of full scroller)
  delta:         0,   // -5 to +5

  // Globe smoothers
  gSmoothAbs:    0,
  gSmootherAbs:  0,
  gSmoothDelta:  0,

  // Timeline-local smoothers (remapped 0–100)
  tProgress:     0,
  tSmoothAbs:    0,
  tSmootherAbs:  0,
  tSmoothDelta:  0,
};

// ═══════════════════════════════════════════════════════════════════
// THREE.JS OBJECTS
// ═══════════════════════════════════════════════════════════════════
let renderer, globeScene, timelineScene;

// ═══════════════════════════════════════════════════════════════════
// GTM HELPER
// ═══════════════════════════════════════════════════════════════════
function gtm(event, params = {}) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
}

// ═══════════════════════════════════════════════════════════════════
// DOM HELPERS
// ═══════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

/** Xóa inline display:none → fallback về CSS (flex/block/etc) */
function showEl(id) {
  const el = $(id);
  if (el) el.style.removeProperty('display');
}

/** Set inline display:none */
function hideEl(id) {
  const el = $(id);
  if (el) el.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════
// RENDERER  (tạo 1 lần, share giữa 2 scenes)
// ═══════════════════════════════════════════════════════════════════
function createRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas:          $('webgl-canvas'),
    antialias:       true,
    alpha:           false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
}

// ═══════════════════════════════════════════════════════════════════
// SCENE INIT
// ═══════════════════════════════════════════════════════════════════
async function initGlobe() {
  globeScene = new GlobeScene(renderer);
  await globeScene.init();
}

async function initTimeline() {
  if (S.timelineInit) return;
  S.timelineInit = true;
  try {
    timelineScene = new TimelineScene(renderer);
    await timelineScene.init();
    S.timelineReady = true;
    console.log('[Timeline] ready');
  } catch (err) {
    console.error('[Timeline] init failed:', err);
    S.timelineInit = false;  // allow retry next frame
  }
}

// ═══════════════════════════════════════════════════════════════════
// PROGRESS HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Đọc scroll progress từ native scrollY, trả về 0–100 */
function readScrollProgress() {
  const scroller = $('scroller');
  if (!scroller) return 0;
  const maxScroll = scroller.scrollHeight - window.innerHeight;
  if (maxScroll <= 0) return 0;
  return Math.min(100, (window.scrollY / maxScroll) * 100);
}

/**
 * Remap global scroll [GLOBE_END*100 … 100] → Timeline local [0 … 100]
 * shipX = (smootherAbs - 50) * 0.8  →  -40 … +40
 */
function remapTimeline(globalPct) {
  const lo = GLOBE_END * 100;
  const hi = 100;
  if (hi === lo) return 0;
  return Math.max(0, Math.min(100, (globalPct - lo) / (hi - lo) * 100));
}

// ═══════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════
function onWheel(e) {
  if (!S.entered) return;
  e.preventDefault();
  // SET delta (không +=) — clamp [-5, +5]
  const v = e.deltaY * DELTA_SCALE;
  S.delta = Math.max(-DELTA_MAX, Math.min(DELTA_MAX, v));
}

function onScroll() {
  if (!S.entered) return;
  S.absProgress = readScrollProgress();
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  globeScene?.onResize?.();
  timelineScene?.onResize?.();
}

// ═══════════════════════════════════════════════════════════════════
// ENTER SITE
// ═══════════════════════════════════════════════════════════════════
function enterSite() {
  if (S.entered) return;
  S.entered = true;
  hideEl('introduction');
  showEl('site-header');
  showEl('scroll-indicator');
  document.body.style.overflow = 'auto';  // unlock scroll
  gtm('site_entered');
}

// ═══════════════════════════════════════════════════════════════════
// ENDING
// ═══════════════════════════════════════════════════════════════════
function fireEnding() {
  if (S.endingFired) return;
  S.endingFired = true;
  showEl('ui-bottom');
  showEl('ui-share');
  showEl('partners');
  hideEl('scroll-indicator');
  gtm('ending_reached');
}

// ═══════════════════════════════════════════════════════════════════
// RENDER LOOP
// ═══════════════════════════════════════════════════════════════════
function tick() {
  requestAnimationFrame(tick);
  if (!S.entered) return;

  const abs  = S.absProgress;
  const inTl = abs >= GLOBE_END * 100;

  // ── Per-frame delta decay ────────────────────────────────────────
  S.delta *= DELTA_DECAY;

  // ── Globe smoothers (always updated for seamless transition) ─────
  S.gSmoothAbs   += (abs           - S.gSmoothAbs)   * SMOOTH_K;
  S.gSmootherAbs += (S.gSmoothAbs  - S.gSmootherAbs) * SMOOTH_K2;
  S.gSmoothDelta += (S.delta       - S.gSmoothDelta) * DELTA_K;

  // ── Branch: Globe vs Timeline ─────────────────────────────────────
  if (!inTl) {
    // ── GLOBE SCENE ────────────────────────────────────────────────
    const gPct = abs / (GLOBE_END * 100);  // 0–1
    globeScene?.update({
      progress:    Math.min(1, gPct),
      delta:       S.gSmoothDelta,
      smoothAbs:   S.gSmoothAbs,
      smootherAbs: S.gSmootherAbs,
    });
    globeScene?.render();

  } else {
    // ── TIMELINE SCENE ─────────────────────────────────────────────

    // Lazy-init (fire-and-forget, không block render loop)
    if (!S.timelineInit) initTimeline();

    // Timeline-local smooth values
    const tRaw = remapTimeline(abs);
    S.tSmoothAbs   += (tRaw          - S.tSmoothAbs)   * SMOOTH_K;
    S.tSmootherAbs += (S.tSmoothAbs  - S.tSmootherAbs) * SMOOTH_K2;
    S.tSmoothDelta += (S.delta       - S.tSmoothDelta) * DELTA_K;

    if (S.timelineReady) {
      timelineScene.update({
        absProgress:  tRaw,              // 0–100 timeline-local
        smoothAbs:    S.tSmoothAbs,
        smootherAbs:  S.tSmootherAbs,   // used by shipX formula
        smoothDelta:  S.tSmoothDelta,
        delta:        S.delta,
      });
      timelineScene.render();
    } else {
      // Timeline đang load → globe làm fallback
      globeScene?.render();
    }

    // Ending trigger
    if (abs >= 99.5) fireEnding();
  }
}

// ═══════════════════════════════════════════════════════════════════
// PRELOADER → INTRO
// ═══════════════════════════════════════════════════════════════════
async function onAssetsLoaded() {
  hideEl('preloader');
  showEl('introduction');

  // Tìm enter button theo nhiều selector
  const btn =
    $('enter-btn') ||
    document.querySelector('#introduction button') ||
    document.querySelector('#introduction [role="button"]') ||
    document.querySelector('#introduction a');

  if (btn) {
    btn.addEventListener('click', enterSite, { once: true });
  } else {
    // Fallback: click anywhere trên intro
    $('introduction')?.addEventListener('click', enterSite, { once: true });
  }
}

// ═══════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════
async function main() {
  // Lock scroll cho đến khi user nhấn Enter
  // NOTE: chỉ lock body, KHÔNG lock documentElement (gây bug trên Safari)
  document.body.style.overflow = 'hidden';

  // Show preloader
  showEl('preloader');

  // Tạo renderer
  createRenderer();

  // Init Globe (await — phải xong trước khi render loop bắt đầu)
  await initGlobe();

  // Register events
  window.addEventListener('wheel',  onWheel,  { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true  });
  window.addEventListener('resize', onResize, { passive: true  });

  // Share button
  $('ui-share')?.addEventListener('click', () => {
    gtm('share_clicked');
    if (navigator.share) {
      navigator.share({ title: 'Đại Dương X', url: location.href }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(location.href).catch(() => {});
    }
  });

  // GTM: site loaded
  gtm('site_loaded');

  // Show intro screen
  await onAssetsLoaded();

  // Bắt đầu render loop (idle cho đến khi S.entered = true)
  tick();
}

main().catch(err => console.error('[main] boot error:', err));
