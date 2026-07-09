/**
 * OCEANX — main.js
 * Three.js r169 via importmap
 * Assets via jsDelivr CDN (CORS OK ✅)
 */

import * as THREE          from 'three';
import { GLTFLoader }      from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader }      from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader }     from 'three/addons/loaders/DRACOLoader.js';
import { GlobeScene }      from './GlobeScene.js';

// ── CDN base URLs (jsDelivr — CORS OK) ─────────────────────────
const R1 = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x-1@main/';
const R4 = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x4@main/';
const R2 = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x2@main/'; // fonts (CSS only)

// ── DOM references ──────────────────────────────────────────
const preloaderEl       = document.getElementById('preloader');
const barFillEl         = document.querySelector('.preloader-bar-fill');
const pctEl             = document.querySelector('.preloader-pct');
const introductionEl    = document.getElementById('introduction');
const enterBtnEl        = document.querySelector('.intro-enter-btn');
const scrollIndicatorEl = document.getElementById('scroll-indicator');
const endingEl          = document.getElementById('ending');
const shareBtnEl        = document.querySelector('.ending-share-btn');

// ── Renderer ───────────────────────────────────────────────
const canvas = document.getElementById('main-canvas');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping       = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.outputColorSpace  = THREE.SRGBColorSpace;
renderer.autoClear         = false;

// ── KTX2 Loader (transcoder from repo x-1 via jsDelivr) ─────────────
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath(R1);   // basis_transcoder.js + .wasm ← repo x-1
ktx2Loader.detectSupport(renderer);

// ── DRACO + GLTF Loader ───────────────────────────────────────
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

const gltfLoader = new GLTFLoader();
gltfLoader.setKTX2Loader(ktx2Loader);
gltfLoader.setDRACOLoader(dracoLoader);

// ── Asset Manifest ──────────────────────────────────────────
const ASSET_LIST = [
  // — GLB Models (repo x4)
  { key: 'earth',          url: R4 + 'earth.glb',                type: 'gltf'    },
  { key: 'clouds',         url: R4 + 'clouds.glb',               type: 'gltf'    },
  // — KTX2 Textures (repo x4)
  { key: 'earthDiffuse',   url: R4 + 'earth_diffuse_grade.ktx2', type: 'ktx2'    },
  { key: 'earthNormal',    url: R4 + 'earth_normal.ktx2',        type: 'ktx2'    },
  { key: 'earthRoughness', url: R4 + 'earth_roughness.ktx2',     type: 'ktx2'    },
  { key: 'earthClouds',    url: R4 + 'earth_clouds.ktx2',        type: 'ktx2'    },
  // — Cloud sprites (repo x-1)
  { key: 'cloud0',         url: R1 + 'cloud0.webp',              type: 'texture'  },
  { key: 'cloud1',         url: R1 + 'cloud1.webp',              type: 'texture'  },
  { key: 'cloud2',         url: R1 + 'cloud2.webp',              type: 'texture'  },
  { key: 'cloud3',         url: R1 + 'cloud3.webp',              type: 'texture'  },
  { key: 'cloud4',         url: R1 + 'cloud4.webp',              type: 'texture'  },
  { key: 'cloud5',         url: R1 + 'cloud5.webp',              type: 'texture'  },
  { key: 'cloud6',         url: R1 + 'cloud6.webp',              type: 'texture'  },
  { key: 'cloud7',         url: R1 + 'cloud7.webp',              type: 'texture'  },
  { key: 'cloud8',         url: R1 + 'cloud8.webp',              type: 'texture'  },
];

// ── Load state ────────────────────────────────────────────────
const assets    = {};
let loadedCount = 0;
const total     = ASSET_LIST.length;

function setProgress(n) {
  const pct = Math.round((n / total) * 100);
  if (barFillEl) barFillEl.style.width = pct + '%';
  if (pctEl)     pctEl.textContent     = pct + '%';
}

function onAssetReady(key, value) {
  assets[key] = value;
  loadedCount++;
  setProgress(loadedCount);
  if (loadedCount >= total) onAllLoaded();
}

// ── Texture loader ──────────────────────────────────────────
const texLoader = new THREE.TextureLoader();

