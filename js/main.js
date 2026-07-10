// ============================================================
// main.js  v5.4
// Fix vs v5.3:
//   - Import GLTFLoader + KTX2Loader
//   - Tạo shared loaders sau renderer
//   - GlobeScene(renderer)    → constructor đúng (bỏ R4/BASIS_PATH)
//   - TimelineScene(renderer) → constructor đúng
//   - globeScene.init({ gltfLoader, ktx2Loader, R1, R4, onProgress })
//   - timelineScene.init({ gltfLoader, ktx2Loader, R1, R4, onProgress:null })
//   - per-scene toneMappingExposure: Globe=1.6 / Timeline=2.2
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader }  from 'three/addons/loaders/KTX2Loader.js';
import { GlobeScene }    from './GlobeScene.js';
import { TimelineScene } from './TimelineScene.js';

// ─── Asset CDN ───────────────────────────────────────────────────────────────
const R4         = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x4@main/';
const R1         = R4;   // x1 repo = 404 — dùng R4 cho tất cả assets
const BASIS_PATH = 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/basis/';

// ─── Config ──────────────────────────────────────────────────────────────────
const GLOBE_END = 0.05;   // scroll fraction Globe→Timeline
                           // 0.05 = test mode | 0.28 = production

// ─── App State ───────────────────────────────────────────────────────────────
const S = {
  entered:       false,
  timelineInit:  false,
  timelineReady: false,
  tlVirtual:     0,       // 0–100, mirror của TimelineScene._absScroll
  endingFired:   false,
  lastT:         null,
};

// ─── DOM ─────────────────────────────────────────────────────────────────────
const canvas          = document.getElementById('webgl-canvas');
const preloader       = document.getElementById('preloader');
const preloaderFill   = document.getElementById('preloader-fill');
const preloaderPct    = document.getElementById('preloader-pct');
const introduction    = document.getElementById('introduction');
const btnEnter        = document.getElementById('btn-enter');
const siteHeader      = document.getElementById('site-header');
const scrollIndicator = document.getElementById('scroll-indicator');
const uiBottom        = document.getElementById('ui-bottom');
const uiShare         = document.getElementById('ui-share');
const btnShare        = document.getElementById('btn-share');
const partners        = document.getElementById('partners');

// ─── Renderer ────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha:     false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;     // default; override per-scene trong tick()
renderer.outputColorSpace    = THREE.SRGBColorSpace;

// ─── Shared Loaders (tạo 1 lần, dùng chung cho cả 2 scenes) ────────────────
// KTX2Loader phải được tạo sau renderer (detectSupport cần WebGL context)
const gltfLoader = new GLTFLoader();
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath(BASIS_PATH);
ktx2Loader.detectSupport(renderer);

// ─── Scene Refs ───────────────────────────────────────────────────────────────
/** @type {GlobeScene|null}    */ let globeScene    = null;
/** @type {TimelineScene|null} */ let timelineScene = null;

// ─── GTM helper ──────────────────────────────────────────────────────────────
function gtm(event, params = {}) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
}

// ─── Preloader ───────────────────────────────────────────────────────────────
function setProgress(pct) {
  const p = Math.round(Math.min(100, Math.max(0, pct)));
  if (preloaderFill) preloaderFill.style.width = p + '%';
  if (preloaderPct)  preloaderPct.textContent  = p + '%';
}

function hidePreloader() {
  if (!preloader) return;
  preloader.style.transition = 'opacity 0.8s ease';
  preloader.style.opacity    = '0';
  setTimeout(() => { preloader.style.display = 'none'; }, 850);
}

// ─── Introduction panel ───────────────────────────────────────────────────────
function showIntroduction() {
  if (!introduction) return;
  introduction.style.display = 'flex';
  void introduction.offsetWidth;                        // force reflow
  introduction.style.transition = 'opacity 0.8s ease';
  introduction.style.opacity    = '1';
}

function hideIntroduction() {
  if (!introduction) return;
  introduction.style.transition = 'opacity 0.6s ease';
  introduction.style.opacity    = '0';
  setTimeout(() => { introduction.style.display = 'none'; }, 650);
}

// ─── Enter button ─────────────────────────────────────────────────────────────
if (btnEnter) {
  btnEnter.addEventListener('click', () => {
    if (S.entered) return;
    S.entered = true;
    hideIntroduction();
    globeScene?.startIntro();
    if (siteHeader) {
      siteHeader.style.transition = 'opacity 0.8s ease';
      siteHeader.style.opacity    = '1';
    }
    if (scrollIndicator) {
      scrollIndicator.style.transition = 'opacity 0.8s ease';
      scrollIndicator.style.opacity    = '1';
    }
    gtm('site_entered');
  });
}

