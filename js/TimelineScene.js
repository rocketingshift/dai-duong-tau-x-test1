// js/TimelineScene.js — v6
// v6 LIGHTING FIX:
//   - toneMappingExposure phải set 1.6 trong main.js (không phải ở đây)
//   - Sun: 0xb8d4f5×2.3 → 0xffeedd×3.5  (ấm hơn, sáng hơn)
//   - Ambient: 0x334466×0.9 → 0x7aadc8×1.6  (+6× fill sáng hơn)
//   - Rim: ×0.45 → ×0.9  (mạnh hơn 2×)
//   - Fill light MỚI: 0x4488bb×0.75 từ phía trước
//   - Water base: 0x021436 → 0x0b3560  (visible dark navy)
//   - Sky/fog: 0x0a1e30 → 0x142d45  (+50% sáng hơn)
//   - Hull main: 0x060e1c → 0x1a3652  (+4× sáng hơn)
//   - Hull mid:  0x0c1e38 → 0x2c4f72  (+3× sáng hơn)
// v5 features kept:
//   - Reliable water: custom ShaderMaterial (no Water.js)
//   - Ship: auto-scale 5 units, submerged 20%
//   - Bow wake: V-shape foam mesh, speed-reactive opacity
//   - 4 seagulls orbiting ship
//   - Camera: y=6, z=14 — cinematic side view

import * as THREE from 'three';

// Module-level constants (original — kept for _buildClouds fallback)
const R1 = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x-1@main/';
const R4 = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x4@main/';

// ── Water vertex shader ────────────────────────────────────────────────────
const WATER_VERT = /* glsl */`
  varying vec2  vUv;
  varying vec3  vWorldPos;
  varying vec3  vNormal;
  void main() {
    vUv       = uv;
    vec4 wp   = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal   = (modelMatrix * vec4(normal, 0.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// ── Water fragment shader ──────────────────────────────────────────────────
const WATER_FRAG = /* glsl */`
  precision highp float;
  uniform float     uTime;
  uniform vec3      uWaterColor;   // v6: 0x0b3560 (visible dark navy)
  uniform vec3      uFogColor;     // v6: 0x142d45 (matches sky)
  uniform float     uFogDensity;
  uniform vec3      uCamPos;
  uniform sampler2D uNormals;
  uniform float     uHasNormals;
  varying vec2  vUv;
  varying vec3  vWorldPos;

  void main() {
    // Procedural animated normals (2 overlapping wave sets)
    vec2 uv1 = vUv * 6.0  + vec2( uTime * 0.018, uTime * 0.012);
    vec2 uv2 = vUv * 11.0 + vec2(-uTime * 0.013, uTime * 0.021);
    float h1 = sin(uv1.x * 6.283) * cos(uv1.y * 6.283);
    float h2 = sin(uv2.x * 5.132) * cos(uv2.y * 4.189);

    vec3 nn = vec3(0.0, 1.0, 0.0);
    if (uHasNormals > 0.5) {
      vec3 tn1 = texture2D(uNormals, uv1).xyz * 2.0 - 1.0;
      vec3 tn2 = texture2D(uNormals, uv2).xyz * 2.0 - 1.0;
      nn = normalize(tn1 + tn2 + vec3(0.0, 2.0, 0.0));
    } else {
      nn = normalize(vec3(h1 * 0.25, 1.0, h2 * 0.25));
    }

    // Fresnel
    vec3  viewDir = normalize(uCamPos - vWorldPos);
    float vDotN   = max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0);
    float fresnel = pow(1.0 - vDotN, 3.5) * 0.65;

    // Specular (sun at 5,8,5)
    vec3  sunDir = normalize(vec3(5.0, 8.0, 5.0));
    vec3  halfV  = normalize(sunDir + viewDir);
    float spec   = pow(max(dot(nn, halfV), 0.0), 128.0);

    vec3 color = uWaterColor;
    color = mix(color, vec3(0.05, 0.18, 0.38), fresnel * 0.55);
    color += vec3(0.65, 0.75, 0.85) * spec * 0.55;

    // Fog
    float dist      = length(vWorldPos - uCamPos);
    float fogFactor = 1.0 - exp(-uFogDensity * dist);
    color = mix(color, uFogColor, clamp(fogFactor, 0.0, 0.85));

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
export class TimelineScene {
  constructor(renderer) {
    this.renderer = renderer;

    // ── Scene ──────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    // v6: sky brightened 0x0a1e30 → 0x142d45
    this.scene.background = new THREE.Color(0x142d45);
    this.scene.fog = new THREE.FogExp2(0x142d45, 0.005);

    // ── Camera — cinematic low-angle side view ──────────────────────────────
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      800
    );
    this.camera.position.set(0, 6, 14);
    this.camera.lookAt(0, 1, 0);

