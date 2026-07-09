import * as THREE        from 'three';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader }    from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GlobeScene }    from './GlobeScene.js';

/* ─── CDN roots ─────────────────────────────────────────── */
const R1 = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x-1@main/';
const R4 = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x4@main/';

/* ─── Renderer (created ONCE here, passed to scenes) ─────── */
const canvas   = document.getElementById('webgl-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias        : true,
  powerPreference  : 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping         = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled   = true;
renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
renderer.outputColorSpace    = THREE.SRGBColorSpace;

/* Sanity-check: log if renderer is valid */
console.log('[main] renderer ok?', typeof renderer.render === 'function');

/* ─── Loaders ────────────────────────────────────────────── */
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath(R1);
ktx2Loader.detectSupport(renderer);

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
gltfLoader.setKTX2Loader(ktx2Loader);

/* ─── DOM refs ───────────────────────────────────────────── */
const elPreloader    = document.getElementById('preloader');
const elIntroduction = document.getElementById('introduction');
const elScroller     = document.getElementById('scroller');

/* ─── Scroll state ───────────────────────────────────────── */
const LAMBDA     = 6;
let   rawScroll  = 0;
let   smoothScr  = 0;

window.addEventListener('scroll', () => { rawScroll = window.scrollY; }, { passive: true });

/* Touch fallback */
let _ty = 0;
window.addEventListener('touchstart', e => { _ty = e.touches[0].clientY; }, { passive: true });
window.addEventListener('touchmove',  e => {
  window.scrollBy(0, _ty - e.touches[0].clientY);
  _ty = e.touches[0].clientY;
}, { passive: true });

/* ─── Phase ──────────────────────────────────────────────── */
let phase = 'preload'; // 'preload' | 'intro' | 'globe'

/* ─── Progress helper ────────────────────────────────────── */
function setProgress(frac) {
  const pct = Math.round(frac * 100);
  elPreloader.querySelectorAll('*').forEach(el => {
    if (!el.childElementCount && /^\d+%$/.test(el.textContent.trim())) {
      el.textContent = pct + '%';
    }
  });
}

/* ─── Globe Scene ────────────────────────────────────────── */
// Pass the renderer object — GlobeScene stores it and NEVER reassigns it
const globeScene = new GlobeScene(renderer);

/* ─── Transition helpers ─────────────────────────────────── */
function showIntro() {
  elPreloader.style.transition = 'opacity 0.8s ease';
  elPreloader.style.opacity    = '0';
  setTimeout(() => {
    elPreloader.style.display = 'none';
    elIntroduction.removeAttribute('style');          // remove display:none
    elIntroduction.style.opacity    = '0';
    elIntroduction.style.transition = 'opacity 0.8s ease';
    requestAnimationFrame(() => { elIntroduction.style.opacity = '1'; });
    phase = 'intro';
    globeScene.startIntro();
  }, 800);
}

/* ─── Init ───────────────────────────────────────────────── */
globeScene
  .init({ gltfLoader, ktx2Loader, R1, R4, onProgress: setProgress })
  .then(() => {
    console.log('[main] GlobeScene ready → showing intro');
    showIntro();
  })
  .catch(err => {
    console.error('[main] GlobeScene init error:', err);
    showIntro(); // show anyway, placeholder sphere will be visible
  });

/* ─── Animation loop ─────────────────────────────────────── */
const clock = new THREE.Clock();

(function loop() {
  requestAnimationFrame(loop);

  const dt    = Math.min(clock.getDelta(), 0.05);
  const alpha = 1 - Math.exp(-LAMBDA * dt);
  smoothScr  += (rawScroll - smoothScr) * alpha;

  const scrollH    = Math.max(elScroller.scrollHeight - window.innerHeight, 1);
  const scrollFrac = Math.min(smoothScr / scrollH, 1);

  globeScene.update(dt, scrollFrac, phase);
  globeScene.render();   // → calls this.renderer.render(scene, camera) inside GlobeScene
}());

/* ─── Resize ─────────────────────────────────────────────── */
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  globeScene.onResize();
});
