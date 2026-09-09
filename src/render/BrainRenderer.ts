import * as THREE from 'three';
import type { CircuitData, GameSnapshot, Neuron } from '../shared/types';
import { brainExportCrop, fitBrainCamera, type BrainViewBounds } from './brainFraming';
import { neuralColors, palette } from '../theme/palette';

const COLOR_REST = new THREE.Color(palette.nodeRest);
const COLOR_DISABLED = new THREE.Color(palette.nodeDisabled);
const COLOR_SENSORY = new THREE.Color(neuralColors.vision);
const COLOR_INTER = new THREE.Color(neuralColors.network);
const COLOR_OUTPUT = new THREE.Color(neuralColors.escape);
const DISABLED_CHANNELS = [COLOR_DISABLED.r, COLOR_DISABLED.g, COLOR_DISABLED.b];

/** Real point locations, real retained edges, and actual recent activity from the worker. */
export class BrainRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly circuit: CircuitData;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 50);
  private readonly group = new THREE.Group();
  private readonly positions: Float32Array;
  private readonly nodeColors: Float32Array;
  private readonly nodeActivity: Float32Array;
  private readonly nodes: THREE.Points;
  private readonly lines: THREE.LineSegments;
  private readonly drawnEdges: CircuitData['edges'];
  private readonly lineColors: Float32Array;
  private readonly lineActivity: Float32Array;
  private readonly projection = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private snapshot: GameSnapshot | null = null;
  private drag: { x: number; y: number; moved: boolean; id: number } | null = null;
  private viewWidth = 320;
  private viewHeight = 280;
  private framingDirty = true;
  private projectedBounds: BrainViewBounds | null = null;
  private exportCropDirty = true;
  private paintedCrop: BrainViewBounds | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, circuit: CircuitData) {
    this.canvas = canvas;
    this.circuit = circuit;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    // Limit pixel fill cost while preserving every real neuron and its activity.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(palette.brain, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);

    const bounds = new THREE.Box3();
    circuit.neurons.forEach((neuron) => {
      bounds.expandByPoint(new THREE.Vector3(neuron.x, neuron.y, neuron.z));
    });
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const dimensions = bounds.isEmpty()
      ? new THREE.Vector3(1, 1, 1)
      : bounds.getSize(new THREE.Vector3());
    const scale = 2.15 / Math.max(dimensions.x, dimensions.y, dimensions.z, 1);
    this.positions = new Float32Array(circuit.neurons.length * 3);
    this.nodeColors = new Float32Array(circuit.neurons.length * 3);
    this.nodeActivity = new Float32Array(circuit.neurons.length);
    circuit.neurons.forEach((neuron, i) => {
      this.positions[i * 3] = (neuron.x - center.x) * scale;
      this.positions[i * 3 + 1] = -(neuron.y - center.y) * scale;
      this.positions[i * 3 + 2] = (neuron.z - center.z) * scale;
      COLOR_REST.toArray(this.nodeColors, i * 3);
    });
    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    nodeGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.nodeColors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    nodeGeometry.setAttribute(
      'activity',
      new THREE.BufferAttribute(this.nodeActivity, 1).setUsage(THREE.DynamicDrawUsage),
    );
    // Four MDN outputs receive a purely visual size emphasis so their true spikes
    // can be distinguished within the thousands of surrounding network cells.
    nodeGeometry.setAttribute(
      'emphasis',
      new THREE.Float32BufferAttribute(
        circuit.neurons.map((neuron) => (neuron.type === 'MDN' ? 2.1 : 1)),
        1,
      ),
    );
    this.nodes = new THREE.Points(
      nodeGeometry,
      new THREE.ShaderMaterial({
        uniforms: { pixelRatio: { value: this.renderer.getPixelRatio() } },
        vertexShader: `
        attribute vec3 color;
        attribute float activity;
        attribute float emphasis;
        uniform float pixelRatio;
        varying vec3 vColor;
        varying float vActivity;
        void main() {
          vColor = color;
          vActivity = activity;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (2.6 + sqrt(max(activity, 0.0)) * 7.8) * emphasis * pixelRatio;
        }
      `,
        fragmentShader: `
        varying vec3 vColor;
        varying float vActivity;
        void main() {
          float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
          if (r > 1.0) discard;
          float core = 1.0 - smoothstep(0.14, 0.52, r);
          float halo = (1.0 - smoothstep(0.0, 1.0, r)) * 0.24;
          float excitation = clamp(vActivity, 0.0, 1.0);
          float alpha = vActivity < 0.0 ? 0.06 : mix(0.72 * (1.0-smoothstep(.25,1.0,r)), core * 0.98 + halo, sqrt(excitation));
          vec3 lit = mix(vColor, vec3(1.0), core * excitation * .32);
          gl_FragColor = vec4(lit, alpha);
          #include <colorspace_fragment>
        }
      `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.nodes.renderOrder = 2;
    this.group.add(this.nodes);

    // Drawing is thinned deterministically; simulation retains every edge.
    const stride = Math.max(1, Math.ceil(circuit.edges.length / 7500));
    this.drawnEdges = circuit.edges.filter((_, index) => index % stride === 0);
    const linePositions = new Float32Array(this.drawnEdges.length * 6);
    this.lineColors = new Float32Array(this.drawnEdges.length * 6);
    this.lineActivity = new Float32Array(this.drawnEdges.length * 2);
    this.drawnEdges.forEach(([source, target], i) => {
      for (let axis = 0; axis < 3; axis++) {
        linePositions[i * 6 + axis] = this.positions[source * 3 + axis];
        linePositions[i * 6 + 3 + axis] = this.positions[target * 3 + axis];
      }
      COLOR_REST.toArray(this.lineColors, i * 6);
      COLOR_REST.toArray(this.lineColors, i * 6 + 3);
    });
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.lineColors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    lineGeometry.setAttribute(
      'activity',
      new THREE.BufferAttribute(this.lineActivity, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.lines = new THREE.LineSegments(
      lineGeometry,
      new THREE.ShaderMaterial({
        vertexShader: `
        attribute vec3 color;
        attribute float activity;
        varying vec3 vColor;
        varying float vActivity;
        void main() {
          vColor=color; vActivity=activity;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
        }
      `,
        fragmentShader: `
        varying vec3 vColor;
        varying float vActivity;
        void main() {
          float alpha=vActivity<0.0 ? .002 : .010 + pow(vActivity,1.4)*.062;
          gl_FragColor=vec4(vColor,alpha);
          #include <colorspace_fragment>
        }
      `,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.group.add(this.lines);
    this.group.rotation.set(1.05, -0.12, 0);
    this.scene.add(this.group);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.style.touchAction = 'none';
    this.resize(canvas.clientWidth || 320, canvas.clientHeight || 280);
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.drag = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId };
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 1) this.drag.moved = true;
    this.group.rotation.y += dx * 0.008;
    this.group.rotation.x = THREE.MathUtils.clamp(
      this.group.rotation.x + dy * 0.008,
      -Math.PI / 2,
      Math.PI / 2,
    );
    this.framingDirty = true;
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.drag?.id !== event.pointerId) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
  };

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0 || this.disposed) return;
    this.renderer.setSize(width, height, false);
    this.viewWidth = width;
    this.viewHeight = height;
    this.framingDirty = true;
    this.frameCircuit();
  }

  private frameCircuit(): void {
    if (!this.framingDirty) return;
    this.group.updateMatrixWorld(true);
    this.projectedBounds = fitBrainCamera(
      this.camera,
      this.positions,
      this.group.matrixWorld,
      this.viewWidth,
      this.viewHeight,
    );
    this.exportCropDirty = true;
    this.framingDirty = false;
  }

  update(snapshot: GameSnapshot): void {
    if (snapshot === this.snapshot) return;
    this.snapshot = snapshot;
    const { activity, disabled } = snapshot.neural;
    for (let i = 0; i < this.circuit.neurons.length; i++) {
      const value = THREE.MathUtils.clamp(activity[i] || 0, 0, 1);
      this.nodeActivity[i] = disabled[i] ? -1 : value;
      const type = this.circuit.neurons[i].type;
      const activeColor =
        type === 'LC16' ? COLOR_SENSORY : type === 'MDN' ? COLOR_OUTPUT : COLOR_INTER;
      this.color.copy(disabled[i] ? COLOR_DISABLED : COLOR_REST);
      if (!disabled[i]) this.color.lerp(activeColor, Math.min(1, value * 2));
      this.color.toArray(this.nodeColors, i * 3);
    }
    this.nodes.geometry.attributes.color.needsUpdate = true;
    this.nodes.geometry.attributes.activity.needsUpdate = true;

    // An edge takes the colour of its real presynaptic neuron. There are no invented travelling pulses.
    for (let i = 0; i < this.drawnEdges.length; i++) {
      const [source, target] = this.drawnEdges[i];
      const off = disabled[source] || disabled[target];
      this.lineActivity[i * 2] = this.lineActivity[i * 2 + 1] = off
        ? -1
        : this.nodeActivity[source];
      for (let axis = 0; axis < 3; axis++) {
        const value = off ? DISABLED_CHANNELS[axis] : this.nodeColors[source * 3 + axis];
        this.lineColors[i * 6 + axis] = value;
        this.lineColors[i * 6 + 3 + axis] = value;
      }
    }
    this.lines.geometry.attributes.color.needsUpdate = true;
    this.lines.geometry.attributes.activity.needsUpdate = true;
  }

  pick(clientX: number, clientY: number): Neuron | null {
    this.frameCircuit();
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    this.group.updateMatrixWorld(true);
    let closest = -1;
    let distance = 14 * 14;
    for (let i = 0; i < this.circuit.neurons.length; i++) {
      this.projection
        .fromArray(this.positions, i * 3)
        .applyMatrix4(this.group.matrixWorld)
        .project(this.camera);
      const x = ((this.projection.x + 1) * rect.width) / 2;
      const y = ((1 - this.projection.y) * rect.height) / 2;
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < distance && !this.snapshot?.neural.disabled[i]) {
        closest = i;
        distance = d;
      }
    }
    return closest >= 0 ? this.circuit.neurons[closest] : null;
  }

  render(_dtSeconds = 0): void {
    if (!this.disposed) {
      this.frameCircuit();
      this.renderer.render(this.scene, this.camera);
      if (this.exportCropDirty) {
        this.paintedCrop = brainExportCrop(
          this.projectedBounds,
          this.viewWidth,
          this.viewHeight,
          this.canvas.width,
          this.canvas.height,
        );
        this.exportCropDirty = false;
      }
    }
  }

  /** Source-bitmap pixels for the last painted view, including any user rotation. */
  getExportCrop(): BrainViewBounds {
    return this.paintedCrop ?? { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.nodes.geometry.dispose();
    (this.nodes.material as THREE.Material).dispose();
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}
