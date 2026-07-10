// js/GlobeScene.js — v3
// v3 fix: _buildClouds() dùng clouds.glb từ R4 (cloud0-8.webp = 404 forever)
import * as THREE from 'three';

export class GlobeScene {
  /**
   * @param {THREE.WebGLRenderer} renderer  Shared renderer — NEVER reassigned.
   */
  constructor(renderer) {
    this.renderer = renderer;

    /* ── Scene ───────────────────────────────────────────── */
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000d15);

    /* ── Camera: FOV=22, intro z=14 → z=5.2 ─────────────── */
    this.camera = new THREE.PerspectiveCamera(
      22, window.innerWidth / window.innerHeight, 0.01, 1000
    );
    this.camera.position.set(0, 0, 14);

    /* ── Groups ──────────────────────────────────────────── */
    this.earthGroup = new THREE.Group();
    this.scene.add(this.earthGroup);

    this.cloudGroup = new THREE.Group(); // child of earthGroup → rotates with earth
    this.earthGroup.add(this.cloudGroup);

    /* ── Lights ──────────────────────────────────────────── */
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dir = new THREE.DirectionalLight(0xb8cadf, 2.3);
    dir.position.set(5, 3, 5);
    this.scene.add(dir);

    /* ── Stars ───────────────────────────────────────────── */
    this._buildStars();

