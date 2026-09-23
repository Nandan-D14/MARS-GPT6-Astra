import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LightMode, SiteId } from './types';

const noise = new ImprovedNoise();
const TAU = Math.PI * 2;

function randomGenerator(seed: number) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function terrainHeight(x: number, z: number) {
  const distance = Math.sqrt(x * x + (z + 15) * (z + 15));
  const dunes = THREE.MathUtils.smoothstep(distance, 60, 205);
  return noise.noise(x * 0.025, z * 0.025, 8.3) * 1.7
    + noise.noise(x * 0.13, z * 0.13, 2.7) * 0.2
    + noise.noise(x * 0.47, z * 0.47, 5.1) * 0.045
    + dunes * (11 + noise.noise(x * 0.009, z * 0.009, 4.2) * 38
    + noise.noise(x * 0.022, z * 0.022, 1.3) * 11);
}

type StandardMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

function part(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0, y = 0, z = 0,
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function box(parent: THREE.Object3D, material: THREE.Material, size: number[], pos: number[]) {
  return part(parent, new THREE.BoxGeometry(size[0], size[1], size[2]), material, pos[0], pos[1], pos[2]);
}

function rod(parent: THREE.Object3D, material: THREE.Material, a: number[], b: number[], radius: number) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const direction = end.clone().sub(start);
  const mesh = part(parent, new THREE.CylinderGeometry(radius, radius, direction.length(), 8), material);
  mesh.position.copy(start.add(end).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

// Bake static pieces by material, keeping the detailed outpost inexpensive to render.
function batchStatic(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const meshes: THREE.Mesh[] = [];
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    if (geometry.index) {
      const nonIndexed = geometry.toNonIndexed();
      geometry.dispose();
      groups.set(object.material, [...(groups.get(object.material) || []), nonIndexed]);
    } else {
      groups.set(object.material, [...(groups.get(object.material) || []), geometry]);
    }
    meshes.push(object);
  });
  meshes.forEach(mesh => {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  });
  groups.forEach((geometries, material) => {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach(geometry => geometry.dispose());
    if (merged) part(group, merged, material);
  });
}

function createEnvironment(renderer: THREE.WebGLRenderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#6c7781');
  gradient.addColorStop(0.36, '#c5bcb7');
  gradient.addColorStop(0.49, '#f8dec7');
  gradient.addColorStop(0.54, '#cb9d80');
  gradient.addColorStop(0.7, '#82543f');
  gradient.addColorStop(1, '#332c29');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 512);
  const reflection = ctx.createLinearGradient(0, 0, 1024, 0);
  reflection.addColorStop(0, 'rgba(255,255,255,0)');
  reflection.addColorStop(0.1, 'rgba(255,247,235,.1)');
  reflection.addColorStop(0.14, 'rgba(255,247,235,.9)');
  reflection.addColorStop(0.2, 'rgba(255,247,235,.03)');
  reflection.addColorStop(0.47, 'rgba(0,0,0,.65)');
  reflection.addColorStop(0.59, 'rgba(255,247,235,.6)');
  reflection.addColorStop(0.67, 'rgba(255,247,235,.03)');
  reflection.addColorStop(0.83, 'rgba(0,0,0,.55)');
  reflection.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = reflection;
  ctx.fillRect(0, 0, 1024, 512);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromEquirectangular(texture);
  texture.dispose();
  generator.dispose();
  return environment;
}

function steelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const rng = randomGenerator(41);
  ctx.fillStyle = '#a9a6a4';
  ctx.fillRect(0, 0, 256, 512);
  for (let y = 0; y < 512; y++) {
    const value = Math.floor(154 + rng() * 30);
    ctx.fillStyle = `rgb(${value},${value},${value})`;
    ctx.fillRect(0, y, 256, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 5);
  return texture;
}

function labelTexture(text: string, subtitle: string, color = '#242728') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 256);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.font = 'bold 68px Arial';
  ctx.fillText(text, 256, 120);
  ctx.font = '22px monospace';
  ctx.fillText(subtitle, 256, 164);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.5, depthWrite: false });
}

export interface Ship {
  id: SiteId;
  group: THREE.Group;
  doors: THREE.Group[];
  open: boolean;
  doorAmount: number;
}

