// js/TimelineScene.js — v5
// Complete rewrite:
//   - Reliable water: MeshPhysicalMaterial + animated normalMap (no Water.js)
//   - Ship: auto-scale 5 units, submerged 20%, proper dark navy + white materials
//   - Bow wake: V-shape foam mesh, speed-reactive opacity
//   - Moving clouds: 3 sprites from R1 drifting across sky
//   - 4 seagulls orbiting ship
//   - Camera: y=6, z=14 — cinematic side view (NOT top-down)
//   - Fog: 0.006 — clearer horizon

import * as THREE from 'three';

const R1 = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x-1@main/';
const R4 = 'https://cdn.jsdelivr.net/gh/rocketingshift/dai-duong-tau-x4@main/';

// ── Inline water vertex shader ─────────────────────────────────────────────
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

// ── Inline water fragment shader ───────────────────────────────────────────
const WATER_FRAG = /* glsl */`
  precision highp float;
  uniform float     uTime;
  uniform vec3      uWaterColor;   // 0x021436
  uniform vec3      uFogColor;     // scene background
  uniform float     uFogDensity;
  uniform vec3      uCamPos;
  uniform sampler2D uNormals;      // waternormals.jpg (if loaded)
  uniform float     uHasNormals;   // 0 or 1
  varying vec2  vUv;
  varying vec3  vWorldPos;

  void main() {
    // Procedural animated normal (2 overlapping waves)
    vec2 uv1 = vUv * 6.0  + vec2( uTime * 0.018, uTime * 0.012);
    vec2 uv2 = vUv * 11.0 + vec2(-uTime * 0.013, uTime * 0.021);
    float h1 = sin(uv1.x * 6.283) * cos(uv1.y * 6.283);
    float h2 = sin(uv2.x * 5.132) * cos(uv2.y * 4.189);

    // Blend with texture normals if available
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
    float vDotN   = max(dot(viewDir, vec3(0.0,1.0,0.0)), 0.0);
    float fresnel = pow(1.0 - vDotN, 3.5) * 0.65;

    // Specular (sun at 5,8,5)
    vec3  sunDir  = normalize(vec3(5.0, 8.0, 5.0));
    vec3  halfV   = normalize(sunDir + viewDir);
    float spec    = pow(max(dot(nn, halfV), 0.0), 128.0);

    // Base color
    vec3 color = uWaterColor;
    // Rim highlight near horizon via fresnel
    color = mix(color, vec3(0.05, 0.18, 0.38), fresnel * 0.55);
    // Specular shimmer
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

    // ── Scene ──────────────────────────────────────────────
    this.scene = new THREE.Scene();
    // Sky color: deep blue-black, slightly lighter than water
    this.scene.background = new THREE.Color(0x0a1e30);
    this.scene.fog = new THREE.FogExp2(0x0a1e30, 0.006);

    // ── Camera — cinematic side/low angle ──────────────────
    // y=6, z=14 → ~20° from horizontal → ocean + sky both visible
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      800
    );
    this.camera.position.set(0, 6, 14);
    this.camera.lookAt(0, 1, 0);

    // ── Scroll state ───────────────────────────────────────
    this._delta      = 0;
    this._absScroll  = 50;
    this.smoothAbs   = 50;
    this.smootherAbs = 50;
    this.smoothDelta = 0;
    this.camX        = 0;
    this.camY        = 0;
    this.lookX       = 0;

    // ── Objects ────────────────────────────────────────────
    this.ship          = null;
    this.seagulls      = [];
    this.buoy          = null;
    this.waterMesh     = null;
    this.waterUniforms = null;
    this.wakeL         = null;   // left wake plane
    this.wakeR         = null;   // right wake plane
    this.clouds        = [];
    this.mixers        = [];
    this._ready        = false;
  }

  // ──────────────────────────────────────────────────────────
  async init({ gltfLoader, ktx2Loader, R1: r1, R4: r4, onProgress }) {
    const scene = this.scene;

    // ── Lights ─────────────────────────────────────────────
    const sun = new THREE.DirectionalLight(0xb8d4f5, 2.3);
    sun.position.set(5, 8, 5);
    scene.add(sun);

    // Ambient: dark blue fill (moody ocean feel)
    scene.add(new THREE.AmbientLight(0x334466, 0.9));

    // Cyan rim (brand accent from design tokens)
    const rim = new THREE.DirectionalLight(0x90e0ef, 0.45);
    rim.position.set(-5, 2, -8);
    scene.add(rim);

    // ── Env map (used by ship/buoy PBR materials) ──────────
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

    // ── Water (custom ShaderMaterial — no Water.js) ────────
    this._buildWater(scene);

    // ── Ship ───────────────────────────────────────────────
    await new Promise(resolve => {
      gltfLoader.load(r4 + 'ship.glb', gltf => {
        const model = gltf.scene;

        // Auto-scale → longest dimension = 5.0 world units
        const box  = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const sf = 5.0 / Math.max(size.x, size.y, size.z, 0.001);
        model.scale.setScalar(sf);

        // Place hull: bottom at y=0, submerge 20% into water
        const box2 = new THREE.Box3().setFromObject(model);
        const height = box2.max.y - box2.min.y;
        model.position.y = -box2.min.y - height * 0.20;

        // Apply ship materials
        this._applyShipMaterials(model);

        this.ship = model;
        scene.add(model);

        // Bow wake (V-shape foam) — child of ship
        this._buildBowWake(model, size.x * sf);

        resolve();
      }, undefined, err => {
        console.warn('[TS] ship.glb:', err);
        resolve();
      });
    });

    // ── Seagulls — 4 birds ────────────────────────────────
    await new Promise(resolve => {
      gltfLoader.load(r4 + 'seagull.glb', gltf => {
        const tmpl  = gltf.scene;
        const anims = gltf.animations || [];

        // White fallback
        tmpl.traverse(m => {
          if (!m.isMesh) return;
          m.material = new THREE.MeshStandardMaterial({
            color    : 0xe8e8e8,
            roughness: 0.8,
            metalness: 0.0,
            side     : THREE.DoubleSide,
          });
        });

        // Try KTX2 diffuse
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

        // 4 configs: [relX, relY, relZ, orbitSpeed, phase]
        [
          [  2.0, 2.8,  1.2,  0.28, 0.00 ],
          [ -1.8, 3.2, -0.9,  0.22, 1.80 ],
          [  4.0, 4.0,  0.5,  0.35, 0.95 ],
          [ -3.0, 3.5,  2.0,  0.25, 3.20 ],
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

    // ── Buoy ──────────────────────────────────────────────
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

    // ── Moving clouds (sky animation) ─────────────────────
    this._buildClouds(scene);

    this._ready = true;
  }

  // ──────────────────────────────────────────────────────────
  // Build custom water (inline shader, no external dependency)
  // ──────────────────────────────────────────────────────────
  _buildWater(scene) {
    // Water color: design token deep navy #021436
    const wCol  = new THREE.Color(0x021436);
    const fogCol = new THREE.Color(0x0a1e30);

    const uniforms = {
      uTime      : { value: 0 },
      uWaterColor: { value: wCol },
      uFogColor  : { value: fogCol },
      uFogDensity: { value: 0.006 },
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
      fog           : false,  // handled in shader
    });

    const wGeo  = new THREE.PlaneGeometry(400, 400, 64, 64);
    this.waterMesh = new THREE.Mesh(wGeo, wMat);
    this.waterMesh.rotation.x = -Math.PI / 2;
    this.waterMesh.position.y = 0;
    scene.add(this.waterMesh);
  }

  // ──────────────────────────────────────────────────────────
  // V-shape bow wake (child of ship → moves with ship)
  // ──────────────────────────────────────────────────────────
  _buildBowWake(shipModel, shipLength) {
    const hw = shipLength * 0.40;  // half-width of wake spread
    const bl = shipLength * 0.70;  // length of wake behind bow

    const wakeMat = new THREE.MeshBasicMaterial({
      color      : 0xd0e8f5,
      transparent: true,
      opacity    : 0.18,
      side       : THREE.DoubleSide,
      depthWrite : false,
    });

    // Left wake arm
    const geoL = new THREE.BufferGeometry();
    geoL.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
       0,  0.08, 0,
      -hw, 0.08, -bl,
      -hw * 0.3, 0.08, -bl * 0.5,
    ]), 3));
    this.wakeL = new THREE.Mesh(geoL, wakeMat.clone());

    // Right wake arm
    const geoR = new THREE.BufferGeometry();
    geoR.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0,   0.08, 0,
      hw,  0.08, -bl,
      hw * 0.3, 0.08, -bl * 0.5,
    ]), 3));
    this.wakeR = new THREE.Mesh(geoR, wakeMat.clone());

    shipModel.add(this.wakeL);
    shipModel.add(this.wakeR);
  }

  // ──────────────────────────────────────────────────────────
  // 3 cloud sprites that slowly drift across sky
  // ──────────────────────────────────────────────────────────
  _buildClouds(scene) {
    const loader = new THREE.TextureLoader();
    // [file, x, y, z, scale, drift speed]
    const cfgs = [
      ['cloud0.webp', -25, 16, -22, 14, 0.012 ],
      ['cloud3.webp',  10, 20, -32, 18, 0.008 ],
      ['cloud6.webp',  35, 14, -18, 11, 0.016 ],
    ];
    cfgs.forEach(([file, cx, cy, cz, scale, spd]) => {
      loader.load(R1 + file, tex => {
        const mat = new THREE.SpriteMaterial({
          map       : tex,
          transparent: true,
          opacity   : 0.40,
          depthWrite: false,
          fog       : true,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.setScalar(scale);
        sprite.position.set(cx, cy, cz);
        sprite.userData.spd    = spd;
        sprite.userData.limitX = 70;
        this.clouds.push(sprite);
        scene.add(sprite);
      });
    });
  }

  // ──────────────────────────────────────────────────────────
  // Apply PBR materials based on vertical position
  // OceanX vessel: dark navy hull + anti-foul keel + white superstructure
  // ──────────────────────────────────────────────────────────
  _applyShipMaterials(model) {
    const box    = new THREE.Box3().setFromObject(model);
    const totalH = box.max.y - box.min.y;
    const minY   = box.min.y;

    model.traverse(mesh => {
      if (!mesh.isMesh) return;

      const name = (mesh.name || '').toLowerCase();

      // ── Name overrides (highest priority) ──
      if (name.includes('glass') || name.includes('window')) {
        mesh.material = new THREE.MeshPhysicalMaterial({
          color : 0x5bbfdd, roughness: 0.0, metalness: 0.1,
          transmission: 0.7, transparent: true,
        });
        return;
      }
      if (name.includes('orange') || name.includes('accent') || name.includes('stripe')) {
        mesh.material = new THREE.MeshStandardMaterial({ color: 0xff7438, roughness: 0.65, metalness: 0.05 });
        return;
      }
      if (name.includes('metal') || name.includes('crane') || name.includes('mast') || name.includes('boom')) {
        mesh.material = new THREE.MeshStandardMaterial({ color: 0x3a4558, roughness: 0.35, metalness: 0.80 });
        return;
      }

      // ── Vertical zone ──
      const mBox = new THREE.Box3().setFromObject(mesh);
      const midY = (mBox.min.y + mBox.max.y) * 0.5;
      const relY = totalH > 0 ? (midY - minY) / totalH : 0.5;

      let color, roughness = 0.72, metalness = 0.18;

      if      (relY < 0.10) { color = 0x5c1a10; roughness = 0.90; metalness = 0.05; } // keel: antifoul red-brown
      else if (relY < 0.42) { color = 0x060e1c; roughness = 0.72; metalness = 0.22; } // main hull: near-black navy
      else if (relY < 0.65) { color = 0x0c1e38; roughness = 0.68; metalness = 0.20; } // mid body: dark navy
      else                  { color = 0xdde8ee; roughness = 0.52; metalness = 0.08; } // superstructure: off-white

      mesh.material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      mesh.castShadow    = false;
      mesh.receiveShadow = false;
    });
  }

  // ──────────────────────────────────────────────────────────
  addScrollDelta(rawDelta, isTouch) {
    const speed = isTouch ? 0.8 : 0.5;
    this._delta = Math.max(-1.3, Math.min(1.3, rawDelta * speed));
    this._absScroll = Math.max(0, Math.min(100,
      this._absScroll + this._delta * 0.8
    ));
  }

  // ──────────────────────────────────────────────────────────
  update(dt, localFrac, phase) {
    if (!this._ready) return;

    const nD = Math.min(dt * 60, 3);
    const t  = performance.now() * 0.001;

    // ── Smooth scroll chain ───────────────────────────────
    this.smoothAbs   += (this._absScroll  - this.smoothAbs)   * 0.10 * nD;
    this.smootherAbs += (this.smoothAbs   - this.smootherAbs) * 0.10 * nD;
    this.smoothDelta += (this._delta      - this.smoothDelta)  * 0.03 * nD;
    this.camX        += (this.smoothDelta - this.camX)         * 0.06 * nD;
    this.camY        += (this.smoothDelta - this.camX)         * 0.10 * nD;
    this.lookX       += (this.smoothDelta - this.lookX)        * 0.07 * nD;
    this._delta      *= 0.88;

    const shipX  = (this.smootherAbs - 50) * 0.8;
    const shipSpd = Math.abs(this.smoothDelta);

    // ── Ship: X journey + yaw + gentle bob ────────────────
    if (this.ship) {
      this.ship.position.x = shipX;
      this.ship.rotation.y = -this.smoothDelta * 0.12;
      // Subtle heaving (ocean swell)
      this.ship.position.y += (Math.sin(t * 0.28) * 0.06 - this.ship.position.y) * 0.02 * nD;
    }

    // ── Bow wake opacity scales with ship speed ───────────
    const wakeOpacity = Math.min(0.35, 0.08 + shipSpd * 0.27);
    if (this.wakeL) this.wakeL.material.opacity = wakeOpacity;
    if (this.wakeR) this.wakeR.material.opacity = wakeOpacity;

    // ── Water shader time ─────────────────────────────────
    if (this.waterUniforms) {
      this.waterUniforms.uTime.value += dt;
      // Camera position passes to shader for Fresnel calc
      this.waterUniforms.uCamPos.value.copy(this.camera.position);
    }

    // ── Seagulls: lazy orbit around ship ─────────────────
    this.seagulls.forEach(bird => {
      const { rx, ry, rz, spd, ph } = bird.userData;
      const ang = t * spd + ph;
      bird.position.set(
        shipX + rx + Math.sin(ang * 1.7) * 1.5,
        ry    + Math.sin(t * spd * 1.3 + ph) * 0.3,
        rz    + Math.cos(ang) * 1.1
      );
      // Face direction of travel
      const dx = Math.cos(ang * 1.7 + 0.1) - Math.cos(ang * 1.7 - 0.1);
      const dz = -(Math.sin(ang + 0.05) - Math.sin(ang - 0.05));
      bird.rotation.y = Math.atan2(dx, dz);
    });

    // ── Buoy: follow ship, gentle bob ────────────────────
    if (this.buoy) {
      this.buoy.position.x = shipX + 12;
      this.buoy.position.y = Math.sin(t * 0.65) * 0.10;
    }

    // ── Clouds: drift rightward, wrap ────────────────────
    this.clouds.forEach(c => {
      c.position.x += c.userData.spd;
      if (c.position.x > c.userData.limitX) c.position.x = -c.userData.limitX;
    });

    // ── Mixers (seagull wing flap) ────────────────────────
    this.mixers.forEach(m => m.update(dt));

    // ── Camera: cinematic side view ───────────────────────
    // y=6, z=14 → ~22° angle → ocean fills lower half, sky upper half
    this.camera.position.set(
      shipX + this.camX * 0.5,
      6 + this.camY * 0.2,
      14
    );
    this.camera.lookAt(
      shipX + this.lookX * 0.5,
      1,   // look at near sea level
      0
    );
  }

  // ──────────────────────────────────────────────────────────
  render() {
    if (!this._ready) return;
    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
