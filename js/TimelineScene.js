// ============================================================
// TimelineScene.js  v8
// Fix 1: _applyShipMaterials() — preserve GLB, chỉ override glass
// Fix 2: AmbientLight 0xffffff × 0.6  (không còn cyan wash)
// New:   get progress() { return this._absScroll; }
// ============================================================
import * as THREE from 'three';

const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

export class TimelineScene {

  constructor(renderer) {
    this._renderer    = renderer;
    this._scene       = new THREE.Scene();
    this._camera      = null;

    // 3D objects
    this._ship        = null;
    this._baseY       = 0;
    this._seagulls    = [];
    this._buoy        = null;
    this._clouds      = [];
    this._wakeGroup   = null;
    this._water       = null;
    this._moon        = null;

    // Scroll state
    this._absScroll   = 0;
    this._delta       = 0;
    this._smoothAbs   = 0;
    this._smootherAbs = 0;
    this._smoothDelta = 0;

    // Camera smooth state
    this._camX  = 0;
    this._camY  = 0;
    this._lookX = 0;

    this._clock = new THREE.Clock();
    this._ready = false;
  }

  /* ─── public getter (NEW in v8) ─────────────────────────── */
  get progress() { return this._absScroll; }

  /* ─── init ──────────────────────────────────────────────── */
  async init({ gltfLoader, ktx2Loader, R1, R4, onProgress }) {
    const S = this._scene;
    S.background = new THREE.Color(0x07192d);
    S.fog = new THREE.FogExp2(0x07192d, 0.018);

    /* Camera */
    this._camera = new THREE.PerspectiveCamera(
      55, window.innerWidth / window.innerHeight, 0.1, 1000
    );
    this._camera.position.set(0, 3, 12);
    this._camera.lookAt(0, 2, 0);

    /* ── Lighting (v8 FIX: neutral ambient, không cyan) ──── */
    S.add(new THREE.AmbientLight(0xffffff, 0.6));          // ← FIXED

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
    sun.position.set(5, 8, 3);
    sun.castShadow = true;
    S.add(sun);

    const fill = new THREE.DirectionalLight(0xadd8e6, 0.4);
    fill.position.set(-5, 2, -3);
    S.add(fill);

    /* ── Scene primitives ────────────────────────────────── */
    this._buildMoon(S);
    this._buildWater(S);
    this._buildStars(S);

    /* ── Asset loads ─────────────────────────────────────── */
    const jobs = [];

    // --- Ship ---
    jobs.push(
      gltfLoader.loadAsync(R4 + 'ship.glb').then(gltf => {
        const ship = gltf.scene;
        ship.scale.setScalar(7.0);
        ship.position.set(0, 0, 0);
        this._applyShipMaterials(ship);             // ← FIXED
        S.add(ship);
        this._ship  = ship;
        this._baseY = ship.position.y;
        console.log('[TS] ship GLB materials preserved ✓');
      })
    );

    // --- Seagulls ---
    jobs.push(
      gltfLoader.loadAsync(R4 + 'seagull.glb').then(gltf => {
        const base = gltf.scene;
        for (let i = 0; i < 6; i++) {
          const sg = base.clone(true);
          sg.scale.setScalar(0.3 + Math.random() * 0.2);
          sg.userData = {
            rx : 3 + Math.random() * 4,
            ry : 2 + Math.random() * 3,
            rz : 0.5 + Math.random() * 0.5,
            spd: 0.4 + Math.random() * 0.3,
            ph : Math.random() * Math.PI * 2
          };
          S.add(sg);
          this._seagulls.push(sg);
        }
      })
    );

    // --- Buoy ---
    jobs.push(
      gltfLoader.loadAsync(R4 + 'buoy.glb').then(gltf => {
        const buoy = gltf.scene;
        buoy.scale.setScalar(0.5);
        buoy.position.set(4, 0, -2);
        S.add(buoy);
        this._buoy = buoy;
      })
    );

    // --- Clouds GLB (5 instances) ---
    jobs.push(
      gltfLoader.loadAsync(R4 + 'clouds.glb').then(gltf => {
        const base  = gltf.scene;
        const spots = [
          [-8, 4, -10], [6, 5, -12], [-5, 6, -15],
          [10, 4,  -8], [0,  7, -20]
        ];
        spots.forEach(([x, y, z]) => {
          const c = base.clone(true);
          c.position.set(x, y, z);
          c.scale.setScalar(2.0 + Math.random() * 1.5);
          S.add(c);
          this._clouds.push(c);
        });
        console.log(`[TS] ${spots.length} cloud instances (GLB) ✓`);
      })
    );

    await Promise.all(jobs);

    /* Wake — needs ship position to be set first */
    this._buildWake(S);

    this._ready = true;
    console.log('TimelineScene v8 ready ✓');
  }

