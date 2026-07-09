// js/main.js
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GlobeScene } from './GlobeScene.js';

// ===== ASSET BASE URLS =====
const R1 = 'https://raw.githubusercontent.com/rocketingshift/dai-duong-tau-x-1/main/';
const R4 = 'https://raw.githubusercontent.com/rocketingshift/dai-duong-tau-x4/main/';

// ===== DOM =====
const canvas      = document.getElementById('webgl-canvas');
const preloader   = document.getElementById('preloader');
const fillEl      = document.getElementById('preloader-fill');
const pctEl       = document.getElementById('preloader-pct');
const introEl     = document.getElementById('introduction');
const headerEl    = document.getElementById('site-header');
const scrollEl    = document.getElementById('scroller');
const scrollInd   = document.getElementById('scroll-indicator');
const bottomUI    = document.getElementById('ui-bottom');
const shareUI     = document.getElementById('ui-share');
const partnersEl  = document.getElementById('partners');
const btnEnter    = document.getElementById('btn-enter');
const btnAudio    = document.getElementById('btn-audio');
const audioLabel  = document.getElementById('audio-label');

// ===== STATE =====
const state = { introOver: false, audioOn: true, hasScrolled: false };

// ===== TINY EVENT BUS =====
const _ev = new EventTarget();
export const emit = (name, d = {}) => _ev.dispatchEvent(new CustomEvent(name, { detail: d }));
export const on   = (name, fn)     => _ev.addEventListener(name, e => fn(e.detail));

// ===== RENDERER =====
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ===== LOADERS =====
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath(R1);   // basis_transcoder.js/.wasm are in repo x-1
ktx2Loader.detectSupport(renderer);

const gltfLoader = new GLTFLoader();
const texLoader  = new THREE.TextureLoader();

// ===== ASSET PROGRESS TRACKER =====
let loaded = 0, total = 0;
function track(promise) {
  total++;
  return promise.then(r => { loaded++; setProgress(loaded / total); return r; });
}
function setProgress(t) {
  const p = Math.round(t * 100);
  if (fillEl) fillEl.style.width = p + '%';
  if (pctEl)  pctEl.textContent  = p + '%';
}

// ===== CLOCK & SCROLL =====
const clock = new THREE.Clock();
let scrollTarget = 0, scrollVal = 0, scrollSmooth = 0;

// ===== SCENES =====
let globeScene;

// ===== RAF LOOP =====
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t  = clock.getElapsedTime();

  // Exponential scroll damp (matches original We.Damp lambda=6/4)
  scrollVal    += (scrollTarget - scrollVal)    * (1 - Math.exp(-6 * dt));
  scrollSmooth += (scrollVal   - scrollSmooth)  * (1 - Math.exp(-4 * dt));

  if (globeScene) {
    globeScene.update(t, dt, scrollSmooth);
    globeScene.render();
  }
}

// ===== UI HELPERS =====
function show(el) { if (el) el.style.display = ''; }
function hide(el) { if (el) el.style.display = 'none'; }

// ===== INIT =====
async function init() {
  // Build Globe scene
  globeScene = new GlobeScene(renderer, ktx2Loader, gltfLoader, texLoader, R4, R1, track);
  await globeScene.load();

  // Assets loaded — hide preloader, show intro
  await new Promise(r => setTimeout(r, 300));  // brief hold at 100%
  preloader.classList.add('out');
  show(headerEl);
  show(introEl);
  show(bottomUI);
  show(shareUI);
  show(partnersEl);
  globeScene.playIntro();
  emit('loaded');

  // Enter button → hide intro, start experience
  btnEnter?.addEventListener('click', () => {
    introEl.classList.add('out');
    state.introOver = true;
    emit('enter');

    setTimeout(() => {
      hide(introEl);
      show(scrollInd);
      emit('introductionOver');
    }, 750);
  });

  // Audio toggle
  btnAudio?.addEventListener('click', () => {
    state.audioOn = !state.audioOn;
    if (audioLabel) audioLabel.textContent = state.audioOn ? 'AUDIO ON' : 'AUDIO OFF';
  });

  // Share button → GTM event (matches original)
  document.getElementById('btn-share')?.addEventListener('click', () => {
    const url = window.location.href;
    if (navigator.share) navigator.share({ url });
    else navigator.clipboard?.writeText(url);
    emit('share_clicked');
  });

  // Scroll handler
  scrollEl?.addEventListener('scroll', () => {
    if (!state.introOver) return;
    const max = scrollEl.scrollHeight - innerHeight;
    scrollTarget = max > 0 ? scrollEl.scrollTop / max : 0;

    if (!state.hasScrolled && scrollTarget > 0.001) {
      state.hasScrolled = true;
      hide(scrollInd);
      emit('firstScroll');
    }
    emit('scroll', { progress: scrollTarget });
  });

  // Resize
  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    globeScene?.onResize();
  });

  animate();
}

init().catch(err => {
  console.error('[OceanX] Init error:', err);
  // Fallback: hide preloader even on error
  preloader.classList.add('out');
});
