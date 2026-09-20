import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWorld, terrainHeight, type MarsWorld } from './world';
import { SITES, type CameraMode, type EngineCallbacks, type LightMode, type SiteId } from './types';

const SPAWN = new THREE.Vector3(0, 0, 48);
const UP = new THREE.Vector3(0, 1, 0);
const MOVEMENT_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'];

export class MarsEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly world: MarsWorld;
  private controls: OrbitControls;
  private callbacks: EngineCallbacks;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  private mode: CameraMode = 'third-person';
  private paused = false;
  private keys = new Set<string>();
  private visited = new Set<SiteId>();
  private yaw = 0;
  private pitch = 0;
  private distance = 18;
  private verticalVelocity = 0;
  private jumpHeight = 0;
  private speed = 0;
  private elapsed = 0;
  private previousTime = 0;
  private lastTelemetry = 0;
  private walkPhase = 0;
  private walkBlend = 0;
  private footprintDistance = 0;
  private footprintIndex = 0;
  private isDragging = false;
  private pointerX = 0;
  private pointerY = 0;
  private lastPointerId = -1;
  private hasExplored = false;
  private nearest: SiteId | null = null;
  private disposed = false;
  private ready = false;
  private frameCount = 0;
  private fps = 60;
  private fpsTime = 0;
  private mobile = false;
  private cameraPosition = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  private moveDirection = new THREE.Vector3();
  private footprintDummy = new THREE.Object3D();
  private orbitTransition: { from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3; progress: number } | null = null;

  constructor(container: HTMLElement, callbacks: EngineCallbacks, visited: SiteId[] = []) {
    this.container = container;
    this.callbacks = callbacks;
    this.visited = new Set(visited);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive Mars outpost. Use W A S D to walk, drag to look, Space to jump, and C to switch cameras.');
    this.renderer.domElement.setAttribute('role', 'application');
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2300);
    this.world = createWorld(this.renderer);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 225;
    this.controls.minPolarAngle = 0.1;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.enablePan = true;
    this.controls.panSpeed = 0.65;
    this.controls.rotateSpeed = 0.55;
    this.controls.target.set(3, 19, -22);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.resize();
    this.reset(false);
    this.getThirdPersonCamera();
    this.camera.position.copy(this.cameraPosition);
    this.smoothTarget.copy(this.cameraTarget);
    this.camera.lookAt(this.smoothTarget);
    this.addListeners();
    this.renderer.setAnimationLoop(this.animate);
  }

  private resize = () => {
    const width = this.container.clientWidth, height = this.container.clientHeight;
    if (!width || !height) return;
    this.mobile = width < 700;
    this.camera.aspect = width / height;
    this.camera.fov = this.mobile && this.camera.aspect < 0.9
      ? Math.max(68, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(22)) / this.camera.aspect)))
      : 55;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private addListeners() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearInput);
    document.addEventListener('visibilitychange', this.onVisibility);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.matches('input, textarea, select, [contenteditable="true"]') || this.paused) return;
    if (MOVEMENT_KEYS.includes(event.code)) {
      if (event.code === 'Space' && target.closest('button')) return;
      event.preventDefault();
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        this.beginExploration();
        if (this.mode === 'orbit') this.setMode('third-person');
        this.renderer.domElement.focus({ preventScroll: true });
      }
      this.keys.add(event.code);
      if (event.code === 'Space' && !event.repeat) this.jump();
    }
    if (event.repeat) return;
    if (event.code === 'KeyC') this.setMode(this.mode === 'third-person' ? 'orbit' : 'third-person');
    if (event.code === 'KeyR') this.reset();
    if (event.code === 'KeyE') this.interact();
  };

  private onKeyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); };
  private clearInput = () => { this.keys.clear(); this.isDragging = false; };
  private onVisibility = () => { this.clearInput(); this.previousTime = 0; };
  private onContextMenu = (event: Event) => event.preventDefault();

  private onPointerDown = (event: PointerEvent) => {
    if (this.paused || this.mode === 'orbit') return;
    this.isDragging = true;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.lastPointerId = event.pointerId;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
    this.renderer.domElement.focus({ preventScroll: true });
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.isDragging || this.paused || this.mode === 'orbit' || event.pointerId !== this.lastPointerId) return;
    const dx = event.clientX - this.pointerX, dy = event.clientY - this.pointerY;
    this.yaw -= dx * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.005, -0.82, 1.03);
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    this.isDragging = false;
    this.renderer.domElement.style.cursor = 'grab';
  };

  private onWheel = (event: WheelEvent) => {
    if (this.mode === 'orbit' || this.paused) return;
    event.preventDefault();
    this.distance = THREE.MathUtils.clamp(this.distance + event.deltaY * 0.012, 7, 30);
  };

  private beginExploration() {
    if (this.hasExplored) return;
    this.hasExplored = true;
    this.callbacks.onExplore();
  }

  startExploring() {
    this.beginExploration();
    if (this.mode !== 'third-person') this.setMode('third-person');
    this.renderer.domElement.focus({ preventScroll: true });
  }

  setKey(key: string, down: boolean) {
    if (down) {
      if (this.paused) return;
      this.beginExploration();
      if (this.mode === 'orbit') this.setMode('third-person');
      this.keys.add(key);
    } else this.keys.delete(key);
  }

  jump() {
    if (this.jumpHeight < 0.025 && !this.paused && this.mode === 'third-person') {
      this.verticalVelocity = 3.8;
      this.beginExploration();
    }
  }

  setMode(mode: CameraMode) {
    if (mode === this.mode) return;
    this.clearInput();
    this.mode = mode;
    this.orbitTransition = null;
    if (mode === 'orbit') {
      this.controls.enabled = false;
      this.orbitTransition = {
        from: this.camera.position.clone(), to: new THREE.Vector3(80, 53, 115),
        targetFrom: this.smoothTarget.clone(), targetTo: new THREE.Vector3(3, 18, -22), progress: 0,
      };
    } else {
      this.controls.enabled = false;
      this.smoothTarget.copy(this.controls.target);
    }
    this.callbacks.onModeChange(mode);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.clearInput();
    if (this.mode === 'orbit' && !this.orbitTransition) this.controls.enabled = !paused;
  }

  setLight(mode: LightMode) { this.world.setLight(mode); }

  setQuality(high: boolean) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1));
    this.renderer.shadowMap.enabled = high;
    this.world.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => { material.needsUpdate = true; });
      }
    });
    this.resize();
  }

  reset(notify = true) {
    const player = this.world.astronaut.group;
    player.position.set(SPAWN.x, terrainHeight(SPAWN.x, SPAWN.z) + 0.035, SPAWN.z);
    player.rotation.y = Math.PI;
    this.yaw = 0;
    this.pitch = 0;
    this.distance = 18;
    this.jumpHeight = 0;
    this.verticalVelocity = 0;
    this.speed = 0;
    this.nearest = null;
    this.hasExplored = false;
    this.footprintIndex = 0;
    this.world.footprints.count = 0;
    this.clearInput();
    if (this.mode !== 'third-person') this.setMode('third-person');
    if (notify) this.emitTelemetry();
  }

  travelTo(id: SiteId) {
    const site = SITES.find(item => item.id === id)!;
    const player = this.world.astronaut.group;
    const z = site.z + (id === 'rover' ? 7 : 10);
    player.position.set(site.x - (id === 'rover' ? 4 : 7), 0, z);
    player.position.y = terrainHeight(player.position.x, z) + 0.035;
    this.jumpHeight = 0;
    this.verticalVelocity = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.distance = 12;
    this.setMode('third-person');
    this.beginExploration();
    this.getThirdPersonCamera();
    this.camera.position.copy(this.cameraPosition);
    this.smoothTarget.copy(this.cameraTarget);
    this.camera.lookAt(this.smoothTarget);
    this.updateSites();
    this.emitTelemetry();
  }

  interact() {
    this.updateSites();
    if (this.nearest) this.callbacks.onInteract(this.nearest);
  }

  toggleCargo(id: SiteId) {
    const ship = this.world.ships.find(item => item.id === id);
    if (!ship) return false;
    this.focusSite(id);
    ship.open = !ship.open;
    return ship.open;
  }

  isCargoOpen(id: SiteId) { return this.world.ships.find(item => item.id === id)?.open ?? false; }

  private focusSite(id: SiteId) {
    const site = SITES.find(item => item.id === id)!;
    const ground = terrainHeight(site.x, site.z);
    this.setMode('orbit');
    this.controls.enabled = false;
    this.orbitTransition = {
      from: this.camera.position.clone(), to: new THREE.Vector3(site.x + 27, ground + 32, site.z + 53),
      targetFrom: this.smoothTarget.clone(), targetTo: new THREE.Vector3(site.x, ground + 26, site.z), progress: 0,
    };
  }

  capture() {
    this.renderer.render(this.world.scene, this.camera);
    const link = document.createElement('a');
    link.download = `outpost-mars-${Date.now()}.png`;
    link.href = this.renderer.domElement.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  private getThirdPersonCamera() {
    const player = this.world.astronaut.group.position;
    const distance = this.distance * (this.mobile ? 1.25 : 1);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.cameraPosition.set(
      player.x + sin * distance * Math.cos(this.pitch),
      player.y + distance * (0.32 + Math.sin(this.pitch) * 0.75),
      player.z + cos * distance * Math.cos(this.pitch),
    );
    const lookHeight = Math.max(1.2, distance * (0.53 - Math.sin(this.pitch) * 1.1));
    this.cameraTarget.set(player.x - sin * distance * 0.67, player.y + lookHeight, player.z - cos * distance * 0.67);
    this.cameraPosition.y = Math.max(this.cameraPosition.y, terrainHeight(this.cameraPosition.x, this.cameraPosition.z) + 0.9);
    for (const site of SITES.slice(0, 2)) {
      const dx = this.cameraPosition.x - site.x, dz = this.cameraPosition.z - site.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      if (length < 5.5 && this.cameraPosition.y < 51 && length > 0.01) {
        this.cameraPosition.x = site.x + dx / length * 5.5;
        this.cameraPosition.z = site.z + dz / length * 5.5;
      }
    }
  }

  private updatePlayer(dt: number) {
    let forward = 0, right = 0;
    if (!this.paused && this.mode === 'third-person') {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forward++;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forward--;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) right++;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) right--;
    }
    const moving = forward !== 0 || right !== 0;
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const targetSpeed = moving ? running ? 8.6 : 4.3 : 0;
    this.speed = THREE.MathUtils.damp(this.speed, targetSpeed, moving ? 8 : 12, dt);
    this.walkBlend = THREE.MathUtils.damp(this.walkBlend, moving ? 1 : 0, 9, dt);
    const astronaut = this.world.astronaut;
    const player = astronaut.group;
    if (moving) {
      this.moveDirection.set(
        -Math.sin(this.yaw) * forward + Math.cos(this.yaw) * right,
        0,
        -Math.cos(this.yaw) * forward - Math.sin(this.yaw) * right,
      ).normalize();
      const distance = this.speed * dt;
      player.position.addScaledVector(this.moveDirection, distance);
      player.position.x = THREE.MathUtils.clamp(player.position.x, -150, 150);
      player.position.z = THREE.MathUtils.clamp(player.position.z, -170, 145);
      const angle = Math.atan2(this.moveDirection.x, this.moveDirection.z);
      const difference = Math.atan2(Math.sin(angle - player.rotation.y), Math.cos(angle - player.rotation.y));
      player.rotation.y += difference * Math.min(1, dt * 10);
      this.resolveCollisions();
      this.footprintDistance += distance;
      if (this.footprintDistance > 0.82 && this.jumpHeight < 0.08) {
        this.addFootprint();
        this.footprintDistance = 0;
      }
    }
    if (this.jumpHeight > 0 || this.verticalVelocity > 0) {
      this.verticalVelocity -= 3.71 * dt;
      this.jumpHeight = Math.max(0, this.jumpHeight + this.verticalVelocity * dt);
      if (this.jumpHeight === 0) this.verticalVelocity = 0;
    }
    player.position.y = terrainHeight(player.position.x, player.position.z) + this.jumpHeight + 0.055;
    this.walkPhase += dt * this.speed * 2.4;
    const swing = Math.sin(this.walkPhase) * this.walkBlend * (running ? 0.7 : 0.49);
    astronaut.legs[0].rotation.x = swing;
    astronaut.legs[1].rotation.x = -swing;
    astronaut.knees[0].rotation.x = Math.max(0, -Math.sin(this.walkPhase)) * this.walkBlend * 0.65;
    astronaut.knees[1].rotation.x = Math.max(0, Math.sin(this.walkPhase)) * this.walkBlend * 0.65;
    astronaut.arms[0].rotation.x = -swing * 0.75 - 0.09;
    astronaut.arms[1].rotation.x = swing * 0.75 - 0.09;
    astronaut.torso.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.045 * this.walkBlend + Math.sin(this.elapsed * 1.7) * 0.005;
    astronaut.torso.rotation.z = Math.sin(this.walkPhase) * 0.018 * this.walkBlend;
    if (this.jumpHeight > 0.05) {
      astronaut.legs[0].rotation.x = -0.23;
      astronaut.legs[1].rotation.x = 0.2;
      astronaut.knees.forEach(knee => { knee.rotation.x = 0.4; });
      astronaut.arms[0].rotation.z = -0.35;
      astronaut.arms[1].rotation.z = 0.35;
    } else {
      astronaut.arms[0].rotation.z = -0.09;
      astronaut.arms[1].rotation.z = 0.09;
    }
  }

  private resolveCollisions() {
    const player = this.world.astronaut.group.position;
    const colliders = [
      { x: 28, z: -14, radius: 4.55 }, { x: -23, z: -62, radius: 4.55 },
      { x: -15, z: 13, radius: 3.9 }, { x: 15, z: 9, radius: 3.8 },
      { x: -4.65, z: -8, radius: 3.5 },
    ];
    for (const collider of colliders) {
      const dx = player.x - collider.x, dz = player.z - collider.z;
      const distance = Math.hypot(dx, dz);
      if (distance < collider.radius) {
        if (distance < 0.001) player.z = collider.z + collider.radius;
        else {
          player.x = collider.x + dx / distance * collider.radius;
          player.z = collider.z + dz / distance * collider.radius;
        }
      }
    }
  }

  private addFootprint() {
    const player = this.world.astronaut.group;
    const side = this.footprintIndex % 2 === 0 ? -0.19 : 0.19;
    const x = player.position.x + Math.cos(player.rotation.y) * side;
    const z = player.position.z - Math.sin(player.rotation.y) * side;
    this.footprintDummy.position.set(x, terrainHeight(x, z) + 0.046, z);
    this.footprintDummy.quaternion.setFromAxisAngle(UP, player.rotation.y);
    this.footprintDummy.updateMatrix();
    this.world.footprints.setMatrixAt(this.footprintIndex % 160, this.footprintDummy.matrix);
    this.footprintIndex++;
    this.world.footprints.count = Math.min(this.footprintIndex, 160);
    this.world.footprints.instanceMatrix.needsUpdate = true;
  }

  private updateSites() {
    const player = this.world.astronaut.group.position;
    this.nearest = null;
    let shortest = Infinity;
    for (const site of SITES) {
      const distance = Math.hypot(site.x - player.x, site.z - player.z);
      if (distance < site.radius && distance < shortest) {
        this.nearest = site.id;
        shortest = distance;
        if (!this.visited.has(site.id)) {
          this.visited.add(site.id);
          this.callbacks.onDiscover(site.id);
        }
      }
    }
  }

  private emitTelemetry() {
    const position = this.world.astronaut.group.position;
    this.callbacks.onTelemetry({
      x: position.x, z: position.z, heading: this.yaw, speed: this.speed,
      elapsed: this.elapsed, nearest: this.nearest, fps: this.fps,
    });
  }

  private animate = (time: number) => {
    if (this.disposed) return;
    const frameSeconds = this.previousTime ? (time - this.previousTime) / 1000 : 1 / 60;
    const dt = Math.min(frameSeconds, 0.05);
    this.previousTime = time;
    this.elapsed += dt;
    this.frameCount++;
    this.fpsTime += frameSeconds;
    if (this.fpsTime >= 1) {
      this.fps = Math.round(this.frameCount / this.fpsTime);
      this.frameCount = 0;
      this.fpsTime = 0;
    }
    this.updatePlayer(dt);
    if (this.mode === 'third-person') {
      this.getThirdPersonCamera();
      const damping = 1 - Math.exp(-7 * dt);
      this.camera.position.lerp(this.cameraPosition, damping);
      this.smoothTarget.lerp(this.cameraTarget, damping);
      this.camera.lookAt(this.smoothTarget);
    } else if (this.orbitTransition) {
      const transition = this.orbitTransition;
      transition.progress = Math.min(1, transition.progress + dt / 1.25);
      const t = 1 - Math.pow(1 - transition.progress, 3);
      this.camera.position.lerpVectors(transition.from, transition.to, t);
      this.controls.target.lerpVectors(transition.targetFrom, transition.targetTo, t);
      this.camera.lookAt(this.controls.target);
      if (transition.progress === 1) {
        this.orbitTransition = null;
        this.controls.enabled = !this.paused;
        this.controls.update();
      }
    } else {
      this.controls.update(dt);
      this.smoothTarget.copy(this.controls.target);
    }
    for (const ship of this.world.ships) {
      ship.doorAmount = THREE.MathUtils.damp(ship.doorAmount, ship.open ? 1 : 0, 1.0, dt);
      ship.doors[0].rotation.y = -2 * ship.doorAmount;
      ship.doors[1].rotation.y = 2 * ship.doorAmount;
    }
    this.world.dust.position.x = Math.sin(this.elapsed * 0.06) * 15;
    this.world.dust.position.y = Math.sin(this.elapsed * 0.11) * 0.25;
    this.world.dust.rotation.y = this.elapsed * 0.0007;
    if (this.elapsed - this.lastTelemetry >= 0.2) {
      this.updateSites();
      this.emitTelemetry();
      this.lastTelemetry = this.elapsed;
    }
    this.renderer.render(this.world.scene, this.camera);
    if (!this.ready) {
      this.ready = true;
      this.callbacks.onReady();
    }
  };

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clearInput);
    document.removeEventListener('visibilitychange', this.onVisibility);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.controls.dispose();
    this.world.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}