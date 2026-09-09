import * as THREE from 'three';
import type { FlyPose, GameSnapshot } from '../shared/types';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../shared/types';
import { paddleTransform, SwatVisualState } from './SwatVisualState';
import { CatchVisualState } from './CatchVisualState';
import { SplatEffect } from './SplatEffect';
import { palette } from '../theme/palette';

function roundedRectangle(width: number, height: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function rod(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.78, 1, 6), material);
  placeRod(mesh, start, end);
  mesh.castShadow = true;
  return mesh;
}

const UP = new THREE.Vector3(0, 1, 0);
const direction = new THREE.Vector3();
function placeRod(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
  direction.subVectors(end, start);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.scale.y = direction.length();
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
}

export const FLY_THORAX_CENTER = new THREE.Vector3(8, 25, 0);
const FLOOR_Y = -WORLD_HEIGHT / 2 - 85;

/** Visual size only: the thorax pivot and the game's forgiving hit circle stay fixed. */
export function flyDisplayScale(width: number): number {
  return 0.88 * (0.8 + 0.55 * THREE.MathUtils.clamp((560 - width) / 210, 0, 1));
}

/** Shared side-view contract: decorative depth never changes the aiming point. */
export function configureAimCamera(
  camera: THREE.OrthographicCamera,
  width: number,
  height: number,
): void {
  const aspect = width / height;
  const viewHeight = Math.max(860, 1140 / aspect);
  camera.up.set(0, 1, 0);
  camera.position.set(0, 0, 1600);
  camera.lookAt(0, 0, 0);
  camera.left = (-viewHeight * aspect) / 2;
  camera.right = (viewHeight * aspect) / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

export function sideFlightOrientation(
  fly: Pick<FlyPose, 'heading' | 'speed' | 'vx' | 'vy'>,
  previousFacing: 1 | -1,
): { facing: 1 | -1; pitch: number } {
  const vx = fly.vx ?? Math.cos(fly.heading) * fly.speed;
  const vy = fly.vy ?? Math.sin(fly.heading) * fly.speed;
  // Hysteresis avoids frantic left/right flipping in a nearly vertical climb.
  const facing = vx > 35 ? 1 : vx < -35 ? -1 : previousFacing;
  return { facing, pitch: THREE.MathUtils.clamp(Math.atan2(-vy, Math.abs(vx) + 90), -0.55, 0.55) };
}

interface Leg {
  side: number;
  index: number;
  upper: THREE.Mesh;
  lower: THREE.Mesh;
  foot: THREE.Mesh;
}

/** Renders the body supplied by the simulation. No movement decisions live here. */
export class ArenaRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-660, 660, 430, -430, 1, 4000);
  private readonly fly = new THREE.Group();
  private readonly splat = new SplatEffect();
  private readonly bodyPivot = new THREE.Group();
  private readonly anatomy = new THREE.Group();
  private readonly wings: THREE.Group[] = [];
  private readonly wingBlurs: THREE.Group[] = [];
  private readonly antennae: THREE.Group[] = [];
  private readonly legs: Leg[] = [];
  private readonly swatter = new THREE.Group();
  private readonly target = new THREE.Group();
  private readonly targetRing: THREE.Mesh;
  private readonly strikeMarker = new THREE.Group();
  private readonly strikeProgress: THREE.Mesh;
  private readonly strikeMaterial: THREE.MeshBasicMaterial;
  private readonly impactRipple: THREE.Mesh;
  private readonly impactFlash: THREE.Mesh;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly intersection = new THREE.Vector3();
  private readonly aimPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private readonly trailPositions = new Float32Array(96 * 3);
  private readonly trail: THREE.Points;
  private readonly flightShadow: THREE.Mesh;
  private readonly start = new THREE.Vector3();
  private readonly knee = new THREE.Vector3();
  private readonly foot = new THREE.Vector3();
  private snapshot: GameSnapshot | null = null;
  private clock = 0;
  private animationSimTime = 0;
  private displayX = WORLD_WIDTH / 2;
  private displayY = WORLD_HEIGHT / 2;
  private facing: 1 | -1 = 1;
  private poseInitialized = false;
  private lastMode: GameSnapshot['mode'] = 'ready';
  private readonly swatVisual = new SwatVisualState();
  private readonly catchVisual = new CatchVisualState();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private trailCount = 0;
  private trailX = 500;
  private trailY = 325;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    // Cap raster resolution, not the simulation: both live views stay smooth on
    // Retina screens while every selected neuron and connection is still run.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(palette.scene);
    // An explicit altitude-dependent soft shadow makes flight legible without a
    // second dynamic scene pass for every eye, wing, leg and stage mesh.
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;

    // The game x/y plane is viewed straight on. Depth is decorative only.
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(0, 0, 1600);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.AmbientLight(0xfffbee, 1.2));
    const sun = new THREE.DirectionalLight(0xfff9e9, 2.7);
    sun.position.set(-360, 720, 300);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xd9cef7, 0.8);
    fill.position.set(300, 250, -300);
    this.scene.add(fill);

    this.buildStage();
    this.buildFly();
    this.scene.add(this.splat.group);
    this.buildSwatter();
    const shadowGeometry = new THREE.PlaneGeometry(1, 1);
    this.flightShadow = new THREE.Mesh(
      shadowGeometry,
      new THREE.ShaderMaterial({
        uniforms: { opacity: { value: 0.2 } },
        vertexShader: `varying vec2 vUv; void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform float opacity; void main() { float r=length((vUv-.5)*2.0); gl_FragColor=vec4(.10,.18,.12,exp(-r*r*5.0)*opacity*(1.0-smoothstep(.65,1.0,r))); }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.flightShadow.position.set(0, FLOOR_Y + 1, -75);
    this.scene.add(this.flightShadow);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    trailGeometry.setDrawRange(0, 0);
    this.trail = new THREE.Points(
      trailGeometry,
      new THREE.PointsMaterial({
        color: palette.lilacInk,
        size: 1.8,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      }),
    );
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);

    const ringGeometry = new THREE.RingGeometry(56, 58, 64);
    this.targetRing = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({
        color: palette.coralInk,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      }),
    );
    this.target.add(this.targetRing);
    const marks = new THREE.Group();
    const markMaterial = new THREE.MeshBasicMaterial({
      color: palette.coralInk,
      transparent: true,
      opacity: 1,
    });
    for (let i = 0; i < 4; i++) {
      const mark = new THREE.Mesh(new THREE.BoxGeometry(8, 1.3, 0.2), markMaterial);
      const angle = (i * Math.PI) / 2;
      mark.position.set(Math.cos(angle) * 65, Math.sin(angle) * 65, 0);
      mark.rotation.z = angle;
      marks.add(mark);
    }
    this.target.add(marks);
    this.target.position.z = 120;
    this.target.visible = false;
    this.scene.add(this.target);

    // This marker is the committed click location, never the next mouse aim.
    // Its 57-unit radius is the actual hit-test circle, not decorative reach.
    const strikeMaterial = new THREE.MeshBasicMaterial({
      color: palette.coralInk,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    this.strikeMaterial = strikeMaterial;
    this.strikeProgress = new THREE.Mesh(
      new THREE.RingGeometry(55.5, 58.5, 64, 1, Math.PI / 2),
      strikeMaterial,
    );
    this.strikeMarker.add(this.strikeProgress);
    const centreMaterial = strikeMaterial;
    for (let i = 0; i < 2; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.8), centreMaterial);
      line.rotation.z = (i * Math.PI) / 2;
      this.strikeMarker.add(line);
    }
    this.strikeMarker.visible = false;
    this.scene.add(this.strikeMarker);
    this.impactRipple = new THREE.Mesh(
      new THREE.RingGeometry(55.5, 58.5, 64),
      new THREE.MeshBasicMaterial({
        color: palette.coral,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.impactFlash = new THREE.Mesh(
      new THREE.CircleGeometry(57, 64),
      new THREE.MeshBasicMaterial({
        color: palette.coral,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.impactRipple.visible = this.impactFlash.visible = false;
    this.scene.add(this.impactRipple, this.impactFlash);
    this.resize(canvas.clientWidth || 800, canvas.clientHeight || 560);
  }

  private buildStage(): void {
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(5000, 5000),
      new THREE.MeshBasicMaterial({ color: palette.scene, toneMapped: false }),
    );
    backdrop.position.z = -180;
    this.scene.add(backdrop);
    // A vertical flight window, not a tray: no floor exists underneath the fly's
    // current y coordinate. The room's floor remains below all flight bounds.
    const frame = new THREE.Mesh(
      new THREE.ShapeGeometry(roundedRectangle(1120, 780, 60)),
      new THREE.MeshBasicMaterial({ color: palette.stageFrame, toneMapped: false }),
    );
    frame.position.z = -145;
    this.scene.add(frame);
    const sky = new THREE.Mesh(
      new THREE.ShapeGeometry(roundedRectangle(1096, 756, 49)),
      new THREE.ShaderMaterial({
        uniforms: {
          upperTone: { value: new THREE.Color(palette.sky) },
          lowerTone: { value: new THREE.Color(palette.skyLow) },
        },
        vertexShader: `varying float viewY; void main() { viewY=position.y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `
        uniform vec3 upperTone;
        uniform vec3 lowerTone;
        varying float viewY;
        void main() {
          float gradientMix=smoothstep(-380.0,380.0,viewY);
          gl_FragColor=vec4(mix(lowerTone,upperTone,gradientMix),1.0);
          #include <colorspace_fragment>
        }
      `,
      }),
    );
    sky.position.z = -140;
    this.scene.add(sky);
    const windowOutline = roundedRectangle(1120, 780, 60)
      .getPoints(96)
      .map((point) => new THREE.Vector3(point.x, point.y, -139));
    this.scene.add(
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(windowOutline),
        new THREE.LineBasicMaterial({ color: palette.stageLine, transparent: true, opacity: 0.5 }),
      ),
    );

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(5000, 1000),
      new THREE.MeshBasicMaterial({ color: palette.floor, toneMapped: false }),
    );
    floor.position.set(0, FLOOR_Y - 500, -100);
    this.scene.add(floor);
    const horizon = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-2500, FLOOR_Y, -90),
      new THREE.Vector3(2500, FLOOR_Y, -90),
    ]);
    this.scene.add(
      new THREE.Line(
        horizon,
        new THREE.LineBasicMaterial({ color: palette.stageLine, transparent: true, opacity: 0.55 }),
      ),
    );
  }

  private buildFly(): void {
    const dark = new THREE.MeshStandardMaterial({ color: palette.ink, roughness: 0.6 });
    const body = new THREE.MeshStandardMaterial({ color: palette.body, roughness: 0.55 });
    const sheen = new THREE.MeshStandardMaterial({ color: palette.bodyHighlight, roughness: 0.6 });
    const eyeMaterial = new THREE.MeshStandardMaterial({ color: palette.coral, roughness: 0.32 });
    const eyeFacet = new THREE.MeshStandardMaterial({ color: palette.coralShade, roughness: 0.6 });
    const light = new THREE.MeshBasicMaterial({ color: palette.paper });
    const sphere = new THREE.SphereGeometry(1, 24, 18);
    const ellipsoid = (
      parent: THREE.Group,
      material: THREE.Material,
      position: number[],
      scale: number[],
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(sphere, material);
      mesh.position.set(position[0], position[1], position[2]);
      mesh.scale.set(scale[0], scale[1], scale[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    ellipsoid(this.anatomy, body, [-21, 23, 0], [32, 19, 17]);
    ellipsoid(this.anatomy, dark, [8, 25, 0], [22, 22, 19]);
    ellipsoid(this.anatomy, sheen, [3, 40, 0], [14, 8, 12]);
    ellipsoid(this.anatomy, dark, [33, 28, 0], [16, 16, 17]);
    // Two subtle abdomen bands read as a toy insect even at thumbnail size.
    for (const x of [-36, -25]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(15.5, 1.2, 5, 32), dark);
      band.rotation.y = Math.PI / 2;
      band.scale.y = 1.08;
      band.position.set(x, 23, 0);
      this.anatomy.add(band);
    }
    for (const side of [-1, 1]) {
      ellipsoid(this.anatomy, eyeMaterial, [38, 31, side * 13], [12.6, 15, 11.8]);
      ellipsoid(this.anatomy, light, [42, 39, side * 19], [3.1, 3.4, 2]);
      ellipsoid(this.anatomy, light, [46, 35, side * 19.5], [1.1, 1.4, 1]);
      for (let i = 0; i < 5; i++) {
        const angle = -0.75 + i * 0.35;
        ellipsoid(
          this.anatomy,
          eyeFacet,
          [37 + Math.sin(angle) * 7, 25 + Math.cos(angle) * 2, side * 23.1],
          [1.25, 1.35, 0.5],
        );
      }
      const antenna = new THREE.Group();
      antenna.position.set(45, 37, side * 7);
      antenna.add(rod(new THREE.Vector3(), new THREE.Vector3(9, 11, side * 4), 1, dark));
      ellipsoid(antenna, dark, [9, 11, side * 4], [2.2, 2.2, 2.2]);
      this.anatomy.add(antenna);
      this.antennae.push(antenna);

      const wingPivot = new THREE.Group();
      wingPivot.position.set(4, 40, side * 9);
      wingPivot.rotation.y = side * -0.38;
      wingPivot.rotation.z = -0.48;
      const wing = ellipsoid(
        wingPivot,
        new THREE.MeshPhysicalMaterial({
          color: palette.lilac,
          transparent: true,
          opacity: 0.73,
          roughness: 0.25,
          metalness: 0,
          transmission: 0,
          clearcoat: 1,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
        [-34, 1, side * 20],
        [46, 1.4, 18],
      );
      wing.castShadow = false;
      const veinMaterial = new THREE.LineBasicMaterial({
        color: palette.wingVein,
        transparent: true,
        opacity: 0.55,
      });
      const veins = [
        new THREE.Vector3(-1, 2.5, 0),
        new THREE.Vector3(-63, 2.5, side * 24),
        new THREE.Vector3(-1, 2.5, 0),
        new THREE.Vector3(-60, 2.5, side * 34),
        new THREE.Vector3(-19, 2.5, side * 7),
        new THREE.Vector3(-37, 2.5, side * 33),
      ];
      wingPivot.add(
        new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(veins), veinMaterial),
      );
      this.anatomy.add(wingPivot);
      this.wings.push(wingPivot);

      // A translucent swept envelope reads as fast wings without relying on an
      // aliased 200 Hz animation. These are visual blur, not extra anatomy.
      const blurPivot = new THREE.Group();
      blurPivot.position.copy(wingPivot.position);
      blurPivot.rotation.z = -0.48;
      for (const angle of [-0.48, -0.02, 0.42]) {
        const blur = new THREE.Mesh(
          sphere,
          new THREE.MeshBasicMaterial({
            color: palette.lilac,
            transparent: true,
            opacity: 0.105,
            depthWrite: false,
          }),
        );
        blur.position.set(-24, 8 + Math.abs(angle) * 12, side * 24);
        blur.scale.set(37, 6.0, 25);
        blur.rotation.y = side * angle;
        blurPivot.add(blur);
      }
      this.anatomy.add(blurPivot);
      this.wingBlurs.push(blurPivot);

      for (let index = 0; index < 3; index++) {
        const upper = rod(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 2.0, dark);
        const lower = rod(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 1.4, dark);
        const foot = ellipsoid(this.anatomy, dark, [0, 2, 0], [3.1, 1.7, 2.1]);
        this.anatomy.add(upper, lower);
        this.legs.push({ side, index, upper, lower, foot });
      }
    }
    // All poses rotate around the actual thorax, not the former ground-foot point.
    this.anatomy.position.copy(FLY_THORAX_CENTER).multiplyScalar(-1);
    this.bodyPivot.add(this.anatomy);
    this.fly.add(this.bodyPivot);
    this.scene.add(this.fly);
    this.fly.scale.setScalar(flyDisplayScale(800));
  }

  private buildSwatter(): void {
    const frameMaterial = new THREE.MeshStandardMaterial({ color: palette.coral, roughness: 0.7 });
    const handleMaterial = new THREE.MeshStandardMaterial({
      color: palette.coralShade,
      roughness: 0.7,
    });
    const frameShape = roundedRectangle(102, 96, 25);
    const cutout = roundedRectangle(85, 79, 19);
    const hole = new THREE.Path(cutout.getPoints());
    frameShape.holes.push(hole);
    const frame = new THREE.Mesh(
      new THREE.ExtrudeGeometry(frameShape, {
        depth: 5,
        bevelEnabled: true,
        bevelSize: 2,
        bevelThickness: 2,
        bevelSegments: 2,
        curveSegments: 10,
      }),
      frameMaterial,
    );
    frame.castShadow = true;
    this.swatter.add(frame);
    for (let i = -3; i <= 3; i++) {
      const vertical = new THREE.Mesh(new THREE.BoxGeometry(1.8, 74, 2), frameMaterial);
      vertical.position.set(i * 10, 0, 2);
      this.swatter.add(vertical);
      const horizontal = new THREE.Mesh(new THREE.BoxGeometry(79, 1.8, 2), frameMaterial);
      horizontal.position.set(0, i * 10, 2);
      this.swatter.add(horizontal);
    }
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(5, 82, 4, 8), handleMaterial);
    handle.position.set(0, -87, 2);
    handle.castShadow = true;
    this.swatter.add(handle);
    this.swatter.visible = false;
    // A high airborne paddle would cast a huge distracting disconnected shadow.
    // Its tilt and impact animation, not a second dark paddle, signal the strike.
    this.swatter.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = false;
    });
    this.scene.add(this.swatter);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0 || this.disposed) return;
    this.renderer.setSize(width, height, false);
    // A modest visual-only magnification keeps the subject legible on a phone.
    // Collision and the simulated body's position always remain unchanged.
    this.fly.scale.setScalar(flyDisplayScale(width));
    configureAimCamera(this.camera, width, height);
  }

  update(snapshot: GameSnapshot): void {
    if (!this.poseInitialized || (snapshot.mode === 'ready' && this.lastMode !== 'ready')) {
      this.displayX = snapshot.fly.x;
      this.displayY = snapshot.fly.y;
      this.facing = Math.cos(snapshot.fly.heading) < 0 ? -1 : 1;
      this.poseInitialized = true;
      this.trailCount = 0;
      this.trailX = snapshot.fly.x;
      this.trailY = snapshot.fly.y;
      this.trail.geometry.setDrawRange(0, 0);
    }
    if (this.snapshot && snapshot.time < this.snapshot.time) this.trailCount = 0;
    if (
      snapshot.mode === 'playing' &&
      Math.hypot(snapshot.fly.x - this.trailX, snapshot.fly.y - this.trailY) >= 9
    ) {
      if (this.trailCount === 96) this.trailPositions.copyWithin(0, 3);
      else this.trailCount++;
      const index = (this.trailCount - 1) * 3;
      this.trailPositions[index] = snapshot.fly.x - WORLD_WIDTH / 2;
      this.trailPositions[index + 1] = WORLD_HEIGHT / 2 - snapshot.fly.y;
      this.trailPositions[index + 2] = -20;
      this.trailX = snapshot.fly.x;
      this.trailY = snapshot.fly.y;
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.trail.geometry.setDrawRange(0, this.trailCount);
    }
    this.lastMode = snapshot.mode;
    this.swatVisual.update(snapshot);
    this.catchVisual.update(snapshot);
    this.snapshot = snapshot;
  }

  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.aimPlane, this.intersection))
      return { x: 500, y: 325 };
    return {
      x: THREE.MathUtils.clamp(this.intersection.x + WORLD_WIDTH / 2, 0, WORLD_WIDTH),
      y: THREE.MathUtils.clamp(WORLD_HEIGHT / 2 - this.intersection.y, 0, WORLD_HEIGHT),
    };
  }

  render(dtSeconds: number, presentation: { rate?: number; held?: boolean } = {}): number | null {
    if (this.disposed) return null;
    const dt = Math.min(0.05, Math.max(0, dtSeconds));
    const snapshot = this.snapshot;
    const simulatedDt = snapshot
      ? THREE.MathUtils.clamp(snapshot.time - this.animationSimTime, 0, 0.1)
      : 0;
    this.animationSimTime = snapshot?.time ?? 0;
    this.clock += snapshot?.mode === 'playing' ? simulatedDt : dt;
    const catchAge = this.catchVisual.advance(
      dt,
      presentation.rate ?? 1,
      presentation.held,
      this.reducedMotion.matches,
    );
    const isCaught = catchAge !== null;
    this.fly.visible = this.trail.visible = this.flightShadow.visible = !isCaught;
    if (snapshot) {
      // Render the latest physics position directly. Smoothing a 500-unit/sec
      // insect makes the visible target lag the hit test by an unfair distance.
      const blend = 1 - Math.exp(-dt * 45);
      this.displayX = snapshot.fly.x;
      this.displayY = snapshot.fly.y;
      const orientation = sideFlightOrientation(snapshot.fly, this.facing);
      this.facing = orientation.facing;
      const decorativeDepth = ((snapshot.fly.altitude ?? 85) - 85) * 0.6;
      this.fly.position.set(
        this.displayX - WORLD_WIDTH / 2,
        WORLD_HEIGHT / 2 - this.displayY,
        decorativeDepth,
      );
      this.splat.update(catchAge, this.fly.position.x, this.fly.position.y, this.fly.scale.x);
      this.fly.rotation.y = this.facing === -1 ? Math.PI : 0;
      this.bodyPivot.rotation.x = THREE.MathUtils.lerp(
        this.bodyPivot.rotation.x,
        isCaught ? 0 : (snapshot.fly.bank ?? 0) * 0.35,
        blend,
      );
      this.bodyPivot.rotation.z = THREE.MathUtils.lerp(
        this.bodyPivot.rotation.z,
        isCaught ? 0 : orientation.pitch,
        blend,
      );
      const distanceAboveFloor = this.fly.position.y - FLOOR_Y;
      this.flightShadow.position.set(this.fly.position.x, FLOOR_Y + 1, -75);
      this.flightShadow.scale.set(
        90 + distanceAboveFloor * 0.13,
        16 + distanceAboveFloor * 0.025,
        1,
      );
      (this.flightShadow.material as THREE.ShaderMaterial).uniforms.opacity.value =
        THREE.MathUtils.clamp(0.2 - distanceAboveFloor * 0.00022, 0.04, 0.2);
      const swatPose = this.swatVisual.pose(snapshot);
      // Only a confirmed terminal catch gets cosmetic time. Playing/replayed
      // misses still use the authoritative simulation clock without changes.
      if (catchAge !== null) {
        swatPose.impactAge = catchAge;
        swatPose.transform = paddleTransform(0, catchAge);
        swatPose.visible = catchAge < 0.3;
        swatPose.strikeVisible = catchAge < 0.23;
      }
      this.swatter.visible = swatPose.visible;
      this.target.visible = swatPose.targetVisible;
      this.target.position.set(
        swatPose.targetX - WORLD_WIDTH / 2,
        WORLD_HEIGHT / 2 - swatPose.targetY,
        120,
      );
      this.strikeMaterial.color.set(
        swatPose.impactAge !== null && swatPose.impactOutcome === 'caught'
          ? palette.success
          : palette.coralInk,
      );
      const strikeX = swatPose.x - WORLD_WIDTH / 2;
      const strikeY = WORLD_HEIGHT / 2 - swatPose.y;
      this.strikeMarker.visible = swatPose.strikeVisible;
      this.strikeMarker.position.set(strikeX, strikeY, 145);
      this.strikeProgress.geometry.setDrawRange(
        0,
        Math.ceil((swatPose.impactAge === null ? swatPose.progress : 1) * 64) * 6,
      );
      const age = swatPose.impactAge;
      const hasImpact = age !== null && age < 0.23;
      this.impactRipple.visible = this.impactFlash.visible = hasImpact;
      if (hasImpact) {
        const fade = Math.max(0, 1 - age / 0.23);
        const color = swatPose.impactOutcome === 'caught' ? palette.success : palette.coralInk;
        const flashColor = swatPose.impactOutcome === 'caught' ? palette.lime : palette.coral;
        this.impactRipple.position.set(strikeX, strikeY, 147);
        this.impactRipple.scale.setScalar(1 + (1 - fade) * 0.48);
        (this.impactRipple.material as THREE.MeshBasicMaterial).color.set(color);
        (this.impactRipple.material as THREE.MeshBasicMaterial).opacity = fade * fade * 0.85;
        this.impactFlash.position.set(strikeX, strikeY, 123);
        (this.impactFlash.material as THREE.MeshBasicMaterial).color.set(flashColor);
        (this.impactFlash.material as THREE.MeshBasicMaterial).opacity =
          0.2 * Math.max(0, 1 - age / 0.09);
      }
      if (this.swatter.visible) {
        const pose = swatPose.transform;
        this.swatter.position.set(strikeX + pose.offsetX, strikeY + pose.offsetY, pose.depth);
        this.swatter.rotation.set(pose.tiltX, pose.tiltY, pose.roll);
        this.swatter.scale.set(pose.scaleX, pose.scaleY, 1);
      }
    }

    for (let i = 0; i < this.wings.length; i++) {
      const side = i === 0 ? -1 : 1;
      const flutter = Math.sin(this.clock * 218 + i * 0.2) * 0.5;
      this.wings[i].rotation.x = side * (isCaught ? -1.1 : -0.65 + flutter);
      this.wings[i].rotation.y =
        side * (isCaught ? -0.85 : -0.38 + Math.cos(this.clock * 218) * 0.13);
      this.wings[i].rotation.z = -0.48;
      this.wingBlurs[i].visible = !isCaught;
      this.wingBlurs[i].rotation.x = side * (-0.65 + Math.sin(this.clock * 36) * 0.15);
      this.antennae[i].rotation.z = isCaught ? 0.5 : -0.3 + Math.sin(this.clock * 15 + i) * 0.035;
    }
    for (const leg of this.legs) {
      const { side, index } = leg;
      const bodyX = 21 - index * 18;
      const quiver = isCaught ? 0 : Math.sin(this.clock * 24 + index) * 1.1;
      this.start.set(bodyX, 24, side * 11);
      // Tucked, trailing legs. There is intentionally no planted-foot gait.
      this.knee.set(bodyX - 9, 10 + quiver, side * (21 + (index === 1 ? 3 : 0)));
      this.foot.set(bodyX - 22, isCaught ? 2 : 7 + quiver, side * (16 + index * 2));
      placeRod(leg.upper, this.start, this.knee);
      placeRod(leg.lower, this.knee, this.foot);
      leg.foot.position.copy(this.foot);
      leg.foot.rotation.y = side * 0.4;
    }
    this.renderer.render(this.scene, this.camera);
    return catchAge;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.Points
      ) {
        geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach((material) => {
          materials.add(material);
        });
      }
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    geometries.forEach((geometry) => {
      geometry.dispose();
    });
    materials.forEach((material) => {
      material.dispose();
    });
    this.renderer.dispose();
  }
}