function loadAsset({ key, url, type }) {
  if (type === 'gltf') {
    gltfLoader.load(
      url,
      (gltf) => onAssetReady(key, gltf),
      undefined,
      (err)  => { console.warn('[GLTF fail]', key, url, err); onAssetReady(key, null); }
    );
  } else if (type === 'ktx2') {
    ktx2Loader.load(
      url,
      (tex)  => { tex.colorSpace = THREE.SRGBColorSpace; onAssetReady(key, tex); },
      undefined,
      (err)  => { console.warn('[KTX2 fail]', key, url, err); onAssetReady(key, null); }
    );
  } else {
    texLoader.load(
      url,
      (tex)  => onAssetReady(key, tex),
      undefined,
      (err)  => { console.warn('[TEX fail]', key, url, err); onAssetReady(key, null); }
    );
  }
}

// ── Scene instances ─────────────────────────────────────────
let globeScene = null;

// ── App state ──────────────────────────────────────────────
let entered          = false;
let firstScrollFired = false;
let scrollY          = 0;
let smoothScrollY    = 0;
let lastTimestamp    = performance.now();

const LAMBDA = 6; // exponential damp factor (matches original We.Damp)

// ── Simple event bus ────────────────────────────────────────
const bus  = new EventTarget();
const emit = (name, detail = {}) =>
  bus.dispatchEvent(new CustomEvent(name, { detail }));

// ─────────────────────────────────────────────────────────
// onAllLoaded — called when every asset is ready
// ─────────────────────────────────────────────────────────
function onAllLoaded() {
  // Build Globe scene with all loaded assets
  globeScene = new GlobeScene({ renderer, assets, R1, R4 });
  globeScene.init();

  // Brief pause → fade preloader → show intro
  setTimeout(() => {
    preloaderEl?.classList.add('hidden');
    setTimeout(() => {
      introductionEl?.classList.add('visible');
    }, 500);
  }, 700);

  emit('loaded');
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: 'site_loaded' });
}

// ── ENTER button ──────────────────────────────────────────
enterBtnEl?.addEventListener('click', () => {
  if (entered) return;
  entered = true;

  introductionEl?.classList.add('out');
  globeScene?.playIntro();

  emit('enter');
  window.dataLayer?.push({ event: 'site_entered' });

  // After intro animation → show scroll indicator
  setTimeout(() => {
    emit('introductionOver');
    scrollIndicatorEl?.classList.add('visible');
  }, 1800);
});

// ── Scroll ───────────────────────────────────────────────
window.addEventListener('scroll', () => {
  scrollY = window.scrollY;

  if (!firstScrollFired && scrollY > 10 && entered) {
    firstScrollFired = true;
    scrollIndicatorEl?.classList.remove('visible');
    scrollIndicatorEl?.classList.add('hidden');
    emit('firstScroll');
  }
}, { passive: true });

// ── Resize ──────────────────────────────────────────────
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  globeScene?.onResize();
});

// ── Share button ─────────────────────────────────────────
shareBtnEl?.addEventListener('click', () => {
  window.dataLayer?.push({ event: 'share_clicked' });
  if (navigator.share) {
    navigator.share({ url: window.location.href }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(window.location.href);
  }
});

// ── Ending ──────────────────────────────────────────────
bus.addEventListener('showEnding', () => {
  endingEl?.classList.add('visible');
  window.dataLayer?.push({ event: 'ending_reached' });
});

// ─────────────────────────────────────────────────────────
// RAF render loop
// Exponential damp: 1 - exp(-lambda * dt)  ← matches original We.Damp
// ─────────────────────────────────────────────────────────
function loop(now) {
  requestAnimationFrame(loop);

  const dt = Math.min((now - lastTimestamp) * 0.001, 0.05); // seconds, cap 50ms
  lastTimestamp = now;

  // Smooth scroll with exponential damping
  const alpha = 1 - Math.exp(-LAMBDA * dt);
  smoothScrollY += (scrollY - smoothScrollY) * alpha;

  // Normalised scroll progress [0 → 1] across full 2500vh
  const maxScroll  = Math.max(1, document.body.scrollHeight - window.innerHeight);
  const normScroll = smoothScrollY / maxScroll;

  // Clear + update + render
  renderer.clear();
  globeScene?.update(dt, normScroll, smoothScrollY);
  globeScene?.render(renderer);
}

requestAnimationFrame(loop);

// ── Kick off loading ────────────────────────────────────────
setProgress(0);
ASSET_LIST → Commit.forEach(loadAsset);