function createShip(id: SiteId, materials: Record<string, StandardMaterial>): Ship {
  const group = new THREE.Group();
  const structure = new THREE.Group();
  group.add(structure);
  const { steel, dark, trim, black, orange } = materials;
  const radius = 3.9;
  part(structure, new THREE.CylinderGeometry(radius, radius, 28.3, 72), steel, 0, 15.35, 0);
  part(structure, new THREE.CylinderGeometry(radius + 0.025, radius + 0.025, 39, 48, 1, true, 1.18, 2.8), black, 0, 20.7, 0);

  // The forward cargo bay is genuinely open, with an interior and hinged doors.
  part(structure, new THREE.CylinderGeometry(radius, radius, 10.5, 64, 1, true, 0.73, TAU - 1.46), steel, 0, 34.75, 0);
  part(structure, new THREE.CylinderGeometry(radius - 0.12, radius - 0.12, 0.18, 64), dark, 0, 29.5, 0);
  part(structure, new THREE.CylinderGeometry(radius - 0.05, radius - 0.05, 0.2, 64), dark, 0, 40, 0);
  box(structure, dark, [5.15, 10.3, 0.18], [0, 34.75, -0.65]);
  for (const x of [-2.5, 0, 2.5]) box(structure, black, [0.16, 10.4, 0.22], [x, 34.75, 1.1]);
  for (const y of [29.65, 34.6, 39.75]) box(structure, trim, [5.25, 0.18, 0.2], [0, y, 2.62]);
  for (let i = 0; i < 4; i++) {
    box(structure, trim, [1.02, 1.5, 1.3], [-1.75 + i * 1.16, 30.55, 1.6]);
    box(structure, dark, [0.82, 1.22, 0.04], [-1.75 + i * 1.16, 30.55, 2.28]);
    for (let k = 0; k < 5; k++) box(structure, steel, [0.025, 1.17, 0.04], [-2.08 + i * 1.16 + k * 0.16, 30.55, 2.31]);
  }

  const points = [
    [3.9, 0], [3.86, 1.5], [3.64, 3], [3.25, 4.8],
    [2.72, 6.3], [2.12, 7.7], [1.43, 9], [0.72, 10.25], [0.18, 10.95], [0, 11.05],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  part(structure, new THREE.LatheGeometry(points, 72), steel, 0, 40, 0);
  const shieldPoints = points.map(point => new THREE.Vector2(point.x + 0.018, point.y));
  part(structure, new THREE.LatheGeometry(shieldPoints, 48, 1.18, 2.8), black, 0, 40, 0);
  const tipPoints = points.slice(6).map(point => new THREE.Vector2(point.x + 0.026, point.y));
  part(structure, new THREE.LatheGeometry(tipPoints, 48), black, 0, 40, 0);

  for (let y = 2; y < 29.2; y += 1.48) {
    const ring = part(structure, new THREE.TorusGeometry(radius + 0.008, 0.014, 4, 72), trim, 0, y, 0);
    ring.rotation.x = Math.PI / 2;
  }
  for (let y = 30.4; y < 40; y += 1.48) {
    const ring = part(structure, new THREE.TorusGeometry(radius + 0.008, 0.014, 4, 64, TAU - 1.46), trim, 0, y, 0);
    ring.rotation.set(Math.PI / 2, 0, 0.73 + Math.PI / 2);
  }
  for (const x of [-0.9, 0, 0.9]) {
    const port = part(structure, new THREE.CylinderGeometry(0.13, 0.13, 0.05, 16), dark, x, 28.2, Math.sqrt(radius * radius - x * x));
    port.rotation.x = Math.PI / 2;
    const rim = part(structure, new THREE.TorusGeometry(0.14, 0.026, 6, 16), trim, x, 28.2, Math.sqrt(radius * radius - x * x) + 0.04);
    rim.rotation.z = Math.PI / 2;
  }
  for (const y of [8, 19.2, 24.7]) {
    const port = part(structure, new THREE.CylinderGeometry(0.18, 0.18, 0.04, 16), dark, 0.5, y, radius);
    port.rotation.x = Math.PI / 2;
  }

  const fin = (side: number, upper: boolean) => {
    const shape = new THREE.Shape();
    const vertices = upper
      ? [[3.0, 40.7], [6.0, 40.8], [6.0, 43.2], [2.75, 47.0]]
      : [[3.7, 1.0], [6.7, 0.5], [6.7, 7.1], [3.75, 13.2]];
    vertices.forEach(([x, y], i) => i === 0 ? shape.moveTo(x * side, y) : shape.lineTo(x * side, y));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.19, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.035, bevelSegments: 1, steps: 1 });
    const mesh = part(structure, geometry, steel, 0, 0, -0.5);
    const outline = new THREE.EdgesGeometry(geometry, 30);
    const lines = new THREE.LineSegments(outline, new THREE.LineBasicMaterial({ color: '#363135' }));
    mesh.add(lines);
    rod(structure, dark, [side * 3.85, upper ? 41 : 2.0, -0.5], [side * 6.65, upper ? 43.2 : 7.1, -0.5], 0.09);
  };
  for (const side of [-1, 1]) {
    fin(side, false);
    fin(side, true);
  }

  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + Math.PI / 4;
    const x = Math.sin(angle), z = Math.cos(angle);
    rod(structure, dark, [x * 3.65, 5.2, z * 3.65], [x * 6.1, 0.2, z * 6.1], 0.15);
    rod(structure, trim, [x * 3.65, 2.6, z * 3.65], [x * 6.1, 0.35, z * 6.1], 0.085);
    const foot = box(structure, dark, [1.6, 0.18, 1.05], [x * 6.1, 0.13, z * 6.1]);
    foot.rotation.y = angle;
    part(structure, new THREE.CylinderGeometry(0.5, 0.76, 1.2, 24, 1, true), black, x * 1.8, 0.9, z * 1.8);
  }

  const mark = part(structure, new THREE.PlaneGeometry(3.6, 1.8), labelTexture('OUTPOST', id === 'alpha' ? 'A - 01' : 'B - 02'), 0, 7.4, radius + 0.035);
  mark.castShadow = false;
  box(structure, black, [1.35, 3.15, 0.22], [0, 2.85, radius - 0.03]);
  box(structure, orange, [0.4, 0.11, 0.05], [0, 4.1, radius + 0.13]);

  for (const x of [-2.55, 2.55]) {
    rod(structure, dark, [x, 37, 2.9], [x, 35.7, 7.8], 0.075);
    rod(structure, trim, [x, 32.4, 3.2], [x, 35.7, 7.8], 0.065);
    rod(structure, trim, [x, 35.7, 7.8], [x, 0.75, 7.8], 0.016);
    rod(structure, trim, [x, 2.4, 7.8], [x - 0.75, 0.55, 7.8], 0.026);
    rod(structure, trim, [x, 2.4, 7.8], [x + 0.75, 0.55, 7.8], 0.026);
  }
  rod(structure, dark, [-2.55, 35.7, 7.8], [2.55, 35.7, 7.8], 0.08);
  box(structure, trim, [6.9, 0.24, 3.7], [0, 0.4, 7.8]);
  for (let i = 0; i < 16; i++) box(structure, dark, [0.04, 0.015, 3.4], [-3.1 + i * 0.41, 0.531, 7.8]);
  const ramp = box(structure, trim, [3.7, 0.1, 2.2], [0, 0.2, 10.5]);
  ramp.rotation.x = 0.16;

  batchStatic(structure);
  const doors: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 2.6, 34.75, 2.91);
    group.add(pivot);
    const door = new THREE.Group();
    pivot.add(door);
    box(door, steel, [2.6, 10.35, 0.11], [-side * 1.29, 0, 0]);
    box(door, trim, [0.08, 10.4, 0.16], [-side * 2.55, 0, 0]);
    for (const y of [-4.9, 0, 4.9]) box(door, trim, [2.6, 0.075, 0.15], [-side * 1.29, y, -0.08]);
    pivot.rotation.y = side * 2.0;
    doors.push(pivot);
  }
  return { id, group, doors, open: true, doorAmount: 1 };
}

