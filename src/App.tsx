import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Camera,
  Check, CheckCheck, ChevronRight, CircleHelp, Compass, Crosshair,
  DoorOpen, Expand, Flag, Footprints, Keyboard, Maximize,
  Mouse, Navigation, Orbit, PersonStanding, RotateCcw, Settings2,
  ShieldCheck, Sun, Volume2, VolumeX, X,
} from 'lucide-react';
import { MarsEngine } from './experience/MarsEngine';
import { SITES, type CameraMode, type LightMode, type SiteId, type Telemetry } from './experience/types';
import { SiteMap } from './components/SiteMap';
import { useAmbientAudio } from './hooks/useAmbientAudio';

type Panel = 'mission' | 'controls' | 'map' | 'settings' | 'site' | null;
const STORAGE_KEY = 'outpost-mars-explored-v1';

function readVisited(): SiteId[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? [...new Set(saved.filter((id): id is SiteId => SITES.some(site => site.id === id)))] : [];
  } catch { return []; }
}

function OutpostMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="12.5" stroke="currentColor" strokeWidth="1.6" />
      <ellipse cx="20" cy="20" rx="21" ry="6.6" transform="rotate(-38 20 20)" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 25L20 13L26 25M16.8 20.2H23.2" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

const initialTelemetry: Telemetry = { x: 0, z: 48, heading: 0, speed: 0, elapsed: 0, nearest: null, fps: 60 };

