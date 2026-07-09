// js/TimelineScene.js — v4
// Fixes: cinematic camera (NOT top-down), ship auto-scale to 3 units,
//        dark navy materials, ocean color #021436, 4 seagulls
import * as THREE from 'three';
import { Water } from './Water.js';

export class TimelineScene {
  constructor(renderer) {
    this.renderer = renderer;

    // ── Scene ──────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07192d);
    this.scene.fog = new THREE.FogExp2(0x061526, 0.016);

    // ── Camera — cinematic side/low angle (NOT top-down) ──
    // y=10, z=22 → ~25° down angle, horizon + ocean visible
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 10, 22);
    this.camera.lookAt(0, 2, 0);

    // ── Scroll state ───────────────────────────────────────
    this._delta      = 0;
    this._absScroll  = 50;   // 0–100, starts centered
    this.smoothAbs   = 50;
    this.smootherAbs = 50;
    this.delta       = 0;
    this.smoothDelta = 0;
    this.camX        = 0;
    this.camY        = 0;
    this.lookX       = 0;

    // ── Objects ────────────────────────────────────────────
    this.ship     = null;
    this.seagulls = [];
    this.buoy     = null;
    this.water    = null;
    this.mixers   = [];
    this._ready   = false;
  }

  // ─────────────────────────────────────────────────────────
  async init({ gltfLoader, ktx2Loader, R1, R4, onProgress }) {
    const scene = this.scene;

    // ── Lights ─────────────────────────────────────────────
    const sun = new THREE.DirectionalLight(0xb8cadf, 2.3);
    sun.position.set(5, 8, 5);
    scene.add(sun);

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    const rim = new THREE.DirectionalLight(0x90e0ef, 0.5);
    rim.position.set(-4, 3, -4);
    scene.add(rim);

    // ── Env map (ocean-envmap.jpg) ─────────────────────────
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    new THREE.TextureLoader().load(
      R4 + 'ocean-envmap.jpg',
      tex => {
        scene.environment = pmrem.fromEquirectangular(tex).texture;
        tex.dispose();
        pmrem.dispose();
      }
    );

    // ── Water ──────────────────────────────────────────────
    // Water normals from Three.js CDN (jsDelivr r175)
    const wNormals = new THREE.TextureLoader().load(
      'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r175/examples/textures/waternormals.jpg',
      t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    );

    try {
      const wGeo = new THREE.PlaneGeometry(400, 400, 64, 64);
      this.water = new Water(wGeo, {
        textureWidth   : 512,
        textureHeight  : 512,
        waterNormals   : wNormals,
        sunDirection   : new THREE.Vector3(5, 8, 5).normalize(),
        sunColor       : 0xb8cadf,
        waterColor     : 0x021436,   // ← design token: deep navy
        distortionScale: 2.5,
        fog            : true,
      });
      this.water.rotation.x = -Math.PI / 2;
      this.water.position.y = -0.05;
      scene.add(this.water);
    } catch (_) {
      // Fallback: flat dark plane
      const flatMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(400, 400),
        new THREE.MeshStandardMaterial({
          color    : 0x021436,
          roughness: 0.05,
          metalness: 0.85,
        })
      );
      flatMesh.rotation.x = -Math.PI / 2;
      flatMesh.position.y = -0.05;
      scene.add(flatMesh);
      this.water = flatMesh;
    }

    // ── Ship ───────────────────────────────────────────────
    await new Promise(resolve => {
      gltfLoader.load(R4 + 'ship.glb', gltf => {
        const model = gltf.scene;

        // Auto-scale → target longest dimension = 3.0 world units
        const box  = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const sf = 3.0 / Math.max(size.x, size.y, size.z, 0.001);
        model.scale.setScalar(sf);

        // Sit exactly on waterline (y=0)
        const box2 = new THREE.Box3().setFromObject(model);
        model.position.y = -box2.min.y;

        // Apply PBR materials (no ship KTX2 available)
        this._applyShipMaterials(model);

        this.ship = model;
        scene.add(model);
        resolve();
      }, undefined, err => {
        console.warn('[TS] ship.glb failed:', err);
        resolve();
      });
    });

    // ── Seagulls — 4 birds ─────────────────────────────────
    await new Promise(resolve => {
      gltfLoader.load(R4 + 'seagull.glb', gltf => {
        const template = gltf.scene;
        const anims    = gltf.animations || [];

        // Seagull diffuse texture (try KTX2, fallback white)
        const applyTex = (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          template.traverse(m => {
            if (m.isMesh) {
              m.material = new THREE.MeshStandardMaterial({
                map      : tex,
                roughness: 0.85,
                metalness: 0.0,
                side     : THREE.DoubleSide,
              });
            }
          });
        };
        const applyFallback = () => {
          template.traverse(m => {
            if (m.isMesh) {
              m.material = new THREE.MeshStandardMaterial({
                color    : 0xd0d8e4,   // pale gull white
                roughness: 0.85,
                metalness: 0.0,
              });
            }
          });
        };

        if (ktx2Loader) {
          ktx2Loader.load(R4 + 'seagull_diffuse.ktx2', applyTex,
            undefined, applyFallback);
        } else {
          applyFallback();
        }

        // Auto-scale seagull → wingspan ≈ 0.45 world units
        const sgBox  = new THREE.Box3().setFromObject(template);
        const sgSize = new THREE.Vector3();
        sgBox.getSize(sgSize);
        const sgSF = 0.45 / Math.max(sgSize.x, sgSize.z, 0.001);
        template.scale.setScalar(sgSF);

        // 4 birds: [relX, relY, relZ, orbitSpeed, phaseOffset]
        const configs = [
          [  1.5,  2.5,  1.2, 0.28, 0.00 ],
          [ -1.2,  3.0, -0.8, 0.22, 1.80 ],
          [  3.0,  3.8,  0.4, 0.35, 0.95 ],
          [ -2.2,  3.2,  1.8, 0.25, 3.20 ],
        ];

        configs.forEach(([rx, ry, rz, spd, ph]) => {
          const bird       = template.clone(true);
          bird.userData    = { rx, ry, rz, spd, ph };

          if (anims.length > 0) {
            const mx = new THREE.AnimationMixer(bird);
            anims.forEach(clip => {
              const action = mx.clipAction(clip);
              action.play();
            });
            mx.timeScale = 0.8 + Math.random() * 0.5;
            this.mixers.push(mx);
          }

          this.seagulls.push(bird);
          scene.add(bird);
        });

        resolve();
      }, undefined, err => {
        console.warn('[TS] seagull.glb failed:', err);
        resolve();
      });
    });

    // ── Buoy ───────────────────────────────────────────────
    await new Promise(resolve => {
      gltfLoader.load(R4 + 'buoy.glb', gltf => {
        const buoy = gltf.scene;

        const bBox  = new THREE.Box3().setFromObject(buoy);
        const bSize = new THREE.Vector3();
        bBox.getSize(bSize);
        buoy.scale.setScalar(0.5 / Math.max(bSize.y, 0.001));

        if (ktx2Loader) {
          ktx2Loader.load(R4 + 'bouy_diffuse.ktx2', tex => {
            tex.colorSpace = THREE.SRGBColorSpace;
            buoy.traverse(m => {
              if (m.isMesh && m.material) {
                m.material.map = tex;
                m.material.needsUpdate = true;
              }
            });
          });
        }

        buoy.position.set(8, 0, -2);
        this.buoy = buoy;
        scene.add(buoy);
        resolve();
      }, undefined, err => {
        console.warn('[TS] buoy.glb failed:', err);
        resolve();
      });
    });

    this._ready = true;
  }

  // ─────────────────────────────────────────────────────────
  // Apply PBR materials to ship mesh by vertical position
  // Hull bottom → dark red-brown | hull mid → dark navy
  // superstructure → white/off-white | accents → orange
  // ─────────────────────────────────────────────────────────
  _applyShipMaterials(model) {
    const box    = new THREE.Box3().setFromObject(model);
    const totalH = box.max.y - box.min.y;

    model.traverse(mesh => {
      if (!mesh.isMesh) return;

      const name = (mesh.name || '').toLowerCase();
      const mBox = new THREE.Box3().setFromObject(mesh);
      const midY = (mBox.min.y + mBox.max.y) * 0.5;
      const relY = totalH > 0 ? (midY - box.min.y) / totalH : 0.5;

      let color, roughness = 0.75, metalness = 0.15;

      // ── Vertical zone defaults ──
      if      (relY < 0.12) { color = 0x5c1a10; roughness = 0.9;  metalness = 0.05; } // keel/bilge: anti-fouling red
      else if (relY < 0.40) { color = 0x0a1628; roughness = 0.70; metalness = 0.20; } // main hull: dark navy
      else if (relY < 0.65) { color = 0x0e2040; roughness = 0.68; metalness = 0.18; } // mid-body: navy
      else                  { color = 0xdde4e8; roughness = 0.55; metalness = 0.10; } // superstructure: off-white

      // ── Name overrides ──
      if      (name.includes('orange') || name.includes('stripe') || name.includes('band'))
                            { color = 0xff7438; roughness = 0.70; metalness = 0.0;  }
      else if (name.includes('glass') || name.includes('window'))
                            { color = 0x5bbfdd; roughness = 0.05; metalness = 0.90; }
      else if (name.includes('metal') || name.includes('crane')
            || name.includes('mast')  || name.includes('antenna'))
                            { color = 0x3a4a5c; roughness = 0.35; metalness = 0.80; }

      mesh.material      = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      mesh.castShadow    = false;
      mesh.receiveShadow = false;
    });
  }

  // ─────────────────────────────────────────────────────────
  addScrollDelta(rawDelta, isTouch) {
    const speed     = isTouch ? 0.8 : 0.5;
    this._delta     = Math.max(-1.3, Math.min(1.3, rawDelta * speed));
    this._absScroll = Math.max(0, Math.min(100,
      this._absScroll + this._delta * 0.8
    ));
  }

  // ─────────────────────────────────────────────────────────
  update(dt, localFrac, phase) {
    if (!this._ready) return;

    const nDelta = Math.min(dt * 60, 3);

    // ── Smooth scroll chain ───────────────────────────────
    this.smoothAbs   += (this._absScroll  - this.smoothAbs)   * 0.10 * nDelta;
    this.smootherAbs += (this.smoothAbs   - this.smootherAbs) * 0.10 * nDelta;
    this.smoothDelta += (this._delta      - this.smoothDelta)  * 0.03 * nDelta;
    this.camX        += (this.smoothDelta - this.camX)         * 0.06 * nDelta;
    this.camY        += (this.smoothDelta - this.camX)         * 0.10 * nDelta;
    this.lookX       += (this.smoothDelta - this.lookX)        * 0.07 * nDelta;

    // Decay per-frame delta
    this._delta *= 0.88;

    // ── Ship journey: -40 → +40 units X ──────────────────
    const shipX = (this.smootherAbs - 50) * 0.8;

    if (this.ship) {
      this.ship.position.x = shipX;
      this.ship.position.y = 0;
      this.ship.rotation.y = -this.smoothDelta * 0.12;  // gentle yaw
    }

    // ── Seagulls — lazy orbit around ship ────────────────
    const t = performance.now() * 0.001;
    this.seagulls.forEach(bird => {
      const { rx, ry, rz, spd, ph } = bird.userData;
      const ang = t * spd + ph;
      bird.position.set(
        shipX + rx + Math.sin(ang * 1.7) * 1.2,
        ry    + Math.sin(t * spd * 1.3 + ph) * 0.25,
        rz    + Math.cos(ang) * 0.9
      );
      // Face direction of travel
      const dx = Math.cos(ang * 1.7) * 1.7 * 1.2;
      const dz = -Math.sin(ang) * 0.9;
      bird.rotation.y = Math.atan2(dx, dz);
    });

    // ── Buoy — gentle bob ────────────────────────────────
    if (this.buoy) {
      this.buoy.position.x = shipX + 8;
      this.buoy.position.y = Math.sin(t * 0.7) * 0.08;
    }

    // ── Water time uniform ────────────────────────────────
    if (this.water?.material?.uniforms?.['time']) {
      this.water.material.uniforms['time'].value += dt;
    }

    // ── Wing flap mixers ──────────────────────────────────
    this.mixers.forEach(m => m.update(dt));

    // ── Camera — cinematic low angle ──────────────────────
    // y=10 → shows horizon; z=22 → enough ocean visible
    this.camera.position.set(
      shipX + this.camX * 0.5,
      10 + this.camY * 0.3,
      22
    );
    this.camera.lookAt(
      shipX + this.lookX * 0.5,
      2,   // look at sea level, not y=0 (water surface)
      0
    );
  }

  // ─────────────────────────────────────────────────────────
  render() {
    if (!this._ready) return;
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
