/**
 * js/main.js — v5.2
 *
 * Critical fixes:
 *  ✅ GLTFLoader + KTX2Loader tạo trong main.js, truyền vào cả hai scene.init()
 *  ✅ KTX2 basis transcoder → three@0.169.0 CDN (x1 = 404, không tự host được)
 *  ✅ R4 = dai-duong-tau-x4  (tất cả GLB + KTX2 + envmap đều ở đây)
 *  ✅ R1 = R4  (x1 không tồn tại; cloud0-8.webp 404 silently → no crash)
 *  ✅ GlobeScene.update(dt, scrollFrac, phase) — 3 scalar args (không phải object)
 *  ✅ TimelineScene: wheel → addScrollDelta() + e.preventDefault() trong TL phase
 *  ✅ btn-enter  (confirmed index.html — không phải "enter-btn")
 *  ✅ preloader-fill / preloader-pct  (confirmed index.html)
 *
 * Asset map (verified):
 *   x1 → 404                     cloud sprites → fail silently (no clouds, no crash)
 *   x4 → earth.glb, ship.glb, buoy.glb, seagull.glb, clouds.glb,
 *         ocean-envmap.jpg, *.ktx2   ← tất cả 3D assets ở đây
 */

import * as THREE            from 'three';
import { GLTFLoader }        from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader }        from 'three/addons/loaders/KTX2Loader.js';
import { GlobeScene }        from './GlobeScene.js';
import { TimelineScene }     from './TimelineScene.js';

// ─── CDN roots ────────────────────────────────────────────────────────────────
// x4 chứa TOÀN BỘ 3D assets (earth, ship, seagull, buoy, clouds, envmap, ktx2)
const R4 = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x4@main/';

// x1 = 404 → truyền R4 làm R1 luôn.
// Cloud0-8.webp không có trong x4 → loader.load() sẽ 404 silently (caught/ignored).
const R1 = R4;

// Basis transcoder cho KTX2Loader — lấy từ three@0.169.0 CDN, không tự host.
// Cần 2 file: basis_transcoder.js + basis_transcoder.wasm
const BASIS_PATH = 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/basis/';

// ─── Config ───────────────────────────────────────────────────────────────────
// 5% scroll = Globe phase kết thúc (test). Đổi thành 0.28 cho production.
const GLOBE_END = 0.05;

// ─── Globals ──────────────────────────────────────────────────────────────────
let renderer, globeScene, timelineScene;
let gltfLoader, ktx2Loader;
const clock = new THREE.Clock();

const S = {
  entered:       false,
  timelineInit:  false,
  timelineReady: false,
  endingFired:   false,
  absProgress:   0,   // 0–100, đọc từ window.scrollY (Globe phase)
  tlVirtual:     50,  // mirror TimelineScene._absScroll (bắt đầu từ 50)
};

// ─── DOM helpers ──────────────────────────────────────────────────────────────
const $      = id => document.getElementById(id);
const showEl = id => { const e = $(id); if (e) e.style.removeProperty('display'); };
const hideEl = id => { const e = $(id); if (e) e.style.display = 'none'; };

function setProgress(p) {
  const pct  = Math.round(Math.min(1, Math.max(0, p)) * 100);
  const fill  = $('preloader-fill');  // div.preloader__fill — thanh progress
  const label = $('preloader-pct');   // div.preloader__pct  — text "0%"
  if (fill)  fill.style.width  = pct + '%';
  if (label) label.textContent = pct + '%';
}

// ─── GTM ──────────────────────────────────────────────────────────────────────
function gtm(event, params = {}) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
}

// ─── Renderer (tạo 1 lần, chia sẻ cho cả 2 scenes) ───────────────────────────
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
  renderer.toneMappingExposure = 1.6;
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
}

// ─── Loaders (PHẢI tạo SAU renderer — KTX2Loader.detectSupport() cần renderer) ─
function createLoaders() {
  ktx2Loader = new KTX2Loader()
    .setTranscoderPath(BASIS_PATH) // CDN basis_transcoder.js + .wasm
    .detectSupport(renderer);      // probe GPU KTX2 support

  gltfLoader = new GLTFLoader();
  gltfLoader.setKTX2Loader(ktx2Loader); // cho phép load KTX2 embedded trong GLB
}

// ─── Boot Globe ───────────────────────────────────────────────────────────────
async function bootGlobe() {
  globeScene = new GlobeScene(renderer);
  // ✅ FIX v5.1 bug: truyền đúng object với gltfLoader + ktx2Loader
  await globeScene.init({
    gltfLoader,
    ktx2Loader,
    R1,            // = R4 (cloud0-8.webp sẽ 404 silently — no crash)
    R4,            // earth.glb, envmap, KTX2 textures — đều trong x4 ✓
    onProgress: p => setProgress(p),  // cập nhật preloader 0→100%
  });
  console.log('[main] GlobeScene ready ✓');
}

// ─── Boot Timeline (lazy — chỉ gọi khi user vào TL phase) ────────────────────
let _tlBooting = false;
async function bootTimeline() {
  if (_tlBooting || S.timelineInit) return;
  _tlBooting    = true;
  S.timelineInit = true;
  try {
    timelineScene = new TimelineScene(renderer);
    await timelineScene.init({
      gltfLoader,
      ktx2Loader,
      R1,   // module-level R1 trong TimelineScene.js vẫn trỏ x-1 (dead) nhưng
      R4,   // chỉ ảnh hưởng cloud sprites — load silently fails, không crash
      onProgress: () => {},   // không cần loading screen thứ 2
    });
    S.timelineReady = true;
    console.log('[main] TimelineScene ready ✓');
  } catch (err) {
    console.error('[main] TimelineScene boot failed:', err);
    // Cho phép retry lần sau
    S.timelineInit = _tlBooting = false;
  }
}

