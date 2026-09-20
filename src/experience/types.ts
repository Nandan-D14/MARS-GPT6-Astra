export type CameraMode = 'third-person' | 'orbit';
export type SiteId = 'alpha' | 'bravo' | 'rover';
export type LightMode = 'golden' | 'day';

export interface Site {
  id: SiteId;
  number: string;
  name: string;
  type: string;
  description: string;
  x: number;
  z: number;
  radius: number;
}

export const SITES: Site[] = [
  {
    id: 'alpha', number: '01', name: 'Starship Alpha', type: 'CREW & CARGO LANDER',
    description: 'Your home, a long way from home. Alpha carries the living quarters, life-support systems, and supplies for the first crew on the Martian surface.',
    x: 28, z: -14, radius: 13,
  },
  {
    id: 'bravo', number: '02', name: 'Starship Bravo', type: 'SURFACE OPERATIONS',
    description: 'The foundation of a new outpost. Bravo delivered the heavy equipment, power systems, and scientific instruments that make this expedition possible.',
    x: -23, z: -62, radius: 13,
  },
  {
    id: 'rover', number: '03', name: 'Cargo Rover', type: 'AUTONOMOUS TRANSPORT',
    description: 'Built for the long haul. This six-wheel surface rover moves pressurized supplies between the landing zone and the growing outpost.',
    x: -15, z: 13, radius: 9,
  },
];

export interface Telemetry {
  x: number;
  z: number;
  heading: number;
  speed: number;
  elapsed: number;
  nearest: SiteId | null;
  fps: number;
}

export interface EngineCallbacks {
  onReady: () => void;
  onTelemetry: (data: Telemetry) => void;
  onModeChange: (mode: CameraMode) => void;
  onExplore: () => void;
  onDiscover: (id: SiteId) => void;
  onInteract: (id: SiteId) => void;
}