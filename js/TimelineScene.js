// js/TimelineScene.js — Ship + Ocean timeline scene
import * as THREE from 'three';
import { Water }  from './Water.js';

export class TimelineScene {
  /**
   * @param {THREE.WebGLRenderer} renderer  Shared renderer — NEVER reassigned.
   */
  constructor(renderer) {
    this.renderer = renderer; // set once, never changed

    /* ── Scene ───────────────────────────────────────────── */
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07192d);
    this.scene.fog = new THREE.FogExp2(0x07192d, 0.018);

    /* ── Camera: FOV=10 (telephoto, semi-top-down) ────────── */
    this.camera = new THREE.PerspectiveCamera(
      10,
      window.innerWidth / window.innerHeight,
      0.1, 500
    );
    this.camera.position.set(0, 30, 15);
    this.camera.lookAt(0, 0, 0);

    /* ── Smooth scroll state (spec-accurate names) ────────── */
    this._smoothAbs    = 0;   // single-smoothed abs scroll (0-100)
    this._smootherAbs  = 0;   // double-smoothed abs scroll — drives ship journey
    this._delta        = 0;   // instantaneous scroll velocity (bounded, decays to 0)
    this._smoothDelta  = 0;   // smoothed velocity → camera sway
    this._camX         = 0;   // camera X sway offset
    this._camY         = 0;   // camera Y sway offset
    this._lookX        = 0;   // lookAt X sway offset

    /* ── Lights (spec: dir white 5.0, pos 1.8/7.7/-6.1) ──── */
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

  /* ── Lights ──────────────────────────────────────────── */
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
    dir.shadow.camera.right    =  6.5;
    dir.shadow.camera.top      =  6.5;
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
    try {
      const envTex = await new Promise((res, rej) =>
        tl.load(R4 + 'ocean-envmap.jpg', res, undefined, rej)
      );
      envTex.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(this.renderer); // local var — renderer safe
      pmrem.compileEquirectangularShader();
      const envMap = pmrem.fromEquirectangular(envTex).texture;
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

    /* 2. Ship */
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
        this.scene.add(this._buoy);
        console.log('[TimelineScene] buoy.glb ✓');
      }
    );
    onProgress?.(1.0);

    this._ready = true;
    console.log('[TimelineScene] ready ✓');
  }

  /* ── Generic loader with optional fallback ─────────── */
  _loadModel(gltfLoader, url, onSuccess, onFail) {
    return new Promise(resolve => {
      gltfLoader.load(url, gltf => {
        try { onSuccess(gltf); } catch(e) { console.error(e); }
        resolve();
      }, undefined, err => {
        console.warn('[TimelineScene] load failed:', url, err?.message ?? err);
        onFail?.();
        resolve(); // non-fatal — carry on
      });
    });
  }

  /* ── Fallback ship geometry ─────────────────────────── */
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

  /* ── Scroll input (called per frame from main.js) ────── */
  addScrollDelta(rawDelta, isTouch) {
    const speed = isTouch ? 10 : 25;
    const clamped = Math.max(-1.3, Math.min(1.3, rawDelta * speed));
    // BUG FIX: SET (not +=) — delta is instantaneous velocity, bounded ±1.3
    // Without this fix camX accumulates → ship flies off screen
    this._delta = clamped;
  }

  /* ── Per-frame update ────────────────────────────────── */
  update(dt, scrollFrac, phase) {
    if (!this._ready) return;
    this._clock += dt;

    const nDelta   = dt * 60; // normalize deltas to 60fps
    const absScroll = scrollFrac * 100; // 0-100

    /* ── Scroll smoothing chain (spec-accurate) ──────────── */
    this._smoothAbs   += (absScroll         - this._smoothAbs)   * 0.1  * nDelta;
    this._smootherAbs += (this._smoothAbs   - this._smootherAbs) * 0.1  * nDelta;
    this._delta       += (0                 - this._delta)        * 0.01 * nDelta;
    this._smoothDelta += (this._delta       - this._smoothDelta)  * 0.03 * nDelta;
    this._camX        += (this._smoothDelta - this._camX)         * 0.06 * nDelta;
    this._camY        += (this._smoothDelta - this._camX)         * 0.10 * nDelta; // camX intentional per spec
    this._lookX       += (this._smoothDelta - this._lookX)        * 0.07 * nDelta;

    /* ── Ship journey position along X (driven by smootherAbs) ──
       smootherAbs: 0-100 → ship travels from -40 to +40 world units
       Ocean plane (100×100) stays at origin — always in frame ── */
    const TRAVEL_SCALE = 0.8; // 1 unit per % of scroll
    const shipX = (this._smootherAbs - 50) * TRAVEL_SCALE; // -40 → +40

    const t = this._clock;

    /* ── Ship: position + bob + roll ─────────────────────── */
    if (this._ship) {
      this._ship.position.x = shipX;
      this._ship.position.y = 0.05 + Math.sin(t * 0.9) * 0.04;
      this._ship.rotation.z = Math.sin(t * 0.7) * 0.018;
      this._ship.rotation.x = Math.sin(t * 0.5) * 0.008;
      // Subtle yaw lean in direction of travel (follows scroll velocity)
      this._ship.rotation.y = -this._smoothDelta * 0.04;
    }

    /* ── Seagull: circle orbit relative to ship ──────────── */
    if (this._seagull) {
      const st = t * 0.5;
      this._seagull.position.x = shipX + Math.sin(st) * 3.5;
      this._seagull.position.z = Math.cos(st) * 2.0 - 1;
      this._seagull.position.y = 3.5 + Math.sin(st * 2.1) * 0.4;
      this._seagull.rotation.y = -st + Math.PI;
    }

    /* ── Buoy: bobs near ship ────────────────────────────── */
    if (this._buoy) {
      this._buoy.position.x = shipX + 4;
      this._buoy.position.y = 0.1 + Math.sin(t * 1.1) * 0.06;
      this._buoy.position.z = 2;
      this._buoy.rotation.z = Math.sin(t * 0.8) * 0.03;
    }

    /* ── Camera: follows ship + velocity sway ────────────── */
    // camX/camY/lookX stay bounded (max ±1.3) — ship stays in frame
    this.camera.position.set(
      shipX + this._camX,          // follow ship X + tiny sway
      30 + this._camY * 0.4,       // base height + tiny lean
      15
    );
    this.camera.lookAt(
      shipX + this._lookX * 0.5,   // look slightly ahead of ship
      0,
      0
    );

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
      (Array.isArray(o.material) ? o.material : [o.material])
        .forEach(m => m?.dispose());
    });
  }
}