export interface DriveableRover {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  home: { x: number; z: number; heading: number };
}

function createRover(materials: Record<string, StandardMaterial>, tanks = false, driveable = false) {
  const group = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  const { steel, dark, trim, black, orange, white } = materials;
  box(group, trim, [6.9, 0.45, 3.7], [0, 1, 0]);
  box(group, dark, [5.8, 0.35, 2.4], [0, 0.67, 0]);
  for (const side of [-1, 1]) {
    const wheelCount = tanks ? 4 : 3;
    for (let i = 0; i < wheelCount; i++) {
      const x = -2.45 + i * (4.9 / (wheelCount - 1));
      const wheel = part(group, new THREE.CylinderGeometry(0.56, 0.56, 0.48, 24), black, x, 0.59, side * 1.87);
      wheel.rotation.x = Math.PI / 2;
      if (driveable) wheels.push(wheel);
      const hub = part(group, new THREE.CylinderGeometry(0.35, 0.35, 0.5, 12), trim, x, 0.59, side * 1.88);
      hub.rotation.x = Math.PI / 2;
      if (driveable) wheels.push(hub);
      const axle = part(group, new THREE.CylinderGeometry(0.11, 0.11, 0.52, 8), dark, x, 0.59, side * 1.91);
      axle.rotation.x = Math.PI / 2;
      for (let s = 0; s < 8; s++) {
        const angle = s * TAU / 8;
        rod(group, steel, [x, 0.59, side * 2.14], [x + Math.cos(angle) * 0.32, 0.59 + Math.sin(angle) * 0.32, side * 2.14], 0.025);
      }
    }
  }
  if (tanks) {
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const x = -2.3 + i * 1.54;
        part(group, new THREE.CapsuleGeometry(0.58, 1.4, 6, 16), steel, x, 2.44, side * 0.86);
        for (const y of [1.7, 2.8]) {
          const band = part(group, new THREE.TorusGeometry(0.6, 0.035, 6, 20), trim, x, y, side * 0.86);
          band.rotation.x = Math.PI / 2;
        }
        rod(group, trim, [x, 3.7, side * 0.86], [x, 3.9, side * 0.86], 0.07);
      }
    }
    for (const side of [-1, 1]) {
      rod(group, trim, [-3.3, 1.2, side * 1.7], [-3.3, 3.6, side * 1.7], 0.045);
      rod(group, trim, [3.3, 1.2, side * 1.7], [3.3, 3.6, side * 1.7], 0.045);
      rod(group, trim, [-3.3, 3.6, side * 1.7], [3.3, 3.6, side * 1.7], 0.045);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const x = -2.15 + i * 2.15;
      const tank = part(group, new THREE.CylinderGeometry(0.9, 0.9, 2.8, 32), white, x, 2.18, 0);
      tank.rotation.x = Math.PI / 2;
      const front = part(group, new THREE.CylinderGeometry(0.72, 0.72, 0.12, 32), dark, x, 2.18, 1.46);
      front.rotation.x = Math.PI / 2;
      const inner = part(group, new THREE.CylinderGeometry(0.48, 0.48, 0.13, 24), trim, x, 2.18, 1.52);
      inner.rotation.x = Math.PI / 2;
      for (const z of [-1.2, 1.2]) {
        const ring = part(group, new THREE.TorusGeometry(0.9, 0.055, 8, 32), steel, x, 2.18, z);
        ring.rotation.z = Math.PI / 2;
      }
      box(group, orange, [0.5, 0.09, 0.06], [x, 1.38, 1.49]);
    }
  }
  for (const x of [-3.2, 3.2]) box(group, orange, [0.26, 0.13, 0.1], [x, 1.02, 1.92]);
  if (driveable) {
    // Open driver seat at the front of the bed so the rider visibly sits in the rover.
    box(group, dark, [1.0, 0.16, 1.0], [2.55, 1.3, 0]);
    box(group, dark, [0.16, 0.95, 1.0], [3.0, 1.75, 0]);
    box(group, orange, [0.5, 0.35, 0.12], [1.9, 1.6, 0]);
  } else {
    batchStatic(group);
  }
  return { group, wheels };
}