export default function App() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MarsEngine | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exploring, setExploring] = useState(false);
  const [mode, setMode] = useState<CameraMode>('third-person');
  const [panel, setPanel] = useState<Panel>(null);
  const [telemetry, setTelemetry] = useState<Telemetry>(initialTelemetry);
  const [visited, setVisited] = useState<SiteId[]>(readVisited);
  const [waypoint, setWaypoint] = useState<SiteId>('alpha');
  const [mapSelection, setMapSelection] = useState<SiteId>('alpha');
  const [inspected, setInspected] = useState<SiteId>('alpha');
  const [cargoOpen, setCargoOpen] = useState(true);
  const [light, setLight] = useState<LightMode>('golden');
  const [highQuality, setHighQuality] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState<{ title: string; detail?: string } | null>(null);
  const [flash, setFlash] = useState(false);
  const [manifestOpen, setManifestOpen] = useState(false);
  const audio = useAmbientAudio();

  const notify = useCallback((title: string, detail?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ title, detail });
    toastTimer.current = setTimeout(() => setToast(null), 4300);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!sceneRef.current) return;
      try {
        engineRef.current = new MarsEngine(sceneRef.current, {
          onReady: () => setReady(true),
          onTelemetry: setTelemetry,
          onModeChange: setMode,
          onExplore: () => setExploring(true),
          onDiscover: id => {
            setVisited(previous => previous.includes(id) ? previous : [...previous, id]);
            notify('A new place. A new possibility.', `${SITES.find(site => site.id === id)!.name} added to your expedition log.`);
          },
          onInteract: id => {
            setInspected(id);
            setCargoOpen(engineRef.current?.isCargoOpen(id) ?? true);
            setManifestOpen(false);
            setPanel('site');
          },
        }, readVisited());
      } catch (cause) {
        console.error('Mars renderer could not initialize:', cause);
        setError('This experience needs WebGL 2. Enable hardware acceleration in your browser, then try again.');
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      engineRef.current?.dispose();
      engineRef.current = null;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [notify]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(visited)); } catch { /* Exploration still works when storage is unavailable. */ }
  }, [visited]);

  useEffect(() => {
    engineRef.current?.setPaused(panel !== null);
    if (!panel) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') setPanel(null);
      if (event.key !== 'Tab') return;
      const elements = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, input, [tabindex="0"]');
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [panel, ready]);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  const setCamera = (next: CameraMode) => {
    setPanel(null);
    engineRef.current?.setMode(next);
  };

  const reset = () => {
    setPanel(null);
    engineRef.current?.reset();
    notify('Back to the beginning.', 'Your expedition discoveries are saved.');
  };

  const changeLight = (next: LightMode) => {
    setLight(next);
    engineRef.current?.setLight(next);
  };

  const toggleAudio = async () => {
    try {
      const enabled = await audio.toggle();
      notify(enabled ? 'Listen to another world.' : 'Ambient audio muted.', enabled ? 'Martian wind ambience enabled.' : undefined);
    } catch { notify('Audio is unavailable in this browser.'); }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { notify('Full screen is not available here.', 'Try opening the experience in a separate browser tab.'); }
  };

  const takePhoto = () => {
    try {
      engineRef.current?.capture();
      setFlash(true);
      setTimeout(() => setFlash(false), 250);
      notify('A moment from Mars.', 'Your full-resolution scene snapshot download has started.');
    } catch { notify('This snapshot could not be saved.', 'Please allow downloads and try again.'); }
  };

  const trackSite = (id: SiteId) => {
    setWaypoint(id);
    setPanel(null);
    notify('Waypoint set.', `Follow the map to ${SITES.find(site => site.id === id)!.name}.`);
  };

  const travelTo = (id: SiteId) => {
    setWaypoint(id);
    setPanel(null);
    engineRef.current?.setPaused(false);
    engineRef.current?.travelTo(id);
    notify(`Arrived at ${SITES.find(site => site.id === id)!.name}.`, 'Press E to take a closer look.');
  };

  const currentSite = SITES.find(site => site.id === waypoint)!;
  const selectedSite = SITES.find(site => site.id === mapSelection)!;
  const inspectedSite = SITES.find(site => site.id === inspected)!;
  const waypointDistance = Math.round(Math.hypot(currentSite.x - telemetry.x, currentSite.z - telemetry.z));
  const heading = ((-telemetry.heading * 180 / Math.PI) % 360 + 360) % 360;
  const direction = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(heading / 45) % 8];
  const allVisited = visited.length === SITES.length;
  const panelTitle = panel === 'mission' ? 'THE EXPEDITION' : panel === 'controls' ? 'EXPLORER FIELD GUIDE' : panel === 'map' ? 'SURFACE NAVIGATION' : panel === 'site' ? 'SITE INFORMATION' : 'YOUR EXPERIENCE';

  const touchKey = (key: string) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      engineRef.current?.setKey(key, true);
    },
    onPointerUp: () => engineRef.current?.setKey(key, false),
    onPointerCancel: () => engineRef.current?.setKey(key, false),
    onLostPointerCapture: () => engineRef.current?.setKey(key, false),
  });

  return (
    <main className="outpost-app">
      <header className="topbar">
        <button className="brand" onClick={() => { setPanel(null); setExploring(false); engineRef.current?.reset(); }} aria-label="Outpost home">
          <OutpostMark /><span>OUTPOST<span className="brand-period">.</span></span>
        </button>
        <span className="brand-caption">A MARS EXPERIENCE</span>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={!panel || panel === 'map' || panel === 'site' ? 'active' : ''} onClick={() => setPanel(null)}>Explore</button>
          <button className={panel === 'mission' ? 'active' : ''} onClick={() => setPanel(panel === 'mission' ? null : 'mission')}>The mission</button>
          <button className={panel === 'controls' ? 'active' : ''} onClick={() => setPanel(panel === 'controls' ? null : 'controls')}>Controls <Keyboard size={13} /></button>
        </nav>
        <div className="header-actions">
          <span className="live-status"><i /> LIVE SIMULATION</span><div className="header-divider" />
          <button className="icon-button" onClick={toggleAudio} aria-label={audio.enabled ? 'Mute ambient audio' : 'Enable ambient audio'} title={audio.enabled ? 'Mute ambience' : 'Enable ambience'} aria-pressed={audio.enabled}>{audio.enabled ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
          <button className="icon-button settings-button" onClick={() => setPanel('settings')} aria-label="Experience settings" title="Experience settings"><Settings2 size={17} /></button>
          <button className="icon-button fullscreen-button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} title={fullscreen ? 'Exit full screen' : 'Full screen'}>{fullscreen ? <Maximize size={17} /> : <Expand size={17} />}</button>
        </div>
      </header>

      <section className={`experience ${ready ? 'is-ready' : ''} ${exploring ? 'is-exploring' : ''}`} aria-label="Mars exploration experience">
        <div className="scene-container" ref={sceneRef} /><div className="scene-shade" aria-hidden="true" />
        <div className="scene-heading">
          <div className="eyebrow"><span className="small-cross">+</span> HUMANITY'S NEXT HORIZON</div>
          <h1>MARS<br /><span>OUTPOST</span><span className="heading-dot">.</span></h1>
          <p>A new world. A different perspective.<br />Your first steps start here.</p>
          <button className="primary-button begin-button" disabled={!ready} onClick={() => engineRef.current?.startExploring()}><Footprints size={16} /> Begin exploration <ArrowUpRight size={17} /></button>
          <div className="intro-note"><span className="tiny-live-dot" /> REAL-TIME 3D. REAL POSSIBILITY.</div>
        </div>
        <div className="field-heading"><span className="eyebrow">EXPEDITION 001</span><h2>Make your own path.</h2><p>ARCADIA PLANITIA / MARS</p></div>
        <div className="compass-hud" aria-label={`Facing ${direction}, ${Math.round(heading)} degrees`}>
          <div className="compass-labels"><span>{['NW', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W'][Math.round(heading / 45) % 8]}</span><span>{direction}</span><span>{['NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'][Math.round(heading / 45) % 8]}</span></div>
          <div className="compass-ticks" style={{ backgroundPositionX: `${-heading * 2}px` }} /><div className="compass-pointer" /><span className="compass-degree">{String(Math.round(heading)).padStart(3, '0')}<span>&deg;</span></span>
        </div>
        <div className="environment-hud"><Sun size={23} strokeWidth={1.25} /><div><span className="environment-sol">SOL 042 <span>/</span> {light === 'golden' ? '16:42' : '12:08'}</span><span className="environment-description">{light === 'golden' ? 'LATE AFTERNOON' : 'CLEAR DAYLIGHT'} <i /> -63&deg; C</span></div></div>
        <div className="scene-tools">
          <button onClick={takePhoto} disabled={!ready} aria-label="Download a scene snapshot" title="Capture this moment"><Camera size={19} strokeWidth={1.5} /><span>Take a photo</span></button>
          <button onClick={() => { changeLight(light === 'golden' ? 'day' : 'golden'); notify(light === 'golden' ? 'Under a brighter sky.' : 'The golden hour on Mars.'); }} disabled={!ready} aria-label="Change time of day" title="Change time of day"><Sun size={19} strokeWidth={1.5} /><span>Change the light</span></button>
          <button onClick={() => setPanel('controls')} aria-label="Open movement controls" title="Movement controls"><CircleHelp size={19} strokeWidth={1.5} /><span>Need a hand?</span></button>
        </div>
        <button className="waypoint-hud" onClick={() => setPanel('mission')}>
          <span className="waypoint-symbol">{allVisited ? <CheckCheck size={19} /> : <Flag size={18} strokeWidth={1.5} />}</span>
          <span className="waypoint-content"><span className="eyebrow">{allVisited ? 'EXPEDITION COMPLETE' : 'YOUR FIRST EXPEDITION'}</span><strong>{allVisited ? 'A world of possibilities.' : 'Explore the landing site'} <ArrowUpRight size={15} /></strong><span className="waypoint-detail">{currentSite.name}<span className="middle-dot" />{waypointDistance} m away<span className="waypoint-count">{visited.length} / 3</span></span><span className="expedition-progress">{SITES.map(site => <i key={site.id} className={visited.includes(site.id) ? 'complete' : ''} />)}</span></span>
        </button>
        <div className="radar-hud"><button className="radar-button" aria-label="Open interactive site map" onClick={() => { setMapSelection(waypoint); setPanel('map'); }}><SiteMap telemetry={telemetry} selected={waypoint} visited={visited} /><span className="map-open-label"><Expand size={11} /> OPEN MAP</span></button><span className="radar-coordinates">38.2&deg; N &nbsp; 169.8&deg; W</span></div>
        {telemetry.nearest && !panel && <button className="interaction-prompt" onClick={() => engineRef.current?.interact()}><kbd>E</kbd><span>Explore <strong>{SITES.find(site => site.id === telemetry.nearest)!.name}</strong></span><ChevronRight size={15} /></button>}
        <div className="touch-controls" aria-label="Touch movement controls"><div className="direction-pad"><button className="pad-up" aria-label="Walk forward" {...touchKey('KeyW')}><ArrowUp size={19} /></button><button className="pad-left" aria-label="Walk left" {...touchKey('KeyA')}><ArrowLeft size={19} /></button><button className="pad-down" aria-label="Walk backward" {...touchKey('KeyS')}><ArrowDown size={19} /></button><button className="pad-right" aria-label="Walk right" {...touchKey('KeyD')}><ArrowRight size={19} /></button></div><button className="touch-jump" onClick={() => engineRef.current?.jump()} aria-label="Jump"><ArrowUp size={20} /><span>JUMP</span></button></div>
        {!ready && <div className="loading-overlay">{error ? <><OutpostMark /><h2>A little further to go.</h2><p>{error}</p><button className="primary-button" onClick={() => window.location.reload()}>Try again <RotateCcw size={16} /></button></> : <><OutpostMark /><span>PREPARING YOUR ARRIVAL</span><div className="loading-track"><i /></div><p>Another world is taking shape.</p></>}</div>}
        <div className={`photo-flash ${flash ? 'active' : ''}`} aria-hidden="true" />
        {toast && <div className="toast" role="status"><span className="toast-icon"><Check size={15} /></span><div><strong>{toast.title}</strong>{toast.detail && <p>{toast.detail}</p>}</div><button onClick={() => setToast(null)} aria-label="Dismiss notification"><X size={14} /></button></div>}
        <span className="scene-caption">THIS IS NOT A VIEW. IT'S A PLACE.</span>
      </section>

      <footer className="control-bar">
        <div className="camera-controls"><span className="control-label">YOUR PERSPECTIVE</span><div className="camera-segment"><button disabled={!ready} className={mode === 'third-person' ? 'selected' : ''} onClick={() => setCamera('third-person')} aria-pressed={mode === 'third-person'}><PersonStanding size={17} /> Third person</button><button disabled={!ready} className={mode === 'orbit' ? 'selected' : ''} onClick={() => setCamera('orbit')} aria-pressed={mode === 'orbit'}><Orbit size={17} /> Orbit view</button></div></div>
        <div className="keyboard-legend" aria-label="Movement shortcuts"><div className="legend-item move-legend"><div className="wasd"><kbd>W</kbd><span><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></div><span>Move</span></div><div className="legend-divider" /><div className="legend-item"><Mouse size={21} strokeWidth={1.25} /><span>Drag to look</span></div><div className="legend-item"><kbd className="wide-key">SHIFT</kbd><span>Run</span></div><div className="legend-item"><kbd className="wide-key">SPACE</kbd><span>Jump</span></div><div className="legend-item switch-legend"><kbd>C</kbd><span>Switch view</span></div></div>
        <div className="reset-controls"><button className="reset-button" onClick={reset} disabled={!ready}><RotateCcw size={14} /><span>Reset position</span><kbd>R</kbd></button><span className="engine-credit"><i /> BUILT TO EXPLORE. POWERED BY THREE.JS.</span></div>
      </footer>

      {panel && <div className="panel-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) setPanel(null); }}>
        <aside className={`drawer drawer-${panel}`} role="dialog" aria-modal="true" aria-labelledby="panel-title" ref={panelRef}>
          <div className="drawer-topline"><span className="eyebrow">{panelTitle}</span><button className="icon-button" onClick={() => setPanel(null)} aria-label="Close panel" ref={closeRef}><X size={20} /></button></div>
          {panel === 'mission' && <>
            <div className="panel-icon"><Flag size={26} strokeWidth={1.2} /></div><h2 id="panel-title">Small steps.<br />New beginnings.</h2><p className="panel-description">Welcome to Arcadia Planitia. Get your bearings, find the landers, and discover what it takes to make another world a home.</p>
            <div className="mission-summary"><span>SURFACE ORIENTATION</span><strong>{visited.length}<span> / 03</span></strong></div>
            <div className="mission-sites">{SITES.map(site => <button key={site.id} onClick={() => trackSite(site.id)}><span className={`site-number ${visited.includes(site.id) ? 'visited' : ''}`}>{visited.includes(site.id) ? <Check size={17} /> : site.number}</span><span><small>{site.type}</small><strong>{site.name}</strong><em>{visited.includes(site.id) ? 'Discovered' : `${Math.round(Math.hypot(site.x - telemetry.x, site.z - telemetry.z))} m from your position`}</em></span><ArrowUpRight size={18} /></button>)}</div>
            <div className="panel-note"><Compass size={19} /><p>Select a location to set a waypoint. Walk close to each site to add it to your expedition log, then press <kbd>E</kbd> to explore.</p></div>
            {allVisited && <div className="completion-note"><ShieldCheck size={20} /><span>Orientation complete. The rest of this world is yours to explore.</span></div>}
            <button className="primary-button panel-bottom-button" onClick={() => { setPanel(null); engineRef.current?.startExploring(); }}>{allVisited ? 'Keep exploring' : 'Take the first step'}<ArrowRight size={17} /></button><p className="simulation-disclaimer">An independent, imagined Mars expedition. Not affiliated with NASA or SpaceX.</p>
          </>}
          {panel === 'controls' && <>
            <div className="panel-icon"><Keyboard size={29} strokeWidth={1.2} /></div><h2 id="panel-title">Find your feet.</h2><p className="panel-description">No training required. Just a little curiosity.</p>
            <div className="controls-list">
              <div><span>Walk in any direction</span><span className="key-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></div><div><span>Look around</span><span><Mouse size={16} /> Click & drag</span></div><div><span>Move a little faster</span><kbd>SHIFT</kbd></div><div><span>Jump in Martian gravity</span><kbd>SPACE</kbd></div><div><span>Get closer / pull back</span><span><Mouse size={16} /> Scroll</span></div><div><span>Switch camera view</span><kbd>C</kbd></div><div><span>Inspect a nearby site</span><kbd>E</kbd></div><div><span>Return to the landing point</span><kbd>R</kbd></div><div><span>Close an open panel</span><kbd>ESC</kbd></div>
            </div><div className="panel-note"><PersonStanding size={21} /><p>Third person follows your astronaut. Orbit view lets you fly around the outpost. On touch screens, use the directional pad and drag the scene to look.</p></div><button className="primary-button panel-bottom-button" onClick={() => { setPanel(null); engineRef.current?.startExploring(); }}>Ready to explore<ArrowUpRight size={18} /></button>
          </>}
          {panel === 'map' && <>
            <h2 id="panel-title">Somewhere new.</h2><p className="panel-description">Arcadia Planitia, northern hemisphere.<br />Your small corner of a very big world.</p><div className="large-map"><SiteMap telemetry={telemetry} selected={mapSelection} visited={visited} interactive onSelect={setMapSelection} /></div><div className="map-legend"><span><i className="you-marker" /> YOU</span><span><i className="site-marker" /> LANDING SITES</span><span>100 M</span></div>
            <div className="map-site-tabs">{SITES.map(site => <button key={site.id} className={mapSelection === site.id ? 'selected' : ''} onClick={() => setMapSelection(site.id)}>{site.number}<span>{site.id === 'rover' ? 'Rover' : site.id === 'alpha' ? 'Alpha' : 'Bravo'}</span></button>)}</div><div className="selected-site"><span className="eyebrow">{selectedSite.type}</span><h3>{selectedSite.name}</h3><p>{Math.round(Math.hypot(selectedSite.x - telemetry.x, selectedSite.z - telemetry.z))} m from your position<span>{visited.includes(selectedSite.id) ? 'Discovered' : 'Unexplored'}</span></p></div><button className="primary-button" onClick={() => trackSite(selectedSite.id)}><Navigation size={16} />Set waypoint<ArrowRight size={16} /></button><button className="text-button" onClick={() => travelTo(selectedSite.id)}><Crosshair size={15} />Travel directly to this site</button>
          </>}
          {panel === 'settings' && <>
            <div className="panel-icon"><Settings2 size={27} strokeWidth={1.2} /></div><h2 id="panel-title">Your kind of world.</h2><p className="panel-description">A few small adjustments to make the experience your own.</p><div className="setting-section"><span className="control-label">TIME OF DAY</span><div className="setting-segment"><button className={light === 'golden' ? 'selected' : ''} onClick={() => changeLight('golden')}><Sun size={18} />Golden hour</button><button className={light === 'day' ? 'selected' : ''} onClick={() => changeLight('day')}><Sun size={18} />Daylight</button></div><p>Change the light across the Martian landscape.</p></div><div className="setting-row"><div><strong>Ambient sound</strong><p>A quiet wind on a distant world.</p></div><button className={`toggle ${audio.enabled ? 'on' : ''}`} onClick={toggleAudio} role="switch" aria-checked={audio.enabled} aria-label="Ambient sound"><i /></button></div><div className="setting-section"><label className="control-label" htmlFor="quality">RENDER QUALITY</label><select id="quality" value={highQuality ? 'high' : 'balanced'} onChange={event => { const high = event.target.value === 'high'; setHighQuality(high); engineRef.current?.setQuality(high); }}><option value="high">High detail + soft shadows</option><option value="balanced">Balanced performance</option></select><p>Choose balanced for a smoother experience on less powerful devices.</p></div><div className="render-info"><span>RENDERER</span><strong>THREE.JS / WEBGL 2</strong><span>FRAME RATE</span><strong>{telemetry.fps} FPS</strong></div><button className="primary-button panel-bottom-button" onClick={() => setPanel(null)}>Back to the surface<ArrowRight size={17} /></button>
          </>}
          {panel === 'site' && <>
            <div className="panel-icon">{inspected === 'rover' ? <Navigation size={29} strokeWidth={1.2} /> : <DoorOpen size={29} strokeWidth={1.2} />}</div><span className="eyebrow asset-type">{inspectedSite.type}</span><h2 id="panel-title">{inspectedSite.name}.</h2><p className="panel-description">{inspectedSite.description}</p>
            <div className="asset-drawing" aria-hidden="true">{inspected === 'rover' ? <svg viewBox="0 0 280 160"><path d="M45 109H235V123H45ZM61 71h43v37H61zM120 71h43v37h-43zM179 71h43v37h-43zM62 72a21 21 0 0142 0M121 72a21 21 0 0142 0M180 72a21 21 0 0142 0" /><circle cx="71" cy="127" r="12" /><circle cx="116" cy="127" r="12" /><circle cx="163" cy="127" r="12" /><circle cx="209" cy="127" r="12" /></svg> : <svg viewBox="0 0 280 260"><path d="M120 223V75Q121 45 140 18Q159 45 160 75V223ZM120 158L102 193V224H120M160 158L178 193V224H160M121 68L107 90V109H120M159 68L173 90V109H160M120 124H160M120 135H160M120 147H160M120 171H160M120 183H160M120 195H160M120 207H160M120 79H160M124 87H156V119H124ZM124 223L111 239H100M156 223L169 239H180M133 223V235H147V223" /><path className="dimension-line" d="M89 20V237M85 20H94M85 237H94M188 223H216M188 18H216M211 18V223" /><text x="71" y="137" transform="rotate(-90 71 137)">51.0 M</text><text x="203" y="132" transform="rotate(-90 203 132)">OUTPOST / {inspected === 'alpha' ? 'A-01' : 'B-02'}</text></svg>}</div>
            <div className="asset-specs"><div><span>STATUS</span><strong><i />Operational</strong></div><div><span>{inspected === 'rover' ? 'PAYLOAD' : 'HEIGHT'}</span><strong>{inspected === 'rover' ? 'Pressurized cargo' : '51 meters'}</strong></div><div><span>LOCATION</span><strong>Arcadia Planitia</strong></div></div>
            {inspected !== 'rover' ? <button className="primary-button" onClick={() => { const open = engineRef.current?.toggleCargo(inspected) ?? true; setCargoOpen(open); setPanel(null); notify(open ? 'Cargo bay opening.' : 'Cargo bay closing.', `${inspectedSite.name} cargo doors activated.`); }}><DoorOpen size={17} />{cargoOpen ? 'Close cargo bay' : 'Open cargo bay'}<ArrowRight size={17} /></button> : <><button className="primary-button" onClick={() => setManifestOpen(value => !value)}>Cargo manifest<ChevronRight size={17} /></button>{manifestOpen && <div className="cargo-manifest"><div><span>Pressurized oxygen</span><strong>3 modules</strong></div><div><span>Water reserves</span><strong>1,200 L</strong></div><div><span>Destination</span><strong>Starship Alpha</strong></div><p>Simulated mission inventory.</p></div>}</>}
            <span className="asset-disclaimer">CONCEPTUAL EXPEDITION VEHICLE / 3D RECONSTRUCTION</span>
          </>}
        </aside>
      </div>}
    </main>
  );
}
