// js/TimelineScene.js — Ship + Ocean timeline scene
import * as THREE from 'three';
import { Water }  from './Water.js';

export class TimelineScene {
  /**
   * @param {THREE.WebGLRenderer} renderer  Shared renderer — NEVER reassigned.
   */
  constructor(renderer) {
    this.renderer = renderer; // ← set once, never changed

    /* ── Scene ───────────────────────────────────────────── */
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07192d);
    this.scene.fog = new THREE.FogExp2(0x07192d, 0.018);

    /* ── Camera: FOV=10 ──────────────────────────────────── */
    this.camera = new THREE.PerspectiveCamera(
      10,
      window.innerWidth / window.innerHeight,
      0.1, 500
    );
    this.camera.position.set(0, 30, 15);
    this.camera.lookAt(0, 0, 0);

    /* ── Smooth scroll state (from original spec) ─────────── */
    this._absScroll    = 0;
    this._smoothAbs    = 0;
    this._smootherAbs  = 0;
    this._delta        = 0;
    this._smoothDelta  = 0;
    this._camX         = 0;
    this._camY         = 0;
    this._lookX        = 0;

    /* ── Lights (spec: white 5.0, pos 1.8/7.7/-6.1) ──────── */
    this._setupLights();

    /* ── Water ───────────────────────────────────────────── */
    this._water = new Water();
    this.scene.add(this._water.build());

