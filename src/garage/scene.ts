/**
 * Гараж: трёхмерная витрина машины.
 *
 * Свет здесь не декоративный. §11 спецификации назначает для рендера спрайтов
 * риг из трёх источников — ключевой, заполняющий, контровой, — и лампы в сцене
 * стоят ровно там, куда этот риг светит. Иначе витрина и трасса покажут
 * по-разному освещённую машину, и подмена вектора на рендеры из Blender развалится.
 *
 * Модель приходит из GLB, собранного тем же силуэтом, которым машина рисуется
 * в заезде (scripts/build-car-models.mjs). Кузов красится по имени материала:
 * любая окраска — параметр, а не отдельный файл.
 */

import {
  ACESFilmicToneMapping, AmbientLight, Box3, BoxGeometry, CircleGeometry, Color,
  CylinderGeometry, DoubleSide, FogExp2, Group, Mesh, MeshStandardMaterial,
  PCFSoftShadowMap, PerspectiveCamera, PointLight, RingGeometry, Scene, SpotLight,
  SRGBColorSpace, TorusGeometry, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Риг из §11: ключевой, заполняющий, контровой. Позиции — в метрах. */
export const LIGHT_RIG = [
  { id: 'key', label: 'Ключевой', color: 0xffd9a0, intensity: 120, position: [3.6, 4.4, 3.2] },
  { id: 'fill', label: 'Заполняющий', color: 0x7fa6d8, intensity: 34, position: [-4.6, 2.4, 2.0] },
  { id: 'rim', label: 'Контровой', color: 0xa8d8ff, intensity: 90, position: [-2.4, 3.0, -4.4] },
] as const;

export type LightId = (typeof LIGHT_RIG)[number]['id'];

export interface GarageOptions {
  canvas: HTMLCanvasElement;
  /** Путь к GLB. Модель обязана содержать материал с именем «body». */
  modelUrl: string;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

const PODIUM_RADIUS = 2.6;
const ROTATION_SPEED = 0.18;

export class Garage {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly turntable = new Group();
  private readonly lights = new Map<LightId, SpotLight>();
  private readonly bodyMaterials: MeshStandardMaterial[] = [];
  private rimGlow: MeshStandardMaterial | null = null;
  private rimLight: PointLight | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly options: GarageOptions;

  private raf = 0;
  private last = 0;
  private spinning = true;
  private elapsed = 0;
  /** Плавный переход цвета кузова: цель и текущее значение. */
  private readonly targetColor = new Color('#c0392b');
  private readonly currentColor = new Color('#c0392b');
  private reducedMotion = false;

  constructor(options: GarageOptions) {
    this.options = options;
    this.canvas = options.canvas;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.scene = new Scene();
    this.scene.background = new Color(0x0a0d13);
    // Туман съедает стены и оставляет машину единственным, что видно целиком.
    this.scene.fog = new FogExp2(0x0a0d13, 0.055);

    this.camera = new PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(6.4, 2.5, 6.8);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 13;
    // Под пол не пускаем: снизу у низкополигональной машины нечего показывать.
    this.controls.minPolarAngle = 0.35;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.target.set(0, 0.85, 0);

    this.buildRoom();
    this.buildPodium();
    this.buildLights();
    this.scene.add(this.turntable);
    this.loadCar();

    this.resize();
  }

  // ── сцена ──────────────────────────────────────────────────────────────────

  private buildRoom(): void {
    // Пол: тёмный и слегка глянцевый, чтобы ловить пятно от подиума.
    const floor = new Mesh(
      new CircleGeometry(26, 64),
      new MeshStandardMaterial({ color: 0x14171f, roughness: 0.62, metalness: 0.15 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Коробка гаража изнутри. Без неё контровой свет светит в пустоту,
    // а туман нечему растворять.
    const walls = new Mesh(
      new BoxGeometry(30, 9, 30),
      new MeshStandardMaterial({ color: 0x0f131b, roughness: 1, side: DoubleSide }),
    );
    walls.position.y = 4.4;
    this.scene.add(walls);

    // Рёбра секционных ворот — деталь, по которой помещение читается как гараж.
    const railMaterial = new MeshStandardMaterial({ color: 0x1b2130, roughness: 0.85 });
    for (let i = 0; i < 7; i++) {
      const rail = new Mesh(new BoxGeometry(11, 0.1, 0.16), railMaterial);
      rail.position.set(0, 0.75 + i * 0.78, -7.2);
      this.scene.add(rail);
    }
    for (const x of [-5.6, 5.6]) {
      const pillar = new Mesh(new BoxGeometry(0.4, 9, 0.4), railMaterial);
      pillar.position.set(x, 4.4, -7.2);
      this.scene.add(pillar);
    }
  }

  private buildPodium(): void {
    const drum = new Mesh(
      new CylinderGeometry(PODIUM_RADIUS, PODIUM_RADIUS * 1.04, 0.34, 72),
      new MeshStandardMaterial({ color: 0x171b24, roughness: 0.45, metalness: 0.5 }),
    );
    drum.position.y = 0.17;
    drum.receiveShadow = true;
    drum.castShadow = true;
    this.scene.add(drum);

    // Светящееся кольцо: эмиссивный материал плюс точечный источник,
    // иначе свечение не ложится на пол и кольцо выглядит наклейкой.
    this.rimGlow = new MeshStandardMaterial({
      color: 0x120c04,
      emissive: new Color(0xffb347),
      emissiveIntensity: 2.4,
      roughness: 0.4,
    });
    const ring = new Mesh(new TorusGeometry(PODIUM_RADIUS + 0.02, 0.035, 12, 96), this.rimGlow);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.35;
    this.scene.add(ring);

    const spill = new Mesh(
      new RingGeometry(PODIUM_RADIUS + 0.05, PODIUM_RADIUS + 1.5, 64),
      new MeshStandardMaterial({
        color: 0x000000,
        emissive: new Color(0xffb347),
        emissiveIntensity: 0.16,
        transparent: true,
        opacity: 0.5,
      }),
    );
    spill.rotation.x = -Math.PI / 2;
    spill.position.y = 0.012;
    this.scene.add(spill);

    this.rimLight = new PointLight(0xffb347, 14, 9, 2);
    this.rimLight.position.set(0, 0.42, 0);
    this.scene.add(this.rimLight);

    this.turntable.position.y = 0.34;
  }

  private buildLights(): void {
    for (const item of LIGHT_RIG) {
      const light = new SpotLight(item.color, item.intensity, 30, 0.62, 0.45, 1.6);
      light.position.set(...(item.position as unknown as [number, number, number]));
      light.target.position.set(0, 0.8, 0);
      light.castShadow = item.id === 'key';
      if (light.castShadow) {
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.bias = -0.0012;
        light.shadow.radius = 3;
      }
      this.scene.add(light, light.target);
      this.lights.set(item.id, light);
    }
    // Ровно столько общего света, чтобы тени не проваливались в чёрное.
    this.scene.add(new AmbientLight(0x2a3446, 0.55));
  }

  private loadCar(): void {
    new GLTFLoader().load(
      this.options.modelUrl,
      (gltf) => {
        const car = gltf.scene;
        car.traverse((node) => {
          if (!(node instanceof Mesh)) return;
          node.castShadow = true;
          node.receiveShadow = true;
          const material = node.material as MeshStandardMaterial;
          if (material?.name === 'body') {
            material.color.copy(this.currentColor);
            this.bodyMaterials.push(material);
          }
        });

        // Сажаем машину колёсами ровно на подиум, какой бы ни была модель.
        const box = new Box3().setFromObject(car);
        const size = box.getSize(new Vector3());
        const centre = box.getCenter(new Vector3());
        car.position.x -= centre.x;
        car.position.z -= centre.z;
        car.position.y -= box.min.y;
        this.turntable.add(car);

        this.controls.target.set(0, 0.34 + size.y * 0.45, 0);
        this.options.onReady?.();
      },
      undefined,
      (error) => this.options.onError?.(error),
    );
  }

  // ── управление ─────────────────────────────────────────────────────────────

  /** Цвет кузова. Меняется плавно, а не рывком: §11 — окраска это параметр. */
  setBodyColor(hex: string): void {
    this.targetColor.set(hex);
  }

  setLightEnabled(id: LightId, on: boolean): void {
    const light = this.lights.get(id);
    if (!light) return;
    const rig = LIGHT_RIG.find((item) => item.id === id)!;
    light.intensity = on ? rig.intensity : 0;
  }

  setSpinning(spinning: boolean): void {
    this.spinning = spinning;
  }

  isSpinning(): boolean {
    return this.spinning;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose(): void {
    this.stop();
    this.controls.dispose();
    this.renderer.dispose();
  }

  private update(dt: number): void {
    this.elapsed += dt;

    if (this.spinning && !this.reducedMotion) {
      this.turntable.rotation.y += ROTATION_SPEED * dt;
    }

    // Цвет догоняет цель по экспоненте — переход читается, но не тормозит.
    this.currentColor.lerp(this.targetColor, 1 - Math.exp(-dt * 7));
    for (const material of this.bodyMaterials) material.color.copy(this.currentColor);

    // Заполняющая лампа чуть подрагивает, как люминесцентная в гараже.
    // Амплитуда маленькая: заметно боковым зрением, не отвлекает.
    const fill = this.lights.get('fill');
    if (fill && fill.intensity > 0) {
      const flicker = 1 + 0.06 * Math.sin(this.elapsed * 37) * Math.sin(this.elapsed * 5.3);
      fill.intensity = LIGHT_RIG[1].intensity * flicker;
    }

    // Кольцо подиума дышит в такт вращению.
    if (this.rimGlow && this.rimLight) {
      const pulse = 1 + 0.12 * Math.sin(this.elapsed * 1.3);
      this.rimGlow.emissiveIntensity = 2.4 * pulse;
      this.rimLight.intensity = 14 * pulse;
    }

    this.controls.update();
  }
}
