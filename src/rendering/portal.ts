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
  readonly lighting = new THREE.Group();
  cubeSizeMm = 22;
  cubeOffsetMm = 0;
  private sceneName: Condition["scene"] = "cube";
  private dimensions = { width: 0, height: 0 };
  constructor(readonly element: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x364b72);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Three-dimensional head-coupled portal",
    );
    element.append(this.renderer.domElement);
    this.scene.add(new THREE.AmbientLight(0xe2eaff, 0.55));
    this.scene.add(this.objects, this.room, this.lighting);
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
    this.lighting.traverse((o) => {
      if (o instanceof THREE.PointLight) o.dispose();
    });
    this.lighting.clear();
    this.dimensions = { width, height };
    const depth = COMPARTMENT_DEPTH_MM;
    const wall = new THREE.MeshStandardMaterial({
      color: 0x9aafd0,
      roughness: 0.92,
      side: THREE.DoubleSide,
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wall);
    back.name = "back-wall";
    back.receiveShadow = true;
    back.position.z = -depth;
    this.room.add(back);
    for (const side of [-1, 1]) {
      const vertical = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, height, depth),
        wall,
      );
      vertical.position.set((side * width) / 2, 0, -depth / 2);
      vertical.receiveShadow = true;
      this.room.add(vertical);
      const horizontal = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.5, depth),
        wall,
      );
      horizontal.position.set(0, (side * height) / 2, -depth / 2);
      horizontal.receiveShadow = true;
      this.room.add(horizontal);
    }
    // Square-section depth columns; the same material on all compartment surfaces.
    const column = (x: number, y: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, depth), wall);
      mesh.name = "depth-column";
      mesh.position.set(x, y, -depth / 2);
      mesh.castShadow = mesh.receiveShadow = true;
      this.room.add(mesh);
    };
    for (const f of [-0.35, 0, 0.35]) {
      column(width * f, height / 2 - 2.5);
      column(width * f, -height / 2 + 2.5);
    }
    for (const f of [-0.25, 0.25]) {
      column(width / 2 - 2.5, height * f);
      column(-width / 2 + 2.5, height * f);
    }
    // Positions/range are in mm, like the geometry. Inverse-square attenuation
    // makes the front of the tray bright and the parallel rear wall recede.
    for (const side of [-1, 1]) {
      for (const f of [-0.28, 0.28]) {
        const light = new THREE.PointLight(0xe7f0ff, 680, 65, 2);
        light.position.set(width * f, side * (height / 2 - 4), 7);
        this.lighting.add(light);
      }
    }
    const key = new THREE.PointLight(0xffeee0, 1700, 160, 2);
    key.position.set(-18, 24, 42);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 180;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.15;
    this.lighting.add(key);
    // Physical screen-plane witness marks stay at z=0, visibly occluded by the
    // front half of the cube. These are geometry, never a CSS depth illusion.
    const half = this.cubeSizeMm * 0.8;
    const points = [
      new THREE.Vector3(-width / 2, 0, 0),
      new THREE.Vector3(width / 2, 0, 0),
      new THREE.Vector3(0, -height / 2, 0),
      new THREE.Vector3(0, height / 2, 0),
    ];
    const witness = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({
        color: 0xe1e8f5,
        dashSize: 1.2,
        gapSize: 1.2,
        transparent: true,
        opacity: 0.5,
      }),
    );
    witness.computeLineDistances();
    this.room.add(witness);
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-half, -half, 0),
        new THREE.Vector3(half, -half, 0),
        new THREE.Vector3(half, half, 0),
        new THREE.Vector3(-half, half, 0),
      ]),
      new THREE.LineBasicMaterial({
        color: 0xe5efff,
        transparent: true,
        opacity: 0.65,
      }),
    );
    this.room.add(ring);
    // Fixed metric object geometry across both windows; only the inferred
    // physical aperture dimensions change with the selected scale model.
    const cubeSize = this.cubeSizeMm;
    const count = this.sceneName === "cubes" ? 3 : 1;
    for (let n = 0; n < count; n++) {
      const size = n ? cubeSize * 0.45 : cubeSize;
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({
          color: n === 1 ? 0xfac57f : 0x8ee7d4,
          roughness: 0.38,
          metalness: 0.08,
          wireframe: this.sceneName === "wireframe",
        }),
      );
      cube.position.set(
        n ? (n === 1 ? -1 : 1) * 16 : 0,
        n ? -8 : 0,
        n ? -depth * 0.55 : 0,
      );
      cube.rotation.set(0.22, 0.55, 0.04);
      cube.castShadow = cube.receiveShadow = true;
      cube.name = n ? "depth-cube" : "protruding-cube";
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
    this.objects.position.set(centerX, centerY, this.cubeOffsetMm);
    this.lighting.position.set(centerX, centerY, 0);
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
  setCube(sizeMm: number, offsetMm = this.cubeOffsetMm) {
    if (sizeMm !== this.cubeSizeMm) {
      this.cubeSizeMm = sizeMm;
      this.dimensions.width = 0;
    }
    this.cubeOffsetMm = offsetMm;
  }
  recenter() {
    /* Position is always derived from the current DOM aperture. */
  }
  get sceneCenter() {
    return { x: this.room.position.x, y: this.room.position.y };
  }
  dispose() {
    this.clear(this.room);
    this.clear(this.objects);
    this.lighting.traverse((o) => {
      if (o instanceof THREE.PointLight) o.dispose();
    });
    this.renderer.dispose();
  }
}