    /* ── State ───────────────────────────────────────────── */
    this._ship    = null;
    this._seagull = null;
    this._buoy    = null;
    this._ready   = false;
    this._clock   = 0;
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const dir = new THREE.DirectionalLight(0xffffff, 5);
    dir.position.set(1.8, 7.7, -6.1);
    dir.castShadow             = true;
    dir.shadow.mapSize.width   = 1024;
    dir.shadow.mapSize.height  = 1024;
    dir.shadow.camera.near     = 4;
    dir.shadow.camera.far      = 14;
    dir.shadow.camera.left     = -6.5;
    dir.shadow.camera.right    = 6.5;
    dir.shadow.camera.top      = 6.5;
    dir.shadow.camera.bottom   = -6.5;
    dir.shadow.bias            = -0.0001;
    this.scene.add(dir);
    this._dirLight = dir;
  }

  /* ── Public API ──────────────────────────────────────── */

  async init({ gltfLoader, ktx2Loader, R1, R4, onProgress }) {
    const tl = new THREE.TextureLoader();
    onProgress?.(0.0);

    /* 1. Environment map */
    let envMap = null;
    try {
      const envTex = await new Promise((res, rej) =>
        tl.load(R4 + 'ocean-envmap.jpg', res, undefined, rej)
      );
      envTex.mapping = THREE.EquirectangularReflectionMapping;
      // pmrem = LOCAL variable — this.renderer is NOT touched
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      envMap = pmrem.fromEquirectangular(envTex).texture;
      pmrem.dispose();
      envTex.dispose();
      this.scene.environment          = envMap;
      this.scene.environmentIntensity = 0.5;
      this._water.setEnvMap(envMap);
      console.log('[TimelineScene] envmap ✓');
    } catch(e) {
      console.warn('[TimelineScene] envmap failed:', e.message);
    }
    onProgress?.(0.25);

    /* 2. Ship model */
    await this._loadModel(gltfLoader, R4 + 'ship.glb',
      gltf => {
        this._ship = gltf.scene;
        this._ship.traverse(c => {
          if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
        });
        this._ship.position.set(0, 0.05, 0);
        this._ship.scale.setScalar(1);
        this.scene.add(this._ship);
        console.log('[TimelineScene] ship.glb ✓');
      },
      () => {
        // Fallback ship (box)
        this._ship = this._makeFallbackShip();
        this.scene.add(this._ship);
        console.warn('[TimelineScene] using fallback ship');
      }
    );
    onProgress?.(0.60);

    /* 3. Seagull (optional) */
    await this._loadModel(gltfLoader, R4 + 'seagull.glb',
      gltf => {
        this._seagull = gltf.scene;
        this._seagull.scale.setScalar(0.25);
        this._seagull.position.set(2.5, 3.5, -1.5);
        this.scene.add(this._seagull);
        console.log('[TimelineScene] seagull.glb ✓');
      }
    );
    onProgress?.(0.80);

    /* 4. Buoy (optional) */
    await this._loadModel(gltfLoader, R4 + 'buoy.glb',
      gltf => {
        this._buoy = gltf.scene;
        this._buoy.scale.setScalar(0.3);
        this._buoy.position.set(4, 0.1, 2);
        this.scene.add(this._buoy);
        console.log('[TimelineScene] buoy.glb ✓');
      }
    );
    onProgress?.(1.0);

    this._ready = true;
    console.log('[TimelineScene] ready ✓');
  }

  /* Generic model loader with optional fallback */
  _loadModel(gltfLoader, url, onSuccess, onFail) {
    return new Promise(resolve => {
      gltfLoader.load(url, gltf => {
        try { onSuccess(gltf); } catch(e) { console.error(e); }
        resolve();
      }, undefined, err => {
        console.warn('[TimelineScene] load failed:', url, err.message);
        onFail?.();
        resolve(); // non-fatal
      });
    });
  }

  _makeFallbackShip() {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.45, 4.5),
      new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.4 })
    );
    hull.position.y = 0.22;
    hull.castShadow = true;
    g.add(hull);
    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.65, 1.1),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 })
    );
    bridge.position.set(0, 0.75, -0.6);
    bridge.castShadow = true;
    g.add(bridge);
    return g;
  }

  /* ── Scroll delta input (called from main.js) ─────────── */
  addScrollDelta(rawDelta, isTouch) {
    const speed = isTouch ? 10 : 25;
    const clamped = Math.max(-1.3, Math.min(1.3, rawDelta * speed));
    this._delta += clamped;
  }

  update(dt, scrollFrac, phase) {
    if (!this._ready) return;
    this._clock += dt;

    const nDelta = dt * 60; // normalize to 60fps

    /* ── Scroll smoothing chain (spec-accurate) ─────────── */
    const absScroll = scrollFrac * 100;

    this._smoothAbs   += (absScroll        - this._smoothAbs)   * 0.1  * nDelta;
    this._smootherAbs += (this._smoothAbs  - this._smootherAbs) * 0.1  * nDelta;
    this._delta       += (0                - this._delta)        * 0.01 * nDelta;
    this._smoothDelta += (this._delta      - this._smoothDelta)  * 0.03 * nDelta;

    this._camX  += (this._smoothDelta - this._camX)  * 0.06 * nDelta;
    this._camY  += (this._smoothDelta - this._camX)  * 0.10 * nDelta; // spec uses camX intentionally
    this._lookX += (this._smoothDelta - this._lookX) * 0.07 * nDelta;

    /* ── Apply camera ───────────────────────────────────── */
    this.camera.position.set(
      this._camX,
      30 + this._camY * 0.4,
      15
    );
    this.camera.lookAt(this._lookX * 0.5, 0, 0);

    /* ── Ship bob & roll ─────────────────────────────────── */
    if (this._ship) {
      const t = this._clock;
      this._ship.position.y = 0.05 + Math.sin(t * 0.9) * 0.04;
      this._ship.rotation.z = Math.sin(t * 0.7) * 0.018;
      this._ship.rotation.x = Math.sin(t * 0.5) * 0.008;
    }

    /* ── Seagull circle flight ───────────────────────────── */
    if (this._seagull) {
      const t = this._clock * 0.5;
      this._seagull.position.x  = Math.sin(t) * 3.5;
      this._seagull.position.z  = Math.cos(t) * 2.0 - 1;
      this._seagull.position.y  = 3.5 + Math.sin(t * 2.1) * 0.4;
      this._seagull.rotation.y  = -t + Math.PI;
    }

    /* ── Buoy bob ────────────────────────────────────────── */
    if (this._buoy) {
      this._buoy.position.y = 0.1 + Math.sin(this._clock * 1.1) * 0.06;
      this._buoy.rotation.z = Math.sin(this._clock * 0.8) * 0.03;
    }

    /* ── Water animation ─────────────────────────────────── */
    this._water.update(dt);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this._water.dispose();
    this.scene.traverse(o => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.dispose());
    });
  }
}