// ─── Enter site ───────────────────────────────────────────────────────────────
function enterSite() {
  if (S.entered) return;
  S.entered = true;
  hideEl('introduction');
  showEl('site-header');
  showEl('scroll-indicator');
  document.body.style.overflow = '';   // mở khóa scroll
  globeScene?.startIntro();             // bắt đầu camera zoom z:14→5.2
  gtm('site_entered');
}

// ─── Ending ───────────────────────────────────────────────────────────────────
function fireEnding() {
  if (S.endingFired) return;
  S.endingFired = true;
  showEl('ui-bottom');
  showEl('ui-share');
  showEl('partners');
  hideEl('scroll-indicator');
  gtm('ending_reached');
}

// ─── Events ───────────────────────────────────────────────────────────────────
function onScroll() {
  if (!S.entered) return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  S.absProgress = max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0;
}

function onWheel(e) {
  if (!S.entered) return;
  const inTL = S.absProgress >= GLOBE_END * 100;

  if (inTL && S.timelineReady) {
    // Freeze native scroll trong TL phase — TL quản lý virtual scroll nội bộ
    e.preventDefault();
    timelineScene.addScrollDelta(e.deltaY, false);

    // Mirror logic của TimelineScene.addScrollDelta() để detect ending
    // speed=0.5 (isTouch=false), clamp ±1.3, *0.8
    const d = Math.max(-1.3, Math.min(1.3, e.deltaY * 0.5));
    S.tlVirtual = Math.max(0, Math.min(100, S.tlVirtual + d * 0.8));
  }
  // Globe phase: KHÔNG preventDefault → native scroll tiếp tục bình thường
}

// Touch support
let _lastTouchY = null;
function onTouchStart(e) {
  _lastTouchY = e.touches[0]?.clientY ?? null;
}
function onTouchMove(e) {
  if (!S.entered || _lastTouchY === null) return;
  const inTL = S.absProgress >= GLOBE_END * 100;
  if (inTL && S.timelineReady) {
    e.preventDefault();
    const curY  = e.touches[0]?.clientY ?? _lastTouchY;
    const delta = _lastTouchY - curY;   // dương = vuốt lên = scroll forward
    _lastTouchY = curY;
    timelineScene.addScrollDelta(delta * 3, true);
    const d = Math.max(-1.3, Math.min(1.3, delta * 3 * 0.8));
    S.tlVirtual = Math.max(0, Math.min(100, S.tlVirtual + d * 0.8));
  } else {
    _lastTouchY = e.touches[0]?.clientY ?? _lastTouchY;
  }
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  globeScene?.onResize?.();
  timelineScene?.onResize?.();
}

// ─── Render loop ──────────────────────────────────────────────────────────────
function tick() {
  requestAnimationFrame(tick);

  // getDelta() LUÔN phải gọi mỗi frame để clock không bị tích lũy
  const dt = Math.min(clock.getDelta(), 0.05); // cap 50ms — tránh jump khi tab bị ẩn

  if (!S.entered) return; // chưa enter → không render gì

  const inTL = S.absProgress >= GLOBE_END * 100;

  if (!inTL) {
    // ── GLOBE PHASE ────────────────────────────────────────────────────────
    // scrollFrac = 0 (đầu) → 1 (kết thúc globe phase)
    const scrollFrac = Math.min(1, S.absProgress / (GLOBE_END * 100));
    globeScene?.update(dt, scrollFrac, 'scroll');  // (dt, scrollFrac, phase)
    globeScene?.render();

  } else {
    // ── TIMELINE PHASE ─────────────────────────────────────────────────────
    if (!S.timelineInit) bootTimeline(); // lazy-init lần đầu

    if (S.timelineReady) {
      timelineScene.update(dt);   // TL quản lý scroll state nội bộ qua addScrollDelta
      timelineScene.render();
      if (!S.endingFired && S.tlVirtual >= 98) fireEnding();
    } else {
      // Fallback: giữ Globe trong khi TL assets đang stream (ship.glb = 8MB!)
      globeScene?.render();
    }
  }
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
async function main() {
  document.body.style.overflow = 'hidden'; // lock scroll cho đến khi user click Enter

  createRenderer();
  createLoaders();

  // Load Globe assets → preloader progress 0→100%
  await bootGlobe();
  setProgress(1.0);

  // Flash "100%" rồi ẩn preloader
  await new Promise(r => setTimeout(r, 350));
  hideEl('preloader');
  showEl('introduction');

  // Enter button — ID = "btn-enter" (confirmed index.html, KHÔNG phải "enter-btn")
  const btnEnter = $('btn-enter');
  if (btnEnter) {
    btnEnter.addEventListener('click', enterSite, { once: true });
  } else {
    // Fallback nếu button bị remove
    $('introduction')?.addEventListener('click', enterSite, { once: true });
  }

  // Share button — id="btn-share" nằm trong id="ui-share"
  $('btn-share')?.addEventListener('click', () => {
    gtm('share_clicked');
    if (navigator.share) {
      navigator.share({ title: 'OceanX 2025 In Review', url: location.href })
        .catch(() => {});
    } else {
      navigator.clipboard?.writeText(location.href).catch(() => {});
    }
  });

  // Listeners
  window.addEventListener('wheel',      onWheel,      { passive: false });
  window.addEventListener('scroll',     onScroll,     { passive: true  });
  window.addEventListener('touchstart', onTouchStart, { passive: true  });
  window.addEventListener('touchmove',  onTouchMove,  { passive: false });
  window.addEventListener('resize',     onResize,     { passive: true  });

  gtm('site_loaded');
  tick(); // bắt đầu loop (không render gì cho đến khi S.entered = true)
}

main().catch(err => console.error('[main] fatal boot error:', err));