    /* ── Placeholder sphere ──────────────────────────────── */
    this._placeholder = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 64),
      new THREE.MeshStandardMaterial({ color: 0x07192d, roughness: 0.8, metalness: 0.1 })
    );
    this.earthGroup.add(this._placeholder);

    /* ── State ───────────────────────────────────────────── */
    this._introActive = false;
    this._introT      = 0;
    this._ready       = false;
    this._clouds      = [];
  }

  /* ─── Private helpers ────────────────────────────────── */

  _buildStars() {
    const N = 3000, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i*3]   = (Math.random()-0.5)*300;
      pos[i*3+1] = (Math.random()-0.5)*300;
      pos[i*3+2] = (Math.random()-0.5)*300;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(geo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.18 })
    ));
  }

  _tex(loader, url) {
    return new Promise((res, rej) => loader.load(url, res, undefined, rej));
  }

  _ktx(ktx2Loader, url) {
    return new Promise((res, rej) => ktx2Loader.load(url, res, undefined, rej));
  }

  /* ─── Public API ─────────────────────────────────────── */

  async init({ gltfLoader, ktx2Loader, R1, R4, onProgress }) {
    const tl = new THREE.TextureLoader();
    onProgress?.(0.02);

    /* ── 1. Load earth.glb ─────────────────────────────── */
    let earthGLTF = null;
    try {
      earthGLTF = await new Promise((res, rej) =>
        gltfLoader.load(R4 + 'earth.glb', res,
          xhr => { if (xhr.total) onProgress?.(0.02 + xhr.loaded/xhr.total * 0.35); },
          rej
        )
      );
      console.log('[GlobeScene] earth.glb ✓');
    } catch(e) {
      console.warn('[GlobeScene] earth.glb failed:', e.message);
    }
    onProgress?.(0.38);

    /* ── 2. Environment map (JPG → PMREM) ──────────────────
       CRITICAL: pmremGen is a LOCAL variable, NOT this.renderer  */
    let envMap = null;
    try {
      const envTex = await this._tex(tl, R4 + 'ocean-envmap.jpg');
      envTex.mapping = THREE.EquirectangularReflectionMapping;

      const pmremGen = new THREE.PMREMGenerator(this.renderer);
      pmremGen.compileEquirectangularShader();
      envMap = pmremGen.fromEquirectangular(envTex).texture;
      pmremGen.dispose();
      envTex.dispose();

      this.scene.environment          = envMap;
      this.scene.environmentIntensity = 0.5;
      console.log('[GlobeScene] envmap ✓');
    } catch(e) {
      console.warn('[GlobeScene] envmap failed:', e.message);
    }
    onProgress?.(0.52);

    /* ── 3. KTX2 textures ──────────────────────────────── */
    let diffTex = null, normTex = null, roughTex = null;
    try {
      [diffTex, normTex, roughTex] = await Promise.all([
        this._ktx(ktx2Loader, R4 + 'earth_diffuse_grade.ktx2'),
        this._ktx(ktx2Loader, R4 + 'earth_normal.ktx2'),
        this._ktx(ktx2Loader, R4 + 'earth_roughness.ktx2'),
      ]);
      if (diffTex) diffTex.colorSpace = THREE.SRGBColorSpace;
      console.log('[GlobeScene] KTX2 textures ✓');
    } catch(e) {
      console.warn('[GlobeScene] KTX2 textures failed:', e.message);
    }
    onProgress?.(0.72);

    /* ── 4. Apply textures to earth model ──────────────── */
    if (earthGLTF) {
      this.earthGroup.remove(this._placeholder);
      this._placeholder.geometry.dispose();
      this._placeholder.material.dispose();
      this._placeholder = null;

      earthGLTF.scene.traverse(child => {
        if (!child.isMesh) return;
        const old = child.material;
        child.material = new THREE.MeshStandardMaterial({
          map:              diffTex  ?? old?.map  ?? null,
          normalMap:        normTex  ?? old?.normalMap  ?? null,
          roughnessMap:     roughTex ?? old?.roughnessMap ?? null,
          roughness:        roughTex ? 1.0 : 0.7,
          metalness:        0.05,
          envMap:           envMap ?? null,
          envMapIntensity:  0.4,
        });
        child.castShadow    = true;
        child.receiveShadow = true;
        if (old && old !== child.material) old.dispose();
      });

      this.earthGroup.add(earthGLTF.scene);

    } else if (this._placeholder && envMap) {
      this._placeholder.material.envMap          = envMap;
      this._placeholder.material.envMapIntensity = 0.5;
      this._placeholder.material.roughness       = 0.55;
      this._placeholder.material.color.set(0x1a4a6e);
      this._placeholder.material.needsUpdate     = true;
    }
    onProgress?.(0.84);

    /* ── 5. Cloud GLB (v3: clouds.glb from R4, replaces dead cloud0-8.webp) */
    await this._buildClouds(gltfLoader, R4);

    onProgress?.(1.0);
    this._ready = true;
    console.log('[GlobeScene] ready ✓ — renderer.render type:', typeof this.renderer.render);
  }

  // ── v3: load clouds.glb and instance 45 copies around the globe ──────────
  async _buildClouds(gltfLoader, R4) {
    try {
      const gltf = await new Promise((res, rej) =>
        gltfLoader.load(R4 + 'clouds.glb', res, undefined, rej)
      );
      const tmpl = gltf.scene;

      // Semi-transparent white cloud material
      tmpl.traverse(m => {
        if (!m.isMesh) return;
        m.material = new THREE.MeshStandardMaterial({
          color      : 0xeef4f8,
          transparent: true,
          opacity    : 0.55,
          depthWrite : false,
          roughness  : 1.0,
          metalness  : 0.0,
        });
      });

      // Auto-scale template → longest dimension = 0.22 (relative to earth R=1)
      const bbox = new THREE.Box3().setFromObject(tmpl);
      const dims = new THREE.Vector3();
      bbox.getSize(dims);
      const baseSf = 0.22 / Math.max(dims.x, dims.y, dims.z, 0.001);

      const RADIUS = 1.13;
      const COUNT  = 45;

      for (let i = 0; i < COUNT; i++) {
        const c   = tmpl.clone(true);
        const phi = Math.acos(2 * Math.random() - 1);
        const tht = Math.random() * Math.PI * 2;
        const r   = RADIUS + Math.random() * 0.05;

        c.position.set(
          r * Math.sin(phi) * Math.cos(tht),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.sin(tht)
        );
        // Random scale variation + random rotation (clouds at any angle look natural)
        c.scale.setScalar(baseSf * (0.5 + Math.random() * 1.0));
        c.rotation.set(
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2
        );

        this.cloudGroup.add(c);
        this._clouds.push(c);
      }
      console.log(`[GlobeScene] ${COUNT} cloud instances (GLB) ✓`);
    } catch(e) {
      console.warn('[GlobeScene] clouds.glb failed silently:', e.message);
    }
  }

  startIntro() {
    this._introActive = true;
    this._introT      = 0;
  }

  update(dt, scrollFrac, phase) {
    if (!this._ready) return;

    // Intro camera zoom  z: 14 → 5.2
    if (this._introActive && this._introT < 1) {
      this._introT = Math.min(this._introT + dt * 0.45, 1);
      const e = 1 - Math.pow(1 - this._introT, 3); // cubic ease-out
      this.camera.position.z = 14 - (14 - 5.2) * e;
    }

    // Earth rotation
    this.earthGroup.rotation.y += dt * 0.04;

    // Cloud counter-drift (slower than earth)
    this.cloudGroup.rotation.y -= dt * 0.008;

    // Scroll-driven tilt
    if (scrollFrac > 0.01) {
      this.earthGroup.rotation.x = scrollFrac * 0.25;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.scene.traverse(o => {
      if (!o.isMesh && !(o instanceof THREE.Sprite)) return;
      o.geometry?.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.dispose());
    });
  }
}
