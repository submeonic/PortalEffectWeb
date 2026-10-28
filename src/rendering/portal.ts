import * as THREE from "three";
import type { Vec3, Rect, Condition } from "../types";
import { frustum } from "../geometry/math";
export class Portal {
  renderer: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera();
  scene = new THREE.Scene();
  objects = new THREE.Group();
  room = new THREE.Group();
  bounds: Rect | null = null;
  lastFrustum: ReturnType<typeof frustum> | null = null;
  private sceneName = "";
  private initialized = false;
  constructor(readonly element: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x111d25);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Three-dimensional head-coupled portal",
    );
    element.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xb6e5ff, 0x233746, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(-70, 100, 150);
    this.scene.add(light, this.objects, this.room);
    this.setScene("cube");
  }
  setScene(name: Condition["scene"]) {
    if (this.sceneName === name) return;
    this.sceneName = name;
    for (const group of [this.objects, this.room]) {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          const materials = Array.isArray(o.material)
            ? o.material
            : [o.material];
          materials.forEach((m) => m.dispose());
        }
      });
      group.clear();
    }
    const count = name === "cubes" ? 3 : 1;
    for (let n = 0; n < count; n++) {
      const size = n ? 10 : 19;
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({
          color: n === 1 ? 0xffc785 : 0x78d9cd,
          roughness: 0.25,
          metalness: 0.28,
          wireframe: name === "wireframe",
        }),
      );
      cube.position.set(
        n ? (n === 1 ? -1 : 1) * 22 : 0,
        n ? -8 : 0,
        -38 - n * 25,
      );
      cube.rotation.set(0.22, 0.55, 0.04);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(cube.geometry),
        new THREE.LineBasicMaterial({
          color: 0xc6fff4,
          transparent: true,
          opacity: 0.65,
        }),
      );
      cube.add(edges);
      this.objects.add(cube);
    }
    const grid = new THREE.GridHelper(280, 28, 0x4a8e95, 0x28424e);
    grid.position.set(0, -25, -110);
    this.room.add(grid);
    for (let z = -10; z >= -180; z -= 25) {
      const points = [
        [-50, -25, z],
        [50, -25, z],
        [50, 45, z],
        [-50, 45, z],
        [-50, -25, z],
      ].map((p) => new THREE.Vector3(...p));
      this.room.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({
            color: 0x345463,
            transparent: true,
            opacity: name === "tunnel" ? 0.8 : 0.35,
          }),
        ),
      );
    }
    this.initialized = false;
  }
  render(eye: Vec3, bounds: Rect, condition: Condition) {
    const r = this.element.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.bounds = bounds;
    if (!this.initialized) {
      const x = (bounds.left + bounds.right) / 2,
        y = (bounds.top + bounds.bottom) / 2;
      this.objects.position.set(x, y, 0);
      this.room.position.set(x, y, 0);
      this.initialized = true;
    }
    const width = Math.round(r.width),
      height = Math.round(r.height);
    if (
      this.renderer.domElement.width !==
        Math.round(width * this.renderer.getPixelRatio()) ||
      this.renderer.domElement.height !==
        Math.round(height * this.renderer.getPixelRatio())
    )
      this.renderer.setSize(width, height, false);
    const e = condition.rendering === "coupled" ? eye : { x: 0, y: 0, z: 400 };
    this.lastFrustum = frustum(e, bounds, Math.max(1, e.z - 0.1), 4000);
    const f = this.lastFrustum;
    this.camera.position.set(e.x, e.y, e.z);
    this.camera.quaternion.identity();
    this.camera.projectionMatrix.makePerspective(
      f.left,
      f.right,
      f.top,
      f.bottom,
      f.near,
      f.far,
    );
    this.camera.projectionMatrixInverse
      .copy(this.camera.projectionMatrix)
      .invert();
    this.objects.rotation.set(
      condition.rendering === "naive" ? eye.y / 300 : 0,
      condition.rendering === "naive" ? eye.x / 300 : 0,
      0,
    );
    this.renderer.render(this.scene, this.camera);
  }
  recenter() {
    this.initialized = false;
  }
  dispose() {
    this.renderer.dispose();
  }
}