// ─── Share button ─────────────────────────────────────────────────────────────
if (btnShare) {
  btnShare.addEventListener('click', () => {
    if (navigator.share) {
      navigator.share({
        title: 'Đại Dương X — 2025 A Year of Discovery',
        url:   window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(window.location.href).catch(() => {});
    }
    gtm('share_clicked');
  });
}

// ─── Timeline boot ────────────────────────────────────────────────────────────
function bootTimeline() {
  if (S.timelineInit) return;
  S.timelineInit = true;
  console.log('[main] Booting TimelineScene…');

  // Constructor chỉ nhận renderer — loaders truyền qua init()
  timelineScene = new TimelineScene(renderer);
  timelineScene.init({ gltfLoader, ktx2Loader, R1, R4, onProgress: null })
    .then(() => {
      S.timelineReady = true;
      console.log('[main] TimelineScene ready ✓');
    })
    .catch(err => {
      console.error('[main] TimelineScene init failed:', err);
    });
}

// ─── Ending ───────────────────────────────────────────────────────────────────
function fireEnding() {
  if (S.endingFired) return;
  S.endingFired = true;
  console.log('[main] fireEnding()');

  if (partners) {
    partners.style.display    = 'flex';
    void partners.offsetWidth;
    partners.style.transition = 'opacity 1.2s ease';
    partners.style.opacity    = '1';
  }
  if (uiBottom) {
    uiBottom.style.transition = 'opacity 1.0s ease';
    uiBottom.style.opacity    = '1';
  }
  if (uiShare) {
    uiShare.style.transition  = 'opacity 1.0s ease';
    uiShare.style.opacity     = '1';
  }
  gtm('ending_reached');
}

// ─── Globe boot ───────────────────────────────────────────────────────────────
async function bootGlobe() {
  setProgress(5);

  // Constructor chỉ nhận renderer — loaders + R4 truyền qua init()
  globeScene = new GlobeScene(renderer);

  try {
    await globeScene.init({
      gltfLoader,
      ktx2Loader,
      R1,
      R4,
      onProgress: (pct) => setProgress(5 + pct * 90),   // pct: 0→1 map sang 5→95
    });
  } catch (err) {
    console.error('[main] GlobeScene init error:', err);
  }

  setProgress(100);
  await new Promise(r => setTimeout(r, 400));
  hidePreloader();
  gtm('site_loaded');
  showIntroduction();
}

// ─── Scroll — wheel ───────────────────────────────────────────────────────────
window.addEventListener('wheel', (e) => {
  if (!S.entered) return;
  const scrollMax  = document.body.scrollHeight - window.innerHeight;
  const scrollFrac = scrollMax > 0 ? window.scrollY / scrollMax : 0;
  const inTL       = scrollFrac * 100 >= GLOBE_END * 100;
  if (inTL) {
    e.preventDefault();
    timelineScene?.addScrollDelta(e.deltaY, false);
  }
}, { passive: false });

// ─── Scroll — touch ───────────────────────────────────────────────────────────
let _touchStartY = 0;

window.addEventListener('touchstart', (e) => {
  _touchStartY = e.touches[0].clientY;
}, { passive: true });

window.addEventListener('touchmove', (e) => {
  if (!S.entered) return;
  const scrollMax  = document.body.scrollHeight - window.innerHeight;
  const scrollFrac = scrollMax > 0 ? window.scrollY / scrollMax : 0;
  const inTL       = scrollFrac * 100 >= GLOBE_END * 100;
  if (inTL) {
    e.preventDefault();
    const dy     = _touchStartY - e.touches[0].clientY;
    _touchStartY = e.touches[0].clientY;
    timelineScene?.addScrollDelta(dy, true);
  }
}, { passive: false });

// ─── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  globeScene?.onResize();
  timelineScene?.onResize();
});

// ─── RAF tick ─────────────────────────────────────────────────────────────────
function tick(t) {
  requestAnimationFrame(tick);

  const now = t * 0.001;                                  // ms → seconds
  const dt  = S.lastT === null
    ? 0.016
    : Math.min(now - S.lastT, 0.10);                     // cap tại 100ms
  S.lastT = now;

  if (!S.entered || !globeScene) return;

  const scrollMax   = document.body.scrollHeight - window.innerHeight;
  const scrollFrac  = scrollMax > 0 ? window.scrollY / scrollMax : 0;
  const absProgress = scrollFrac * 100;
  const inTL        = absProgress >= GLOBE_END * 100;

  if (!inTL) {
    // ── Globe phase ────────────────────────────────────────────────────────
    renderer.toneMappingExposure = 1.6;           // space / dark scene
    globeScene.update(dt, scrollFrac, 'scroll');
    globeScene.render();

  } else {
    // ── Timeline phase ─────────────────────────────────────────────────────
    if (!S.timelineInit) bootTimeline();

    if (S.timelineReady) {
      renderer.toneMappingExposure = 2.2;         // ocean / daytime scene
      timelineScene.update(dt);
      timelineScene.render();

      // Đọc virtual scroll progress từ TimelineScene
      // TimelineScene expose qua getter progress (nếu có) hoặc _absScroll trực tiếp
      S.tlVirtual = timelineScene.progress ?? timelineScene._absScroll ?? 0;

      if (!S.endingFired && S.tlVirtual >= 98) fireEnding();

    } else {
      // Timeline vẫn đang load → giữ Globe làm backdrop
      renderer.toneMappingExposure = 1.6;
      globeScene.render();
    }
  }
}

// ─── Kick off ─────────────────────────────────────────────────────────────────
requestAnimationFrame(tick);
bootGlobe();