export interface Astronaut {
  group: THREE.Group;
  torso: THREE.Group;
  arms: THREE.Group[];
  legs: THREE.Group[];
  knees: THREE.Group[];
}

function createAstronaut(materials: Record<string, StandardMaterial>): Astronaut {
  const group = new THREE.Group();
  const torso = new THREE.Group();
  group.add(torso);
  const { white, dark, orange, trim } = materials;
  const suit = new THREE.MeshStandardMaterial({ color: '#ece9e1', roughness: 0.77, metalness: 0.05 });
  const visor = new THREE.MeshPhysicalMaterial({ color: '#9c7032', metalness: 1, roughness: 0.13, clearcoat: 1, envMapIntensity: 1.5 });
  part(torso, new RoundedBoxGeometry(0.67, 0.78, 0.43, 3, 0.14), suit, 0, 1.3, 0);
  part(torso, new RoundedBoxGeometry(0.53, 0.28, 0.39, 2, 0.09), suit, 0, 0.91, 0);
  box(torso, dark, [0.61, 0.1, 0.45], [0, 1.03, 0]);
  box(torso, trim, [0.15, 0.11, 0.05], [0, 1.03, 0.25]);
  part(torso, new RoundedBoxGeometry(0.29, 0.28, 0.06, 2, 0.035), white, 0, 1.4, 0.244);
  box(torso, orange, [0.2, 0.055, 0.02], [0, 1.45, 0.28]);
  for (const x of [-0.065, 0, 0.065]) box(torso, dark, [0.027, 0.025, 0.015], [x, 1.35, 0.28]);
  part(torso, new RoundedBoxGeometry(0.6, 0.66, 0.29, 3, 0.07), white, 0, 1.35, -0.34);
  box(torso, orange, [0.61, 0.1, 0.02], [0, 1.49, -0.5]);
  box(torso, trim, [0.45, 0.31, 0.015], [0, 1.22, -0.501]);
  for (let i = 0; i < 5; i++) box(torso, dark, [0.36, 0.015, 0.02], [0, 1.12 + i * 0.047, -0.517]);
  for (const x of [-0.32, 0.32]) part(torso, new THREE.CapsuleGeometry(0.085, 0.41, 4, 12), trim, x, 1.34, -0.32);
  part(torso, new THREE.CylinderGeometry(0.21, 0.24, 0.12, 24), dark, 0, 1.74, 0);
  const helmet = part(torso, new THREE.SphereGeometry(0.34, 32, 24), suit, 0, 1.98, 0);
  helmet.scale.set(1.02, 1.06, 1);
  const frame = part(torso, new THREE.SphereGeometry(0.297, 32, 20), dark, 0, 2, 0.14);
  frame.scale.set(1, 0.78, 0.72);
  const face = part(torso, new THREE.SphereGeometry(0.275, 32, 20), visor, 0, 2.01, 0.174);
  face.scale.set(1, 0.74, 0.72);
  for (const x of [-0.33, 0.33]) {
    part(torso, new THREE.SphereGeometry(0.07, 12, 10), trim, x, 2, 0);
  }
  rod(torso, dark, [0.22, 1.52, -0.39], [0.22, 2.18, -0.39], 0.015);

  const arms: THREE.Group[] = [], legs: THREE.Group[] = [], knees: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.405, 1.58, 0);
    arm.rotation.z = side * 0.09;
    torso.add(arm);
    part(arm, new THREE.SphereGeometry(0.165, 16, 12), suit, 0, 0, 0);
    part(arm, new THREE.CapsuleGeometry(0.122, 0.27, 4, 12), suit, 0, -0.2, 0);
    part(arm, new THREE.CylinderGeometry(0.126, 0.128, 0.065, 16), orange, 0, -0.17, 0);
    part(arm, new THREE.SphereGeometry(0.12, 12, 10), dark, 0, -0.39, 0.018);
    part(arm, new THREE.CapsuleGeometry(0.107, 0.21, 4, 12), suit, 0, -0.52, 0.06);
    part(arm, new THREE.CylinderGeometry(0.11, 0.11, 0.045, 12), dark, 0, -0.665, 0.067);
    part(arm, new THREE.SphereGeometry(0.113, 12, 10), suit, 0, -0.74, 0.078);
    arms.push(arm);

    const leg = new THREE.Group();
    leg.position.set(side * 0.184, 0.92, 0);
    group.add(leg);
    part(leg, new THREE.CapsuleGeometry(0.145, 0.28, 4, 14), suit, 0, -0.2, 0);
    const knee = new THREE.Group();
    knee.position.set(0, -0.43, 0);
    leg.add(knee);
    part(knee, new THREE.SphereGeometry(0.13, 14, 10), dark);
    part(knee, new THREE.CapsuleGeometry(0.128, 0.2, 4, 12), suit, 0, -0.17, 0);
    part(knee, new THREE.CylinderGeometry(0.131, 0.132, 0.065, 14), orange, 0, -0.18, 0);
    part(knee, new RoundedBoxGeometry(0.29, 0.18, 0.43, 2, 0.065), suit, 0, -0.36, 0.062);
    box(knee, dark, [0.29, 0.055, 0.43], [0, -0.438, 0.062]);
    legs.push(leg);
    knees.push(knee);
  }
  group.scale.setScalar(1.18);
  return { group, torso, arms, legs, knees };
}