    // ── Scroll state ────────────────────────────────────────────────────────
    this._delta      = 0;
    this._absScroll  = 50;
    this.smoothAbs   = 50;
    this.smootherAbs = 50;
    this.smoothDelta = 0;
    this.camX        = 0;
    this.camY        = 0;
    this.lookX       = 0;

    // ── Scene objects ────────────────────────────────────────────────────────
    this.ship          = null;
    this.seagulls      = [];
    this.buoy          = null;
    this.waterMesh     = null;
    this.waterUniforms = null;
    this.wakeL         = null;
    this.wakeR         = null;
    this.clouds        = [];
    this.mixers        = [];
    this._ready        = false;
    this._time         = 0;   // internal elapsed time (seconds)
  }

  // ────────────────────────────────────────────────────────────────────────────
  async init({ gltfLoader, ktx2Loader, R1: r1, R4: r4, onProgress }) {
    const scene = this.scene;

    // ── Lights (v6 FIX) ──────────────────────────────────────────────────────
    // Sun — warmer + significantly brighter (was 0xb8d4f5 × 2.3)
    const sun = new THREE.DirectionalLight(0xffeedd, 3.5);
    sun.position.set(5, 8, 5);
    scene.add(sun);

    // Ambient fill — bright blue (was 0x334466×0.9 = very dark)
    scene.add(new THREE.AmbientLight(0x7aadc8, 1.6));

    // Cyan rim — brand accent, doubled intensity (was 0.45)
    const rim = new THREE.DirectionalLight(0x90e0ef, 0.9);
    rim.position.set(-5, 2, -8);
    scene.add(rim);

    // Fill light — front-left (NEW: eliminates pitch-black shadow side)
    const fill = new THREE.DirectionalLight(0x4488bb, 0.75);
    fill.position.set(-10, 4, 12);
    scene.add(fill);

    // ── Env map ─────────────────────────────────────────────────────────────
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    new THREE.TextureLoader().load(
      r4 + 'ocean-envmap.jpg',
      tex => {
        scene.environment = pmrem.fromEquirectangular(tex).texture;
        tex.dispose();
        pmrem.dispose();
      }
    );

    // ── Water ───────────────────────────────────────────────────────────────
    this._buildWater(scene);

    // ── Ship ────────────────────────────────────────────────────────────────
    await new Promise(resolve => {
      gltfLoader.load(r4 + 'ship.glb', gltf => {
        const model = gltf.scene;

        // Auto-scale → longest dimension = 5.0 world units
        const box  = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const sf = 5.0 / Math.max(size.x, size.y, size.z, 0.001);
        model.scale.setScalar(sf);

        // Submerge 20%
        const box2   = new THREE.Box3().setFromObject(model);
        const height = box2.max.y - box2.min.y;
        model.position.y = -box2.min.y - height * 0.20;

        this._applyShipMaterials(model);
        this.ship = model;
        scene.add(model);

        this._buildBowWake(model, size.x * sf);
        resolve();
      }, undefined, err => {
        console.warn('[TS] ship.glb:', err);
        resolve();
      });
    });

    // ── Seagulls ─────────────────────────────────────────────────────────────
    await new Promise(resolve => {
      gltfLoader.load(r4 + 'seagull.glb', gltf => {
        const tmpl  = gltf.scene;
        const anims = gltf.animations || [];

        // White fallback material
        tmpl.traverse(m => {
          if (!m.isMesh) return;
          m.material = new THREE.MeshStandardMaterial({
            color    : 0xe8e8e8,
            roughness: 0.8,
            metalness: 0.0,
            side     : THREE.DoubleSide,
          });
        });

        // KTX2 diffuse texture
        if (ktx2Loader) {
          ktx2Loader.load(r4 + 'seagull_diffuse.ktx2', tex => {
            tex.colorSpace = THREE.SRGBColorSpace;
            tmpl.traverse(m => {
              if (m.isMesh) {
                m.material.map = tex;
                m.material.needsUpdate = true;
              }
            });
          });
        }

        // Auto-scale → wingspan 0.45 units
        const sgBox = new THREE.Box3().setFromObject(tmpl);
        const sgSz  = new THREE.Vector3();
        sgBox.getSize(sgSz);
        tmpl.scale.setScalar(0.45 / Math.max(sgSz.x, sgSz.z, 0.001));

        // [relX, relY, relZ, orbitSpeed, phase]
        [
          [  2.0, 2.8,  1.2, 0.28, 0.00 ],
          [ -1.8, 3.2, -0.9, 0.22, 1.80 ],
          [  4.0, 4.0,  0.5, 0.35, 0.95 ],
          [ -3.0, 3.5,  2.0, 0.25, 3.20 ],
        ].forEach(([rx, ry, rz, spd, ph]) => {
          const bird    = tmpl.clone(true);
          bird.userData = { rx, ry, rz, spd, ph };

          if (anims.length > 0) {
            const mx = new THREE.AnimationMixer(bird);
            anims.forEach(c => {
              const a = mx.clipAction(c);
              a.timeScale = 0.7 + Math.random() * 0.6;
              a.play();
            });
            this.mixers.push(mx);
          }

          this.seagulls.push(bird);
          scene.add(bird);
        });

        resolve();
      }, undefined, err => { console.warn('[TS] seagull:', err); resolve(); });
    });

    // ── Buoy ─────────────────────────────────────────────────────────────────
    await new Promise(resolve => {
      gltfLoader.load(r4 + 'buoy.glb', gltf => {
        const buoy = gltf.scene;

        const bBox = new THREE.Box3().setFromObject(buoy);
        const bSz  = new THREE.Vector3();
        bBox.getSize(bSz);
        buoy.scale.setScalar(0.5 / Math.max(bSz.y, 0.001));

        if (ktx2Loader) {
          ktx2Loader.load(r4 + 'bouy_diffuse.ktx2', tex => {
            tex.colorSpace = THREE.SRGBColorSpace;
            buoy.traverse(m => {
              if (m.isMesh && m.material) {
                m.material.map = tex;
                m.material.needsUpdate = true;
              }
            });
          });
        }

        buoy.position.set(12, 0, -2);
        this.buoy = buoy;
        scene.add(buoy);
        resolve();
      }, undefined, err => { console.warn('[TS] buoy:', err); resolve(); });
    });

    // ── Clouds ───────────────────────────────────────────────────────────────
    this._buildClouds(scene);

    this._ready = true;
    console.log('[TS] TimelineScene v6 ready ✓');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Water plane — custom ShaderMaterial (no Water.js dependency)
  // ────────────────────────────────────────────────────────────────────────────
  _buildWater(scene) {
    // v6 FIX: 0x021436 (near-black) → 0x0b3560 (visible dark navy)
    const wCol   = new THREE.Color(0x0b3560);
    // v6 FIX: fog matches new sky color
    const fogCol = new THREE.Color(0x142d45);

    const uniforms = {
      uTime      : { value: 0 },
      uWaterColor: { value: wCol },
      uFogColor  : { value: fogCol },
      uFogDensity: { value: 0.005 },   // v6: slightly less (was 0.006)
      uCamPos    : { value: this.camera.position },
      uNormals   : { value: null },
      uHasNormals: { value: 0 },
    };
    this.waterUniforms = uniforms;

    // Try loading water normals from Three.js CDN
    new THREE.TextureLoader().load(
      'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r175/examples/textures/waternormals.jpg',
      tex => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        uniforms.uNormals.value    = tex;
        uniforms.uHasNormals.value = 1;
      }
    );

    const wMat = new THREE.ShaderMaterial({
      vertexShader  : WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms,
      side          : THREE.FrontSide,
      fog           : false,
    });

    const wGeo = new THREE.PlaneGeometry(400, 400, 64, 64);
    this.waterMesh = new THREE.Mesh(wGeo, wMat);
    this.waterMesh.rotation.x = -Math.PI / 2;
    this.waterMesh.position.y = 0;
    scene.add(this.waterMesh);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // V-shape bow wake (attached as child of ship)
  // ────────────────────────────────────────────────────────────────────────────
  _buildBowWake(shipModel, shipLength) {
    const hw = shipLength * 0.40;
    const bl = shipLength * 0.70;

    const wakeMat = new THREE.MeshBasicMaterial({
      color      : 0xd0e8f5,
      transparent: true,
      opacity    : 0.18,
      side       : THREE.DoubleSide,
      depthWrite : false,
    });

    const geoL = new THREE.BufferGeometry();
    geoL.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
       0,         0.08,  0,
      -hw,        0.08, -bl,
      -hw * 0.3,  0.08, -bl * 0.5,
    ]), 3));
    this.wakeL = new THREE.Mesh(geoL, wakeMat.clone());

    const geoR = new THREE.BufferGeometry();
    geoR.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0,        0.08,  0,
      hw,       0.08, -bl,
      hw * 0.3, 0.08, -bl * 0.5,
    ]), 3));
    this.wakeR = new THREE.Mesh(geoR, wakeMat.clone());

    shipModel.add(this.wakeL);
    shipModel.add(this.wakeR);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Cloud sprites (R1 cloud0/3/6.webp — 404 silently if x1 is dead)
  // ────────────────────────────────────────────────────────────────────────────
  _buildClouds(scene) {
    const loader = new THREE.TextureLoader();
    // [file, x, y, z, scale, drift-speed]
    [
      ['cloud0.webp', -25, 16, -22, 14, 0.012 ],
      ['cloud3.webp',  10, 20, -32, 18, 0.008 ],
      ['cloud6.webp',  35, 14, -18, 11, 0.016 ],
    ].forEach(([file, cx, cy, cz, scale, spd]) => {
      loader.load(R1 + file, tex => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map        : tex,
          transparent: true,
          opacity    : 0.40,
          depthWrite : false,
          fog        : true,
        }));
        sprite.scale.setScalar(scale);
        sprite.position.set(cx, cy, cz);
        sprite.userData.spd    = spd;
        sprite.userData.limitX = 70;
        this.clouds.push(sprite);
        scene.add(sprite);
      });
      // 404 from dead x1 → TextureLoader swallows it silently — no crash
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Ship PBR materials — vertical zone based
  // v6 FIX: hull brightened (0x060e1c near-black → 0x1a3652 visible navy)
  // ────────────────────────────────────────────────────────────────────────────
  _applyShipMaterials(model) {
    const box    = new THREE.Box3().setFromObject(model);
    const totalH = box.max.y - box.min.y;
    const minY   = box.min.y;

    model.traverse(mesh => {
      if (!mesh.isMesh) return;
      const name = (mesh.name || '').toLowerCase();

      // ── Name overrides (priority) ─────────────────────────
      if (name.includes('glass') || name.includes('window')) {
        mesh.material = new THREE.MeshPhysicalMaterial({
          color: 0x5bbfdd, roughness: 0.0, metalness: 0.1,
          transmission: 0.7, transparent: true,
        });
        return;
      }
      if (name.includes('orange') || name.includes('accent') || name.includes('stripe')) {
        mesh.material = new THREE.MeshStandardMaterial({
          color: 0xff7438, roughness: 0.65, metalness: 0.05,
        });
        return;
      }
      if (name.includes('metal') || name.includes('crane') ||
          name.includes('mast')  || name.includes('boom')) {
        mesh.material = new THREE.MeshStandardMaterial({
          color: 0x3a4558, roughness: 0.35, metalness: 0.80,
        });
        return;
      }

      // ── Vertical zone ────────────────────────────────────
      const mBox = new THREE.Box3().setFromObject(mesh);
      const midY = (mBox.min.y + mBox.max.y) * 0.5;
      const relY = totalH > 0 ? (midY - minY) / totalH : 0.5;

      let color, roughness = 0.70, metalness = 0.20;

      if      (relY < 0.10) {
        // Keel: antifoul red — visible (was 0x5c1a10 = very dark)
        color = 0x7a2818; roughness = 0.88; metalness = 0.06;
      } else if (relY < 0.42) {
        // Main hull: dark navy — visible (was 0x060e1c = near-black)
        color = 0x1a3652; roughness = 0.70; metalness = 0.22;
      } else if (relY < 0.65) {
        // Mid body: medium navy (was 0x0c1e38)
        color = 0x2c4f72; roughness = 0.65; metalness = 0.20;
      } else {
        // Superstructure: bright off-white (was 0xdde8ee)
        color = 0xeef4f8; roughness = 0.48; metalness = 0.06;
      }

      mesh.material      = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      mesh.castShadow    = false;
      mesh.receiveShadow = false;
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  addScrollDelta(rawDelta, isTouch) {
    const speed = isTouch ? 0.8 : 0.5;
    this._delta = Math.max(-1.3, Math.min(1.3, rawDelta * speed));
    this._absScroll = Math.max(0, Math.min(100,
      this._absScroll + this._delta * 0.8
    ));
  }  // ────────────────────────────────────────────────────────────────────────────
  // Main per-frame update
  // dt = delta time in seconds (capped at 0.05 by main.js)
  // ────────────────────────────────────────────────────────────────────────────
  update(dt) {
    if (!this._ready) return;

    // ── Advance internal time ─────────────────────────────────────────────────────
    this._time += dt;
    const t = this._time;

    // Drive water shader time
    if (this.waterUniforms) {
      this.waterUniforms.uTime.value = t;
    }

    // ── Scroll smoothing (3-pass, frame-rate-independent lerp) ───────────────
    // k = 1 − e^(-rate*dt) — approaches 1 as dt→∞, 0 as dt→0
    const k1 = 1 - Math.exp(-3.5 * dt);   // smoothAbs     (~fast)
    const k2 = 1 - Math.exp(-1.8 * dt);   // smootherAbs   (~slow)
    const k3 = 1 - Math.exp(-5.0 * dt);   // smoothDelta   (~very fast)

    this.smoothAbs   += (this._absScroll - this.smoothAbs)   * k1;
    this.smootherAbs += (this.smoothAbs  - this.smootherAbs) * k2;
    this.smoothDelta += (this._delta     - this.smoothDelta)  * k3;

    // Decay raw _delta toward 0 each frame
    this._delta *= Math.pow(0.05, dt);   // 0.05^(1/60) ≈ 0.953/frame @60fps

    // ── Camera targets driven by virtual scroll ───────────────────────────
    // smootherAbs: 0→0=scroll back, 50=center, 100=scroll forward
    const frac = (this.smootherAbs - 50) / 50;  // −10 → 0 → +1

    // Pan camera left→right as user scrolls through timeline
    const targetCamX  =  frac * 5.5;
    const targetLookX =  frac * 2.0;
    // Slight vertical drift with scroll
    const targetCamY  =  frac * 0.5;

    const kCam = 1 - Math.exp(-1.2 * dt);  // camera lag
    this.camX  += (targetCamX  - this.camX)  * kCam;
    this.camY  += (targetCamY  - this.camY)  * kCam;
    this.lookX += (targetLookX - this.lookX) * kCam;

    // ── Ship: bob + gentle roll ──────────────────────────────────────────────
    if (this.ship) {
      // Cache base Y on first call (set during init after scale/submerge)
      if (this.ship.userData._baseY === undefined) {
        this.ship.userData._baseY = this.ship.position.y;
      }
      this.ship.position.y =
        this.ship.userData._baseY + Math.sin(t * 0.60) * 0.04;
      this.ship.rotation.z = Math.sin(t * 0.38) * 0.007;  // roll
      this.ship.rotation.x = Math.sin(t * 0.28 + 1.1) * 0.003;  // pitch
    }

    // ── Seagulls: orbit around ship position ───────────────────────────
    const shipX = this.ship?.position.x ?? 0;
    const shipZ = this.ship?.position.z ?? 0;

    this.seagulls.forEach(bird => {
      const { rx, ry, rz, spd, ph } = bird.userData;
      const angle = t * spd + ph;
      bird.position.set(
        shipX + Math.cos(angle) * rx,
        ry + Math.sin(t * 0.55 + ph) * 0.30,
        shipZ + Math.sin(angle) * Math.abs(rz)
      );
      // Face direction of travel
      bird.rotation.y = -angle + Math.PI * 0.5;
    });

    // ── Animation mixers (seagull wing flaps) ───────────────────────────
    this.mixers.forEach(mx => mx.update(dt));

    // ── Cloud drift ────────────────────────────────────────────────────────────
    // (no clouds in x1, these sprites 404 silently — array stays empty)
    this.clouds.forEach(sprite => {
      sprite.position.x += sprite.userData.spd;
      if (sprite.position.x > sprite.userData.limitX) {
        sprite.position.x = -sprite.userData.limitX;
      }
    });

    // ── Buoy: bob + sway ─────────────────────────────────────────────────────
    if (this.buoy) {
      this.buoy.position.y = Math.sin(t * 0.72 + 1.3) * 0.06;
      this.buoy.rotation.z = Math.sin(t * 0.51 + 0.7) * 0.04;
    }

    // ── Bow wake opacity (speed-reactive) ───────────────────────────────
    const spd   = Math.abs(this.smoothDelta);
    const wkOp  = Math.min(0.30, spd * 0.12 + 0.08);
    if (this.wakeL?.material) this.wakeL.material.opacity = wkOp;
    if (this.wakeR?.material) this.wakeR.material.opacity = wkOp;

    // ── Apply camera ────────────────────────────────────────────────────────────
    // Base: (0, 6, 14) + scroll pan X + subtle vertical bob
    this.camera.position.set(
      this.camX,
      6 + this.camY + Math.sin(t * 0.17) * 0.10,
      14
    );
    this.camera.lookAt(this.lookX, 1, 0);
  }

  // ────────────────────────────────────────────────────────────────────────────
  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // ────────────────────────────────────────────────────────────────────────────
  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
// ── END TimelineScene v6 ───────────────────────────────────────────────────────────
