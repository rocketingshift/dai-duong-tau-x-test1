// js/main.js — v3 (Globe + Timeline scenes)
import * as THREE         from 'three';
import { GLTFLoader }     from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader }     from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GlobeScene }     from './GlobeScene.js';
import { TimelineScene }  from './TimelineScene.js';

/* ─── CDN roots ─────────────────────────────────────────── */
const R1 = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x-1@main/';
const R4 = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x4@main/';

/* ─── Renderer (one renderer, shared by all scenes) ──────── */
const canvas   = document.getElementById('webgl-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled   = true;
renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
renderer.outputColorSpace    = THREE.SRGBColorSpace;

/* ─── Loaders ────────────────────────────────────────────── */
const ktx2Loader = new KTX2Loader().setTranscoderPath(R1).detectSupport(renderer);
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Loader);

/* ─── DOM ────────────────────────────────────────────────── */
const elPreloader    = document.getElementById('preloader');
const elIntroduction = document.getElementById('introduction');
const elScroller     = document.getElementById('scroller');
const elHeader       = document.getElementById('site-header');
const elScrollInd    = document.getElementById('scroll-indicator');
const elUiBottom     = document.getElementById('ui-bottom');

/* ─── Scene transition overlay (created in JS) ───────────── */
const overlay = document.createElement('div');
Object.assign(overlay.style, {
  position:   'fixed', inset: '0',
  background: '#07192d',
  opacity:    '0',
  transition: 'opacity 0.6s ease',
  pointerEvents: 'none',
  zIndex:     '50',
});
document.body.appendChild(overlay);

/* ─── Scroll ─────────────────────────────────────────────── */
const LAMBDA = 6;
let rawScroll  = 0;
let smoothScr  = 0;
let isTouch    = false;
let lastRaw    = 0;

window.addEventListener('scroll', () => { rawScroll = window.scrollY; }, { passive: true });

let _ty = 0;
window.addEventListener('touchstart', e => {
  _ty = e.touches[0].clientY; isTouch = true;
}, { passive: true });
window.addEventListener('touchmove', e => {
  const dy = _ty - e.touches[0].clientY;
  window.scrollBy(0, dy);
  _ty = e.touches[0].clientY;
}, { passive: true });

/* ─── Scene config ───────────────────────────────────────── */
const GLOBE_END   = 0.28; // Globe scene active: 0 → 28%
const TRANS_WIDTH = 0.04; // Crossfade zone:    28% → 32%
const TIMELINE_START = GLOBE_END + TRANS_WIDTH; // 32% → 100%

let phase       = 'preload';
let activeScene = 'globe'; // 'globe' | 'transition' | 'timeline'
let transitioning = false;

/* ─── Scenes ─────────────────────────────────────────────── */
const globeScene    = new GlobeScene(renderer);
const timelineScene = new TimelineScene(renderer);

/* ─── Progress ───────────────────────────────────────────── */
function setProgress(frac) {
  const pct = Math.round(frac * 100);
  elPreloader.querySelectorAll('*').forEach(el => {
    if (!el.childElementCount && /^\d+%$/.test(el.textContent.trim())) {
      el.textContent = pct + '%';
    }
  });
}

function showUI(el, fadeMs = 600) {
  if (!el) return;
  el.removeAttribute('style');
  el.style.opacity    = '0';
  el.style.transition = `opacity ${fadeMs}ms ease`;
  requestAnimationFrame(() => { el.style.opacity = '1'; });
}

function hideUI(el, fadeMs = 400) {
  if (!el) return;
  el.style.transition = `opacity ${fadeMs}ms ease`;
  el.style.opacity    = '0';
  setTimeout(() => { el.style.display = 'none'; }, fadeMs);
}

