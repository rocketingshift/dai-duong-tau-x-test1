// js/Water.js — Animated stylized ocean surface
import * as THREE from 'three';

export class Water {
  constructor() {
    this._time   = 0;
    this._geo    = null;
    this._mat    = null;
    this._orig   = null;
    this.mesh    = null;
  }

  build() {
    // Dense grid for smooth waves
    const W = 100, D = 100, SEGS = 100;
    this._geo = new THREE.PlaneGeometry(W, D, SEGS, SEGS);
    this._geo.rotateX(-Math.PI / 2);

    // Save original flat positions for wave math
    this._orig = new Float32Array(this._geo.attributes.position.array);

    this._mat = new THREE.MeshStandardMaterial({
      color:            new THREE.Color(0x193653),
      roughness:        0.08,
      metalness:        0.35,
      envMapIntensity:  0.9,
    });

    this.mesh = new THREE.Mesh(this._geo, this._mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'ocean';
    return this.mesh;
  }

  setEnvMap(map) {
    if (this._mat) {
      this._mat.envMap = map;
      this._mat.needsUpdate = true;
    }
  }

  update(dt) {
    this._time += dt;
    if (!this._geo) return;

    const pos  = this._geo.attributes.position.array;
    const orig = this._orig;
    const t    = this._time;

    for (let i = 0; i < pos.length; i += 3) {
      const x = orig[i], z = orig[i + 2];
      pos[i + 1] =
        Math.sin(x * 0.45 + t * 1.10) * 0.14 +
        Math.sin(z * 0.38 + t * 0.85) * 0.11 +
        Math.sin((x + z) * 0.28 + t * 1.40) * 0.07 +
        Math.sin(x * 0.15 - t * 0.60) * 0.05;
    }

    this._geo.attributes.position.needsUpdate = true;
    this._geo.computeVertexNormals();
  }

  dispose() {
    this._geo?.dispose();
    this._mat?.dispose();
  }
}