export interface MarsWorld {
  scene: THREE.Scene;
  astronaut: Astronaut;
  ships: Ship[];
  rover: DriveableRover;
  dust: THREE.Points;
  light: THREE.DirectionalLight;
  sky: THREE.ShaderMaterial;
  footprints: THREE.InstancedMesh;
  environment: THREE.WebGLRenderTarget;
  setLight: (mode: LightMode) => void;
  dispose: () => void;
}

export function createWorld(renderer: THREE.WebGLRenderer): MarsWorld {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#c6967f', 0.0027);
  const environment = createEnvironment(renderer);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.95;
  const rng = randomGenerator(728);
  const brushed = steelTexture();
  const materials: Record<string, StandardMaterial> = {
    steel: new THREE.MeshStandardMaterial({ color: '#cecdcf', metalness: 0.94, roughness: 0.29, bumpMap: brushed, bumpScale: 0.006, envMapIntensity: 1.4, side: THREE.DoubleSide }),
    trim: new THREE.MeshStandardMaterial({ color: '#7d7776', metalness: 0.82, roughness: 0.43 }),
    dark: new THREE.MeshStandardMaterial({ color: '#303031', metalness: 0.65, roughness: 0.48 }),
    black: new THREE.MeshStandardMaterial({ color: '#202027', metalness: 0.24, roughness: 0.83, side: THREE.DoubleSide }),
    orange: new THREE.MeshStandardMaterial({ color: '#d96c3b', metalness: 0.3, roughness: 0.48 }),
    white: new THREE.MeshStandardMaterial({ color: '#c7c4bd', metalness: 0.46, roughness: 0.4 }),
  };

  const sky = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color('#9c746a') },
      horizonColor: { value: new THREE.Color('#edc5a6') },
      sunDirection: { value: new THREE.Vector3(-0.6, 0.3, -0.8).normalize() },
    },
    vertexShader: `varying vec3 vWorld; void main() { vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz; gl_Position = projectionMatrix * viewMatrix * world; }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunDirection;
      varying vec3 vWorld;
      void main() {
        vec3 direction = normalize(vWorld - cameraPosition);
        float height = max(direction.y, 0.0);
        vec3 color = mix(horizonColor, topColor, pow(height, 0.55));
        float sun = max(dot(direction, sunDirection), 0.0);
        color += vec3(0.24, 0.14, 0.065) * pow(sun, 12.0);
        color += vec3(0.42, 0.32, 0.20) * pow(sun, 1500.0);
        float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        color += (grain - 0.5) * 0.006;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1700, 32, 20), sky);
  scene.add(skyMesh);

  // A big, dramatic Martian moon (imagined — real Phobos/Deimos are tiny).
  // Placed well inside the sky dome and camera far plane so it stays visible.
  const moonCanvas = document.createElement('canvas');
  moonCanvas.width = moonCanvas.height = 512;
  const moonCtx = moonCanvas.getContext('2d')!;
  const moonGradient = moonCtx.createRadialGradient(200, 190, 40, 256, 256, 360);
  moonGradient.addColorStop(0, '#f4ece2');
  moonGradient.addColorStop(0.55, '#d9cec2');
  moonGradient.addColorStop(1, '#a89c90');
  moonCtx.fillStyle = moonGradient;
  moonCtx.fillRect(0, 0, 512, 512);
  const moonRng = randomGenerator(1234);
  for (let i = 0; i < 160; i++) {
    const x = moonRng() * 512, y = moonRng() * 512, r = 3 + moonRng() * 26;
    moonCtx.fillStyle = `rgba(90,80,72,${0.08 + moonRng() * 0.22})`;
    moonCtx.beginPath();
    moonCtx.arc(x, y, r, 0, TAU);
    moonCtx.fill();
    moonCtx.strokeStyle = `rgba(255,250,240,${0.1 + moonRng() * 0.25})`;
    moonCtx.lineWidth = 2;
    moonCtx.beginPath();
    moonCtx.arc(x - r * 0.15, y - r * 0.15, r * 0.85, Math.PI * 0.9, Math.PI * 1.9);
    moonCtx.stroke();
  }
  const moonTexture = new THREE.CanvasTexture(moonCanvas);
  moonTexture.colorSpace = THREE.SRGBColorSpace;
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(120, 64, 64),
    new THREE.MeshStandardMaterial({
      map: moonTexture, roughness: 1, metalness: 0,
      emissive: new THREE.Color('#cfc2b4'), emissiveMap: moonTexture, emissiveIntensity: 0.38,
      fog: false,
    }),
  );
  moon.position.set(-620, 430, -1050);
  scene.add(moon);
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 256;
  const glowCtx = glowCanvas.getContext('2d')!;
  const glowGradient = glowCtx.createRadialGradient(128, 128, 10, 128, 128, 128);
  glowGradient.addColorStop(0, 'rgba(255,236,210,0.55)');
  glowGradient.addColorStop(0.35, 'rgba(255,225,190,0.18)');
  glowGradient.addColorStop(1, 'rgba(255,225,190,0)');
  glowCtx.fillStyle = glowGradient;
  glowCtx.fillRect(0, 0, 256, 256);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, transparent: true, depthWrite: false, fog: false, opacity: 0.9,
  }));
  glow.scale.setScalar(520);
  glow.position.copy(moon.position);
  scene.add(glow);

  const hemi = new THREE.HemisphereLight('#f7decd', '#6f4436', 2.5);
  scene.add(hemi);
  const light = new THREE.DirectionalLight('#ffe4c8', 3.4);
  light.position.set(-75, 90, 65);
  light.target.position.set(0, 0, -15);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, { left: -100, right: 100, top: 105, bottom: -95, near: 0.5, far: 300 });
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.normalBias = 0.045;
  light.shadow.bias = -0.00015;
  light.shadow.radius = 3;
  scene.add(light, light.target);
  const fill = new THREE.DirectionalLight('#d3dce9', 0.8);
  fill.position.set(65, 45, -75);
  scene.add(fill);

  const groundGeometry = new THREE.PlaneGeometry(1200, 1200, 360, 360);
  groundGeometry.rotateX(-Math.PI / 2);
  const position = groundGeometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    position.setY(i, terrainHeight(x, z));
    const shade = 0.86 + noise.noise(x * 0.037, z * 0.037, 7.1) * 0.12;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade * 0.97;
    colors[i * 3 + 2] = shade * 0.93;
  }
  groundGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const farIndices: number[] = [];
  const groundIndices = groundGeometry.index!;
  for (let i = 0; i < groundIndices.count; i += 3) {
    const a = groundIndices.getX(i), b = groundIndices.getX(i + 1), c = groundIndices.getX(i + 2);
    const centerX = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const centerZ = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    if (Math.abs(centerX) > 127 || centerZ < -137 || centerZ > 117) farIndices.push(a, b, c);
  }
  groundGeometry.setIndex(farIndices);
  groundGeometry.computeVertexNormals();
  const groundMaterial = new THREE.MeshStandardMaterial({ color: '#b87958', roughness: 1, vertexColors: true });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.receiveShadow = true;
  scene.add(ground);
  let disposed = false;
  const loader = new THREE.TextureLoader();
  loader.load('/textures/mars-regolith.jpg', texture => {
    if (disposed) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(80, 80);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    groundMaterial.map = texture;
    groundMaterial.bumpMap = texture;
    groundMaterial.bumpScale = 0.19;
    groundMaterial.color.set('#e7c5ae');
    groundMaterial.needsUpdate = true;
  });

  // A second, close-range terrain patch preserves small undulations underfoot.
  const detailGeometry = new THREE.PlaneGeometry(260, 260, 210, 210);
  detailGeometry.rotateX(-Math.PI / 2);
  const detailPositions = detailGeometry.attributes.position;
  const detailColors = new Float32Array(detailPositions.count * 3);
  for (let i = 0; i < detailPositions.count; i++) {
    const x = detailPositions.getX(i), z = detailPositions.getZ(i) - 10;
    detailPositions.setZ(i, z);
    detailPositions.setY(i, terrainHeight(x, z) + 0.025);
    const shade = 0.86 + noise.noise(x * 0.037, z * 0.037, 7.1) * 0.12;
    detailColors.set([shade, shade * 0.97, shade * 0.93], i * 3);
  }
  const uv = detailGeometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (detailPositions.getX(i) + 600) / 1200, (600 - detailPositions.getZ(i)) / 1200);
  }
  detailGeometry.setAttribute('color', new THREE.BufferAttribute(detailColors, 3));
  detailGeometry.computeVertexNormals();
  const detail = new THREE.Mesh(detailGeometry, groundMaterial);
  detail.receiveShadow = true;
  scene.add(detail);

  const rockGeometry = new THREE.IcosahedronGeometry(1, 1);
  const rockPosition = rockGeometry.attributes.position;
  for (let i = 0; i < rockPosition.count; i++) {
    const x = rockPosition.getX(i), y = rockPosition.getY(i), z = rockPosition.getZ(i);
    const distortion = 0.83 + noise.noise(x * 2.4, y * 2.4, z * 2.4) * 0.29;
    rockPosition.setXYZ(i, x * distortion, y * distortion, z * distortion);
  }
  rockGeometry.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(rockGeometry, new THREE.MeshStandardMaterial({ color: '#98705a', roughness: 1, flatShading: true }), 2000);
  const dummy = new THREE.Object3D();
  const rockColor = new THREE.Color();
  for (let i = 0; i < 2000; i++) {
    const x = (rng() - 0.5) * 550, z = (rng() - 0.5) * 550;
    const size = i < 160 ? 0.5 + rng() * 1.65 : 0.08 + rng() * 0.47;
    dummy.position.set(x, terrainHeight(x, z) + size * 0.12, z);
    dummy.scale.set(size * (0.8 + rng() * 0.9), size * (0.35 + rng() * 0.4), size);
    dummy.rotation.set(rng(), rng() * TAU, rng());
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    rockColor.setHSL(0.055 + rng() * 0.018, 0.18 + rng() * 0.14, 0.34 + rng() * 0.15);
    rocks.setColorAt(i, rockColor);
  }
  rocks.receiveShadow = true;
  rocks.castShadow = true;
  scene.add(rocks);

  const ships = [createShip('alpha', materials), createShip('bravo', materials)];
  ships[0].group.position.set(28, terrainHeight(28, -14), -14);
  ships[1].group.position.set(-23, terrainHeight(-23, -62), -62);
  ships[1].group.rotation.y = 0.08;
  ships.forEach(ship => scene.add(ship.group));

  const rover = createRover(materials, false, true);
  rover.group.position.set(-15, terrainHeight(-15, 13), 13);
  rover.group.rotation.y = -0.15;
  scene.add(rover.group);
  const driveable: DriveableRover = {
    group: rover.group,
    wheels: rover.wheels,
    home: { x: -15, z: 13, heading: -0.15 },
  };
  const tanker = createRover(materials, true);
  tanker.group.position.set(15, terrainHeight(15, 9), 9);
  tanker.group.rotation.y = -0.16;
  scene.add(tanker.group);

  const crates = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const x = -7 + i * 2.35, z = -8;
    const y = terrainHeight(x, z);
    box(crates, materials.dark, [2.15, 1.8, 2.1], [x, y + 1, z]);
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) box(crates, materials.steel, [0.1, 1.9, 0.1], [x + dx, y + 1, z + dz]);
    for (const dy of [0.1, 1.9]) {
      box(crates, materials.steel, [2.2, 0.1, 2.2], [x, y + dy, z]);
    }
    for (let k = 0; k < 6; k++) box(crates, materials.trim, [0.05, 1.55, 0.08], [x - 0.88 + k * 0.35, y + 1, z + 1.07]);
    box(crates, materials.orange, [0.3, 0.15, 0.09], [x, y + 1.4, z + 1.13]);
  }
  batchStatic(crates);
  scene.add(crates);

  for (const ship of ships) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(41,24,19,0.48)');
    gradient.addColorStop(0.4, 'rgba(50,29,21,0.26)');
    gradient.addColorStop(1, 'rgba(50,29,21,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(25, 25), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(ship.group.position.x, ship.group.position.y + 0.04, ship.group.position.z);
    scene.add(pad);
  }

  const astronaut = createAstronaut(materials);
  scene.add(astronaut.group);
  const dustPositions = new Float32Array(650 * 3);
  for (let i = 0; i < 650; i++) {
    dustPositions.set([(rng() - 0.5) * 260, rng() * 28 + 0.5, (rng() - 0.5) * 260], i * 3);
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: '#ffe2bf', size: 0.055, transparent: true, opacity: 0.3, depthWrite: false, sizeAttenuation: true }));
  scene.add(dust);

  const footprints = new THREE.InstancedMesh(new THREE.BoxGeometry(0.17, 0.009, 0.32), new THREE.MeshStandardMaterial({ color: '#76513e', roughness: 1, transparent: true, opacity: 0.45, depthWrite: false }), 160);
  footprints.count = 0;
  footprints.receiveShadow = true;
  footprints.frustumCulled = false;
  scene.add(footprints);

  return {
    scene, astronaut, ships, rover: driveable, dust, light, sky, footprints, environment,
    setLight(mode) {
      if (mode === 'day') {
        light.position.set(-65, 140, 45);
        light.color.set('#fff1db');
        light.intensity = 3.8;
        hemi.intensity = 3.0;
        sky.uniforms.topColor.value.set('#b88e77');
        sky.uniforms.horizonColor.value.set('#efcdab');
        sky.uniforms.sunDirection.value.set(-0.3, 0.7, -0.6).normalize();
        (scene.fog as THREE.FogExp2).color.set('#d5ae91');
      } else {
        light.position.set(-75, 90, 65);
        light.color.set('#ffe4c8');
        light.intensity = 3.4;
        hemi.intensity = 2.5;
        sky.uniforms.topColor.value.set('#9c746a');
        sky.uniforms.horizonColor.value.set('#edc5a6');
        sky.uniforms.sunDirection.value.set(-0.6, 0.3, -0.8).normalize();
        (scene.fog as THREE.FogExp2).color.set('#c6967f');
      }
    },
    dispose() {
      disposed = true;
      const geometries = new Set<THREE.BufferGeometry>();
      const materialSet = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
          geometries.add(object.geometry);
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          objectMaterials.forEach(material => {
            materialSet.add(material);
            for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
          });
        }
      });
      geometries.forEach(geometry => geometry.dispose());
      materialSet.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
      environment.dispose();
      light.shadow.map?.dispose();
    },
  };
}