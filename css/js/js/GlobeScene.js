// js/GlobeScene.js
import * as THREE from 'three';

// ============================================================
// SHADERS
// ============================================================

// Shared vertex — passes UVs, world pos, normal
const VERT = /* glsl */`
varying vec2  vUv;
varying vec3  vNormal;
varying vec3  vWorldPos;
void main() {
  vUv = uv;
  vec4 wp  = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal   = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Earth — PBR-lite with night lights + rim
const EARTH_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tNormal;
uniform sampler2D tRoughness;
uniform vec3  uLightDir;
uniform float uTime;
varying vec2  vUv;
varying vec3  vNormal;
varying vec3  vWorldPos;

void main() {
  vec3  diff  = texture2D(tDiffuse,   vUv).rgb;
  vec3  nm    = texture2D(tNormal,    vUv).xyz * 2.0 - 1.0;
  float rough = texture2D(tRoughness, vUv).r;

  vec3 N = normalize(vNormal + nm * 0.2);
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 H = normalize(L + V);

  float NdotL = max(dot(N, L), 0.0);
  float spec  = pow(max(dot(N, H), 0.0), mix(8.0, 96.0, 1.0 - rough)) * (1.0 - rough) * 0.35;

  // Ambient + diffuse + specular
  vec3 col = diff * 0.06
           + diff * NdotL * 1.25
           + vec3(0.45, 0.6, 1.0) * spec;

  // Night side: city-light warm glow on land (low roughness = water stays dark)
  float nightMask = 1.0 - smoothstep(-0.12, 0.28, NdotL);
  col += vec3(1.0, 0.82, 0.45) * nightMask * (1.0 - rough) * 0.5;

  // Atmosphere rim
  float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.5);
  col += vec3(0.18, 0.52, 0.92) * rim * 0.55;

  gl_FragColor = vec4(col, 1.0);
}`;

// Clouds — alpha from R channel
const CLOUDS_FRAG = /* glsl */`
uniform sampler2D tClouds;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float a = texture2D(tClouds, vUv).r * uOpacity;
  gl_FragColor = vec4(vec3(1.0), a);
}`;

// Atmosphere — Fresnel glow on BackSide
const ATM_VERT = /* glsl */`
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  vNormal  = normalize(normalMatrix * normal);
  vec4 wp  = modelMatrix * vec4(position, 1.0);
  vViewDir = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ATM_FRAG = /* glsl */`