/* ─── Scene switch ───────────────────────────────────────── */
function switchToTimeline() {
  if (transitioning || activeScene === 'timeline') return;
  transitioning = true;

  // Fade to dark
  overlay.style.opacity = '1';
  setTimeout(() => {
    activeScene = 'timeline';
    // Show header + scroll indicator after switching
    showUI(elHeader);
    showUI(elScrollInd, 800);
    // Fade back
    overlay.style.opacity = '0';
    setTimeout(() => { transitioning = false; }, 650);
  }, 620);
}

function switchToGlobe() {
  if (transitioning || activeScene === 'globe') return;
  transitioning = true;

  overlay.style.opacity = '1';
  setTimeout(() => {
    activeScene = 'globe';
    hideUI(elHeader);
    hideUI(elScrollInd);
    overlay.style.opacity = '0';
    setTimeout(() => { transitioning = false; }, 650);
  }, 620);
}

/* ─── Init ───────────────────────────────────────────────── */
const loaderOpts = { gltfLoader, ktx2Loader, R1, R4 };

// Load Globe first (shown in preloader)
globeScene.init({ ...loaderOpts, onProgress: setProgress })
  .then(() => {
    // Show intro immediately
    elPreloader.style.transition = 'opacity 0.8s ease';
    elPreloader.style.opacity    = '0';
    setTimeout(() => {
      elPreloader.style.display = 'none';
      showUI(elIntroduction);
      phase = 'intro';
      globeScene.startIntro();
    }, 800);

    // Load Timeline in background (no spinner needed)
    return timelineScene.init({ ...loaderOpts, onProgress: null });
  })
  .then(() => {
    console.log('[main] TimelineScene background-loaded ✓');
  })
  .catch(err => {
    console.error('[main] init error:', err);
    elPreloader.style.display = 'none';
    phase = 'globe';
  });

/* ─── Clock ──────────────────────────────────────────────── */
const clock = new THREE.Clock();

/* ─── Loop ───────────────────────────────────────────────── */
(function loop() {
  requestAnimationFrame(loop);

  const dt    = Math.min(clock.getDelta(), 0.05);
  const alpha = 1 - Math.exp(-LAMBDA * dt);
  smoothScr  += (rawScroll - smoothScr) * alpha;

  const scrollH    = Math.max(elScroller.scrollHeight - window.innerHeight, 1);
  const scrollFrac = Math.min(smoothScr / scrollH, 1);

  // Scroll delta for timeline (raw per-frame change)
  const rawDelta = (rawScroll - lastRaw) / window.innerHeight;
  lastRaw = rawScroll;

  /* ── Route to active scene ─────────────────────────────── */
  if (scrollFrac < GLOBE_END) {
    // Globe zone
    if (activeScene !== 'globe') switchToGlobe();
    const localFrac = scrollFrac / GLOBE_END;
    globeScene.update(dt, localFrac, phase);
    globeScene.render();

  } else if (scrollFrac < TIMELINE_START) {
    // Transition zone (short crossfade triggered once)
    if (activeScene === 'globe' && !transitioning) switchToTimeline();

    // While transitioning, keep rendering globe
    if (activeScene === 'globe' || transitioning) {
      globeScene.update(dt, 1.0, phase);
      globeScene.render();
    } else {
      const localFrac = (scrollFrac - TIMELINE_START) / (1 - TIMELINE_START);
      timelineScene.addScrollDelta(rawDelta, isTouch);
      timelineScene.update(dt, Math.max(0, localFrac), phase);
      timelineScene.render();
    }

  } else {
    // Timeline zone
    if (activeScene !== 'timeline' && !transitioning) switchToTimeline();
    const localFrac = (scrollFrac - TIMELINE_START) / (1 - TIMELINE_START);
    timelineScene.addScrollDelta(rawDelta, isTouch);
    timelineScene.update(dt, Math.min(1, localFrac), phase);
    timelineScene.render();
  }
}());

/* ─── Resize ─────────────────────────────────────────────── */
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  globeScene.onResize();
  timelineScene.onResize();
});
