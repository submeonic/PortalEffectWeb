import * as THREE from "three";
import type { Vec3, Rect, Condition } from "../types";
import { frustum } from "../geometry/math";

export const COMPARTMENT_DEPTH_MM = 25.4;

export class Portal {
  renderer: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera();
  scene = new THREE.Scene();
  objects = new THREE.Group();
  room = new THREE.Group();
  bounds: Rect | null = null;
  lastFrustum: ReturnType<typeof frustum> | null = null;
  private sceneName: Condition["scene"] = "cube";
  private dimensions = { width: 0, height: 0 };
  constructor(readonly element: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x8eacd2);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Three-dimensional head-coupled portal",
    );
    element.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xf3f8ff, 0x19365c, 2.7));
    const light = new THREE.DirectionalLight(0xffffff, 3.4);
    light.position.set(-35, 70, 120);
    this.scene.add(light, this.objects, this.room);
  }
  setScene(name: Condition["scene"]) {
    if (this.sceneName === name) return;
    this.sceneName = name;
    this.dimensions.width = 0;
  }
  private clear(group: THREE.Group) {
    group.traverse((o) => {
      if (
        o instanceof THREE.Mesh ||
        o instanceof THREE.Line ||
        o instanceof THREE.LineSegments
      ) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        materials.forEach((m) => m.dispose());
      }
    });
    group.clear();
  }
  private build(width: number, height: number) {
    this.clear(this.objects);
    this.clear(this.room);
    this.dimensions = { width, height };
    const depth = COMPARTMENT_DEPTH_MM;
    const wall = new THREE.MeshStandardMaterial({
      color: 0xbed4ec,
      roughness: 0.92,
      side: THREE.DoubleSide,
    });
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({
        color: 0x527fc6,
        roughness: 0.87,
        side: THREE.DoubleSide,
      }),
    );
    back.position.z = -depth;
    this.room.add(back);
    for (const side of [-1, 1]) {
      const vertical = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, height, depth),
        wall,
      );
      vertical.position.set((side * width) / 2, 0, -depth / 2);
      this.room.add(vertical);
      const horizontal = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.5, depth),
        wall,
      );
      horizontal.position.set(0, (side * height) / 2, -depth / 2);
      this.room.add(horizontal);
    }
    const rodMaterial = new THREE.MeshStandardMaterial({
      color: 0xc2eaff,
      emissive: 0x3f85c0,
      emissiveIntensity: 0.35,
      metalness: 0.35,
      roughness: 0.3,
    });
    for (const x of [-1, 1])
      for (const y of [-1, 1]) {
        const rod = new THREE.Mesh(
          new THREE.CylinderGeometry(0.42, 0.42, depth, 8),
          rodMaterial,
        );
        rod.rotation.x = Math.PI / 2;
        rod.position.set(
          x * (width / 2 - 1.4),
          y * (height / 2 - 1.4),
          -depth / 2,
        );
        this.room.add(rod);
      }
    // Fixed metric object geometry across both windows; only the inferred
    // physical aperture dimensions change with the selected scale model.
    const cubeSize = 12;
    const count = this.sceneName === "cubes" ? 3 : 1;
    for (let n = 0; n < count; n++) {
      const size = n ? cubeSize * 0.45 : cubeSize;
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({
          color: n === 1 ? 0xffc98a : 0x6bdcda,
          roughness: 0.3,
          metalness: 0.22,
          wireframe: this.sceneName === "wireframe",
        }),
      );
      cube.position.set(
        n ? (n === 1 ? -1 : 1) * 16 : 0,
        n ? -8 : 0,
        n ? -depth * 0.55 : 0,
      );
      cube.rotation.set(0.22, 0.55, 0.04);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(cube.geometry),
        new THREE.LineBasicMaterial({
          color: 0xd8ffff,
          transparent: true,
          opacity: 0.85,
        }),
      );
      cube.add(edges);
      this.objects.add(cube);
    }
    if (this.sceneName === "tunnel") {
      for (const z of [-depth * 0.25, -depth * 0.5, -depth * 0.75]) {
        const points = [
          [-width / 2, -height / 2, z],
          [width / 2, -height / 2, z],
          [width / 2, height / 2, z],
          [-width / 2, height / 2, z],
          [-width / 2, -height / 2, z],
        ].map((p) => new THREE.Vector3(...p));
        this.room.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({
              color: 0x8fd6f0,
              transparent: true,
              opacity: 0.5,
            }),
          ),
        );
      }
    }
  }
  render(eye: Vec3, bounds: Rect, condition: Condition) {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.bounds = bounds;
    const physicalWidth = bounds.right - bounds.left;
    const physicalHeight = bounds.top - bounds.bottom;
    if (
      Math.abs(physicalWidth - this.dimensions.width) > 0.1 ||
      Math.abs(physicalHeight - this.dimensions.height) > 0.1
    )
      this.build(physicalWidth, physicalHeight);
    // Scene-local geometry follows the aperture in display space on every frame.
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    this.objects.position.set(centerX, centerY, 0);
    this.room.position.set(centerX, centerY, 0);
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
    this.lastFrustum = frustum(e, bounds, 1, 4000);
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
    /* Position is always derived from the current DOM aperture. */
  }
  get sceneCenter() {
    return { x: this.room.position.x, y: this.room.position.y };
  }
  dispose() {
    this.renderer.dispose();
  }
}