uniform vec3  uColor;
uniform float uPower;
uniform float uOpacity;
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  float f = 1.0 - abs(dot(normalize(vNormal), normalize(vViewDir)));
  f = pow(f, uPower);
  gl_FragColor = vec4(uColor, f * uOpacity);
}`;

// Marker pulse — animated cyan cylinder caps
const MARKER_FRAG = /* glsl */`
uniform float uTime;
uniform float uIndex;
void main() {
  float pulse = sin(uTime * 2.0 + uIndex * 1.3) * 0.5 + 0.5;
  vec3  col   = vec3(0.56, 0.88, 0.94);  // #90e0ef cyan
  gl_FragColor = vec4(col, 0.55 + pulse * 0.45);
}`;

// Background — dark animated ocean gradient + stars (z0 approximation)
const BG_VERT = /* glsl */`void main() { gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const BG_FRAG = /* glsl */`
uniform float uTime;
uniform vec2  uRes;

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
float n21(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),
             mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;

  // Deep-ocean gradient (matches #000d15 design token)
  vec3 top = vec3(0.0,  0.028, 0.062);
  vec3 bot = vec3(0.0,  0.007, 0.018);
  float t  = uv.y + n21(uv * 2.5 + uTime * 0.04) * 0.025;
  vec3 col = mix(bot, top, clamp(t, 0.0, 1.0));

  // Subtle radial blue glow at center
  float cx = length(uv - vec2(0.5, 0.45)) * 1.8;
  col += vec3(0.0, 0.045, 0.12) * (1.0 - clamp(cx, 0.0, 1.0)) * 0.7;

  // Stars
  vec2  sp = floor(gl_FragCoord.xy / 1.3);
  float st = h21(sp);
  if (st > 0.992) {
    float tw = sin(uTime * (1.2 + st * 4.0) + st * 87.3) * 0.5 + 0.5;
    col += vec3(0.65, 0.82, 1.0) * tw * 0.28 * smoothstep(0.992, 1.0, st);
  }

  gl_FragColor = vec4(col, 1.0);
}`;

// ============================================================
// GLOBE SCENE CLASS
// ============================================================
export class GlobeScene {
  constructor(renderer, ktx2, gltf, tex, R4, R1, track) {
    this.renderer = renderer;
    this.ktx2     = ktx2;
    this.gltf     = gltf;
    this.tex      = tex;
    this.R4       = R4;
    this.R1       = R1;
    this.track    = track;

    // Scene + Camera (FOV=22 matches original GlobeScene)
    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(22, innerWidth / innerHeight, 0.1, 100);
    this.camera.position.set(0, 0, 5.2);

    // Globe group (earth + clouds + atmosphere + markers)
    this.globeGroup = new THREE.Group();
    this.scene.add(this.globeGroup);

    // Directional light (#b8cadf, intensity 2.3 — from original GlobeScene)
    this.dirLight = new THREE.DirectionalLight(0xb8cadf, 2.3);
    this.dirLight.position.set(3, 5, 2);
    this.scene.add(this.dirLight);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.12));

    // Mutable material refs for update()
    this.earthMat  = null;
    this.cloudsMat = null;
    this.bgMat     = null;
    this.markers   = [];

    // Rotation state
    this.rotY      = 2.1;   // start with Asia visible
    this.camX      = 0;
    this.camY      = 0;

    // Intro animation state
    this.introT     = 0;
    this.introDone  = false;

    this._buildBackground();
  }

  // ----------------------------------------------------------
  _buildBackground() {
    this.bgMat = new THREE.ShaderMaterial({
      vertexShader:   BG_VERT,
      fragmentShader: BG_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uRes:  { value: new THREE.Vector2(innerWidth, innerHeight) },
      },
      depthWrite: false,
    });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat);
    bg.renderOrder   = -100;
    bg.frustumCulled = false;
    this.scene.add(bg);
  }

  // ----------------------------------------------------------
  async load() {
    // All assets loaded in parallel
    const [
      earthGltf,
      diffuseTex,
      normalTex,
      roughTex,
      cloudTex,
    ] = await Promise.all([
      this.track(this._loadGltf(this.R4 + 'earth.glb')),
      this.track(this._loadKtx2(this.R4 + 'earth_diffuse_grade.ktx2')),
      this.track(this._loadKtx2(this.R4 + 'earth_normal.ktx2')),
      this.track(this._loadKtx2(this.R4 + 'earth_roughness.ktx2')),
      this.track(this._loadKtx2(this.R4 + 'earth_clouds.ktx2')),
    ]);

    // Fix texture settings
    [diffuseTex, normalTex, roughTex, cloudTex].forEach(t => { t.flipY = false; });
    diffuseTex.colorSpace = THREE.SRGBColorSpace;

    this._buildEarth(earthGltf, diffuseTex, normalTex, roughTex);
    this._buildClouds(cloudTex);
    this._buildAtmosphere();
    this._buildMarkers();
  }

  // ----------------------------------------------------------
  _buildEarth(gltf, diffuse, normal, rough) {
    this.earthMat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: EARTH_FRAG,
      uniforms: {
        tDiffuse:   { value: diffuse },
        tNormal:    { value: normal },
        tRoughness: { value: rough },
        uLightDir:  { value: this.dirLight.position.clone().normalize() },
        uTime:      { value: 0 },
      },
    });

    // Apply material to all meshes in the GLB
    gltf.scene.traverse(child => {
      if (child.isMesh) child.material = this.earthMat;
    });
    this.globeGroup.add(gltf.scene);
    this.earthObj = gltf.scene;
  }

  // ----------------------------------------------------------
  _buildClouds(cloudTex) {
    this.cloudsMat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: CLOUDS_FRAG,
      uniforms: {
        tClouds:  { value: cloudTex },
        uOpacity: { value: 0.52 },
      },
      transparent: true,
      depthWrite:  false,
    });
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.004, 64, 64),
      this.cloudsMat
    );
    this.cloudsObj = clouds;
    this.globeGroup.add(clouds);
  }

  // ----------------------------------------------------------
  _buildAtmosphere() {
    // Outer glow — BackSide + Additive + Fresnel
    const atm = new THREE.Mesh(
      new THREE.SphereGeometry(1.14, 64, 32),
      new THREE.ShaderMaterial({
        vertexShader:   ATM_VERT,
        fragmentShader: ATM_FRAG,
        uniforms: {
          uColor:   { value: new THREE.Color(0x90e0ef) },
          uPower:   { value: 4.2 },
          uOpacity: { value: 0.88 },
        },
        transparent: true,
        depthWrite:  false,
        side:        THREE.BackSide,
        blending:    THREE.AdditiveBlending,
      })
    );
    this.globeGroup.add(atm);

    // Inner thin rim (brighter, tighter)
    const rim = new THREE.Mesh(
      new THREE.SphereGeometry(1.02, 64, 32),
      new THREE.ShaderMaterial({
        vertexShader:   ATM_VERT,
        fragmentShader: ATM_FRAG,
        uniforms: {
          uColor:   { value: new THREE.Color(0xc5f0fa) },
          uPower:   { value: 7.0 },
          uOpacity: { value: 0.45 },
        },
        transparent: true,
        depthWrite:  false,
        side:        THREE.BackSide,
        blending:    THREE.AdditiveBlending,
      })
    );
    this.globeGroup.add(rim);
  }

  // ----------------------------------------------------------
  _buildMarkers() {
    // Approximate positions (Asia-Pacific focus, matching original aesthetic)
    // In spherical coords then projected to unit sphere surface
    const markerDefs = [
      { lat:  1.3, lon: 103.8 },  // Singapore
      { lat: 22.3, lon: 114.2 },  // Hong Kong
      { lat: 35.7, lon: 139.7 },  // Tokyo
      { lat: 13.7, lon: 100.5 },  // Bangkok
      { lat: -6.2, lon: 106.8 },  // Jakarta
      { lat: 14.6, lon: 121.0 },  // Manila
    ];

    const toXYZ = (lat, lon) => {
      const phi   = (90 - lat)  * Math.PI / 180;
      const theta = (lon + 180) * Math.PI / 180;
      return new THREE.Vector3(
        -Math.sin(phi) * Math.cos(theta),
         Math.cos(phi),
         Math.sin(phi) * Math.sin(theta)
      );
    };

    markerDefs.forEach(({ lat, lon }, i) => {
      const pos = toXYZ(lat, lon);

      // Slim glowing bar
      const barGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.1, 6);
      const barMat = new THREE.ShaderMaterial({
        vertexShader:   `varying float vY; void main() { vY=position.y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: MARKER_FRAG,
        uniforms: {
          uTime:  { value: 0 },
          uIndex: { value: i },
        },
        transparent: true,
        blending:    THREE.AdditiveBlending,
        depthWrite:  false,
      });
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.copy(pos.clone().multiplyScalar(1.02));
      bar.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), pos.clone().normalize());
      this.globeGroup.add(bar);

      // Pulse ring
      const ringGeo = new THREE.RingGeometry(0.015, 0.02, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x90e0ef, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(pos.clone().multiplyScalar(1.021));
      ring.lookAt(pos.clone().multiplyScalar(2));
      ring.userData.baseOpacity = 0.5;
      ring.userData.index       = i;
      this.globeGroup.add(ring);
      this.markers.push({ bar, barMat, ring, ringMat, i });
    });
  }

  // ----------------------------------------------------------
  update(elapsed, dt, scrollProgress) {
    // Background time
    if (this.bgMat) this.bgMat.uniforms.uTime.value = elapsed;

    // Earth uniforms
    if (this.earthMat) this.earthMat.uniforms.uTime.value = elapsed;

    // Globe rotation (slow auto-spin, matches original ~0.05rad/s)
    this.rotY += dt * 0.048;
    if (this.earthObj)  this.earthObj.rotation.y  = this.rotY;
    if (this.cloudsObj) this.cloudsObj.rotation.y = this.rotY + elapsed * 0.007;

    // Subtle globe tilt drift
    this.globeGroup.rotation.x = Math.sin(elapsed * 0.12) * 0.018;

    // Marker pulse animation
    this.markers.forEach(({ barMat, ring, i }) => {
      barMat.uniforms.uTime.value = elapsed;
      const pulse = Math.sin(elapsed * 1.8 + i * 1.3) * 0.5 + 0.5;
      ring.material.opacity = 0.25 + pulse * 0.45;
      const s = 1 + pulse * 0.3;
      ring.scale.set(s, s, 1);
    });

    // Camera gentle parallax drift
    this.camX += (Math.sin(elapsed * 0.08) * 0.04 - this.camX) * 0.02;
    this.camY += (Math.cos(elapsed * 0.06) * 0.025 - this.camY) * 0.02;
    this.camera.position.x = this.camX;
    this.camera.position.y = this.camY;
    this.camera.lookAt(0, 0, 0);

    // Intro animation: camera zooms from far to position
    if (!this.introDone && this.introT < 1) {
      this.introT = Math.min(this.introT + dt * 0.5, 1);
      const ease = 1 - Math.pow(1 - this.introT, 3);   // cubic ease-out
      this.camera.position.z = 14 - (14 - 5.2) * ease;
      if (this.introT >= 1) this.introDone = true;
    }
  }

  // ----------------------------------------------------------
  render() {
    // autoClear=true (default): Three.js clears before each render
    // Background mesh (renderOrder=-100) renders first automatically
    this.renderer.render(this.scene, this.camera);
  }

  // ----------------------------------------------------------
  playIntro() {
    this.introT = 0;
    this.introDone = false;
    this.camera.position.z = 14;   // start far
  }

  onResize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.bgMat) this.bgMat.uniforms.uRes.value.set(w, h);
  }

  // ----------------------------------------------------------
  // Transition: Globe zooms to fill screen (scale to infinity = Timeline reveal)
  zoomOut(onComplete) {
    const start = performance.now();
    const dur   = 1400;
    const tick  = () => {
      const t    = Math.min((performance.now() - start) / dur, 1);
      const ease = t * t * (3 - 2 * t);   // smoothstep
      this.camera.position.z = 5.2 - 5.2 * ease;   // zoom into globe
      this.camera.fov = 22 + 30 * ease;              // widen FOV → zoom feel
      this.camera.updateProjectionMatrix();
      if (t < 1) requestAnimationFrame(tick);
      else if (onComplete) onComplete();
    };
    tick();
  }

  // ----------------------------------------------------------
  _loadGltf(url) {
    return new Promise((res, rej) => this.gltf.load(url, res, null, rej));
  }
  _loadKtx2(url) {
    return new Promise((res, rej) => this.ktx2.load(url, res, null, rej));
  }
}
