import * as THREE from 'three';

/**
 * GlobeScene — Earth globe with intro zoom-in and scroll-driven animation.
 *
 * RULE: this.renderer is set ONCE in the constructor and NEVER reassigned.
 *       Any local variable that happens to use the name "renderer" inside
 *       a method must NOT be assigned to this.renderer.
 */
export class GlobeScene {
  /**
   * @param {THREE.WebGLRenderer} renderer  Shared renderer from main.js
   */
  constructor(renderer) {
    /* ── Store renderer ──────────────────────────────────────
       This is the ONLY assignment to this.renderer in the entire class.
       Do not add any other assignment to this.renderer anywhere.        */
    this.renderer = renderer;

    /* ── Three.js core ──────────────────────────────────────── */
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000d15);

    // Camera: FOV=22, starts at z=14 (far), zooms to z=5.2 during intro
    this.camera = new THREE.PerspectiveCamera(
      22,
      window.innerWidth / window.innerHeight,
      0.01,
      1000
    );
    this.camera.position.set(0, 0, 14);

    /* ── Earth group ────────────────────────────────────────── */
    this.earthGroup = new THREE.Group();
    this.scene.add(this.earthGroup);

    /* ── Lights ─────────────────────────────────────────────── */
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xb8cadf, 2.3);
    dirLight.position.set(5, 3, 5);
    this.scene.add(dirLight);

    /* ── Stars ──────────────────────────────────────────────── */
    this._buildStars();

    /* ── Placeholder sphere (shown while earth.glb loads) ───── */
    this._placeholder = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 64),
      new THREE.MeshStandardMaterial({ color: 0x07192d, roughness: 0.8, metalness: 0.1 })
    );
    this.earthGroup.add(this._placeholder);

    /* ── Intro state ─────────────────────────────────────────── */
    this._introActive = false;
    this._introT      = 0;

    /* ── Ready flag ──────────────────────────────────────────── */
    this._ready = false;

    /* ── Debug ───────────────────────────────────────────────── */
    console.log('[GlobeScene] constructed, renderer.render =', typeof this.renderer.render);
  }

  /* ── Private ─────────────────────────────────────────────── */

  _buildStars() {
    const N   = 3000;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 300;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 300;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 300;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat   = new THREE.PointsMaterial({ color: 0xffffff, size: 0.18 });
    const stars = new THREE.Points(geo, mat);
    this.scene.add(stars);
  }

  /* ── Public API ──────────────────────────────────────────── */

  /**
   * Load assets. Await this before calling startIntro().
   */
  async init({ gltfLoader, R4, onProgress }) {
    onProgress?.(0.05);

    try {
      // Load earth.glb
      const gltf = await new Promise((resolve, reject) => {
        gltfLoader.load(
          R4 + 'earth.glb',
          resolve,
          xhr => {
            if (xhr.total > 0) {
              onProgress?.(0.05 + (xhr.loaded / xhr.total) * 0.9);
            }
          },
          reject
        );
      });

      // Swap placeholder for the real model
      this.earthGroup.remove(this._placeholder);
      this._placeholder.geometry.dispose();
      this._placeholder.material.dispose();
      this._placeholder = null;

      this.earthGroup.add(gltf.scene);
      console.log('[GlobeScene] earth.glb loaded ✓');

    } catch (err) {
      // Not fatal — placeholder sphere stays visible
      console.warn('[GlobeScene] earth.glb failed (using placeholder sphere):', err.message);
    }

    onProgress?.(1.0);
    this._ready = true;
    console.log('[GlobeScene] ready, renderer.render =', typeof this.renderer.render);
  }

  /** Trigger intro camera zoom (call after preloader hides) */
  startIntro() {
    this._introActive = true;
    this._introT      = 0;
  }

  /** Called every frame from main.js loop */
  update(dt, scrollFrac, phase) {
    if (!this._ready) return;

    // Intro zoom: camera z goes from 14 → 5.2 over ~2 seconds
    if (this._introActive && this._introT < 1) {
      this._introT = Math.min(this._introT + dt * 0.45, 1);
      const eased = 1 - Math.pow(1 - this._introT, 3); // cubic ease-out
      this.camera.position.z = 14 - (14 - 5.2) * eased;
    }

    // Constant earth rotation
    this.earthGroup.rotation.y += dt * 0.04;

    // Scroll-driven tilt
    if (scrollFrac > 0.01) {
      this.earthGroup.rotation.x = scrollFrac * 0.25;
    }
  }

  /** Called every frame from main.js loop — renders the scene */
  render() {
    // this.renderer is always the WebGLRenderer set in constructor
    this.renderer.render(this.scene, this.camera);
  }

  /** Call on window resize */
  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.scene.traverse(o => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => m?.dispose());
    });
  }
}