  /* ─────────────────────────────────────────────────────────
   * v8 KEY FIX: preserve GLB ship materials
   * Chỉ override glass/window mesh — toàn bộ còn lại giữ nguyên
   * ───────────────────────────────────────────────────────── */
  _applyShipMaterials(ship) {
    ship.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow    = true;
      child.receiveShadow = true;

      const nm = (child.name              || '').toLowerCase();
      const mm = (child.material?.name    || '').toLowerCase();
      const isGlass = nm.includes('glass')  || nm.includes('window') ||
                      mm.includes('glass')  || mm.includes('window');

      if (isGlass) {
        child.material = new THREE.MeshPhysicalMaterial({
          color       : 0x88bbdd,
          transparent : true,
          opacity     : 0.35,
          roughness   : 0.05,
          metalness   : 0.10,
          transmission: 0.60
        });
      }
      // ALL other meshes → keep original GLB material intact
    });
  }

  /* ─── scene builders ─────────────────────────────────────── */
  _buildMoon(S) {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0xf0e8c0, roughness: 0.9, metalness: 0,
        emissive: 0xf0e8c0, emissiveIntensity: 0.3
      })
    );
    moon.position.set(-6, 8, -20);
    S.add(moon);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.8, 32, 32),
      new THREE.MeshBasicMaterial({
        color:0xf0e8c0, transparent:true, opacity:0.08, side:THREE.BackSide
      })
    );
    moon.add(halo);
    this._moon = moon;
  }

  _buildWater(S) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a2a4a, roughness: 0.15, metalness: 0.6,
      envMapIntensity: 1.2
    });
    this._water = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300, 64, 64), mat
    );
    this._water.rotation.x   = -Math.PI / 2;
    this._water.position.y   = -0.5;
    this._water.receiveShadow = true;
    S.add(this._water);
  }

  _buildStars(S) {
    const N = 800;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i*3]   = (Math.random() - 0.5) * 200;
      pos[i*3+1] = Math.random() * 60 + 5;
      pos[i*3+2] = (Math.random() - 0.5) * 200;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    S.add(new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color:0xffffff, size:0.15, sizeAttenuation:true })
    ));
  }

  _buildWake(S) {
    this._wakeGroup = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3 + i * 0.4, 4 + i * 1.5),
        new THREE.MeshBasicMaterial({
          color:0xffffff, transparent:true, opacity:0.12, side:THREE.DoubleSide
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((i % 2 === 0 ? 1 : -1) * (0.5 + i * 0.3), -0.45, 1.5 + i);
      this._wakeGroup.add(mesh);
    }
    const sp = this._ship ? this._ship.position : new THREE.Vector3();
    this._wakeGroup.position.copy(sp);
    S.add(this._wakeGroup);
  }

  /* ─── scroll API ─────────────────────────────────────────── */
  addScrollDelta(raw, isTouch) {
    const speed = isTouch ? 0.8 : 0.5;
    let d = raw * 0.01 * speed;
    d = clamp(-1.3, 1.3, d);
    d *= 0.8;
    this._delta += d;
  }

  /* ─── animation loop ─────────────────────────────────────── */
  update(dt) {
    if (!this._ready) return;
    const t = this._clock.getElapsedTime();

    // Smoothing kernels
    const k1 = 1 - Math.exp(-3.5 * dt);
    const k2 = 1 - Math.exp(-1.8 * dt);
    const k3 = 1 - Math.exp(-5.0 * dt);

    // Scroll integration
    this._absScroll    = clamp(0, 100, this._absScroll + this._delta);
    this._smoothAbs   += (this._absScroll  - this._smoothAbs)   * k1;
    this._smootherAbs += (this._smoothAbs  - this._smootherAbs) * k2;
    this._smoothDelta += (this._delta      - this._smoothDelta)  * k3;
    this._delta       *= Math.pow(0.05, dt);  // auto-decay

    // Camera pan
    const frac    = (this._smootherAbs - 50) / 50;
    const tgtCamX = frac * 5.5;
    const kCam    = 1 - Math.exp(-1.2 * dt);
    this._camX   += (tgtCamX - this._camX) * kCam;

    this._camera.position.set(
      this._camX,
      3 + this._camY + Math.sin(t * 0.17) * 0.10,
      12
    );
    this._camera.lookAt(this._lookX, 2, 0);

    // Ship bob / roll / pitch
    if (this._ship) {
      this._ship.position.y = this._baseY + Math.sin(t * 0.60) * 0.04;
      this._ship.rotation.z = Math.sin(t * 0.38) * 0.007;
      this._ship.rotation.x = Math.sin(t * 0.28 + 1.1) * 0.003;
    }

    // Wake opacity driven by scroll speed
    if (this._wakeGroup) {
      const op = Math.min(0.30, Math.abs(this._smoothDelta) * 0.12 + 0.08);
      this._wakeGroup.children.forEach(m => {
        if (m.material) m.material.opacity = op;
      });
    }

    // Seagulls orbit
    this._seagulls.forEach(sg => {
      const { rx, ry, rz, spd, ph } = sg.userData;
      const a = t * spd + ph;
      sg.position.set(
        Math.cos(a) * rx,
        ry + Math.sin(t * 0.5 + ph) * rz,
        Math.sin(a) * rx
      );
      sg.rotation.y = -a + Math.PI;
    });

    // Buoy bob + sway
    if (this._buoy) {
      this._buoy.position.y = Math.sin(t * 0.72 + 1.3) * 0.06;
      this._buoy.rotation.z = Math.sin(t * 0.51 + 0.7) * 0.04;
    }
  }

  /* ─── render / resize / dispose ─────────────────────────── */
  render() {
    if (!this._ready) return;
    this._renderer.render(this._scene, this._camera);
  }

  onResize() {
    if (!this._camera) return;
    this._camera.aspect = window.innerWidth / window.innerHeight;
    this._camera.updateProjectionMatrix();
  }

  dispose() {
    this._scene.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        (Array.isArray(child.material)
          ? child.material : [child.material]
        ).forEach(m => m.dispose());
      }
    });
  }
}
