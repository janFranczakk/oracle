import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Box,
  ChevronDown,
  Circle,
  Cpu,
  FlaskConical,
  FolderOpen,
  GitBranch,
  Info,
  Layers,
  Orbit,
  Plus,
  Save,
  Square,
  Target,
  X,
} from 'lucide-react';
import { api, openStream } from './api/client';
import { useLab } from './state/lab';
import { WorldViewport } from './rendering/WorldViewport';
import { Inspector } from './components/Inspector';
import { Timeline } from './timeline/Timeline';
import { PredictionPanel } from './prediction/PredictionPanel';
import { ForecastTimeline } from './prediction/ForecastTimeline';
import type { Body, Command, Scene, Shape } from './types';

import type { Snapshot } from './components/ExperimentDialog';
import { ExperimentDialog } from './components/ExperimentDialog';
const Research = lazy(() =>
  import('./research/Research').then((module) => ({ default: module.Research })),
);
const CounterfactualLab = lazy(() =>
  import('./counterfactual/CounterfactualLab').then((module) => ({
    default: module.CounterfactualLab,
  })),
);
const SNAPSHOTS_KEY = 'oracle.snapshots.v1';
const PlanningLab = lazy(() =>
  import('./planning/PlanningLab').then((m) => ({ default: m.PlanningLab })),
);
const sceneTitles: Record<Scene, string> = {
  incline: 'The inclined plane',
  collision: 'Collision chamber',
  empty: 'Blank canvas',
};
function readSnapshots(): Snapshot[] {
  try {
    const value = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
    return Array.isArray(value)
      ? value.filter((v) => v?.data?.schema_version === 1).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}
const newId = () => crypto.randomUUID().slice(0, 8);

export function App() {
  const world = useLab((s) => s.world),
    sessionId = useLab((s) => s.sessionId),
    connection = useLab((s) => s.connection);
  const page = useLab((s) => s.page),
    busy = useLab((s) => s.busy),
    error = useLab((s) => s.error);
  const trails = useLab((s) => s.trails);
  const sidePanel = useLab((s) => s.sidePanel);
  const prediction = useLab((s) => s.prediction);
  const selectedId = useLab((s) => s.selectedId);
  const revision = world?.revision;
  const [modal, setModal] = useState<'scene' | 'snapshots' | 'about' | null>(null);
  const [addMenu, setAddMenu] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState(readSnapshots);
  const [seed, setSeed] = useState('42'),
    [preset, setPreset] = useState<Scene>('incline');
  const socket = useRef<WebSocket | null>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    useLab.getState().set({ connection: 'connecting', error: null });
    const start = async () => {
      try {
        const existing = useLab.getState().sessionId;
        const created = existing
          ? { id: existing, state: await api.state(existing) }
          : await api.create(42, 'incline');
        if (cancelled) return;
        useLab.getState().set({ sessionId: created.id });
        useLab.getState().receive(created.state);
        const ws = openStream(created.id);
        socket.current = ws;
        ws.onopen = () => {
          if (!cancelled) useLab.getState().set({ connection: 'online', error: null });
        };
        ws.onmessage = (event) => {
          if (!cancelled) useLab.getState().receive(JSON.parse(event.data));
        };
        ws.onclose = () => {
          if (!cancelled)
            useLab.getState().set({
              connection: 'offline',
              error: 'The physics engine disconnected. Your saved snapshots are still available.',
            });
        };
        ws.onerror = () => {
          if (!cancelled) useLab.getState().set({ connection: 'offline' });
        };
      } catch {
        if (!cancelled)
          useLab.getState().set({
            connection: 'offline',
            sessionId: null,
            error:
              'Cannot reach the physics engine. Start the backend on port 8011, then reconnect.',
          });
      }
    };
    void start();
    const ping = setInterval(() => {
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send('ping');
    }, 10000);
    return () => {
      cancelled = true;
      clearInterval(ping);
      socket.current?.close();
    };
  }, [retry]);

  useEffect(() => {
    if (!trails || !sessionId || connection !== 'online') return;
    let cancelled = false;
    void api
      .history(sessionId)
      .then(({ frames }) => {
        if (!cancelled) useLab.getState().set({ history: frames });
      })
      .catch(() =>
        useLab
          .getState()
          .set({ error: 'Recorded trails could not be loaded. Try toggling trails again.' }),
      );
    return () => {
      cancelled = true;
    };
  }, [trails, sessionId, connection, revision]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const closeDialog = useCallback(() => setModal(null), []);

  const command = useCallback(async (cmd: Command) => {
    const store = useLab.getState();
    if (!store.sessionId || store.connection !== 'online' || store.busy || inFlight.current) return;
    inFlight.current = true;
    store.set({
      busy: cmd.kind === 'seek' ? 'Replaying observation' : 'Updating world',
      error: null,
    });
    try {
      const state = await api.command(store.sessionId, cmd);
      store.receive(state);
      if (cmd.kind === 'reset')
        store.set({
          selectedId: state.objects.some((o) => o.id === useLab.getState().selectedId)
            ? useLab.getState().selectedId
            : state.objects.find((o) => !o.static)?.id || null,
          preview: null,
          history: [],
          follow: false,
          cameraAction: { kind: 'reset', seq: store.cameraAction.seq + 1 },
        });
    } catch (err) {
      store.set({ error: err instanceof Error ? err.message : 'The world could not be updated.' });
    } finally {
      inFlight.current = false;
      store.set({ busy: null });
    }
  }, []);

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (
        modal ||
        useLab.getState().page !== 'lab' ||
        (e.target instanceof HTMLElement &&
          ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName))
      )
        return;
      if (e.code === 'Space') {
        if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') return;
        e.preventDefault();
        void command({ kind: useLab.getState().world?.playing ? 'pause' : 'play' });
      }
      if (e.key === '.') void command({ kind: 'step' });
      if (e.key.toLowerCase() === 'r') useLab.getState().camera('reset');
      if (e.key === 'Delete' && !useLab.getState().world?.playing && useLab.getState().selectedId)
        void command({ kind: 'remove', object_id: useLab.getState().selectedId! });
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [command, modal]);

  const saveSnapshots = (items: Snapshot[]) => {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(items));
    setSnapshots(items);
  };
  const save = async () => {
    if (!sessionId || busy) return;
    useLab.getState().set({ busy: 'Saving experiment', error: null });
    try {
      const data = await api.export(sessionId);
      saveSnapshots(
        [
          { id: newId(), name: `${sceneTitles[data.origin.scene]} · t${data.playhead}`, data },
          ...snapshots,
        ].slice(0, 8),
      );
      setNotice('Snapshot saved locally. Open the library to restore or export it.');
    } catch {
      useLab.getState().set({
        error: 'The snapshot could not be saved. Check the connection and browser storage.',
      });
    } finally {
      useLab.getState().set({ busy: null });
    }
  };
  const restore = async (data: unknown) => {
    if (!sessionId || busy) return;
    useLab.getState().set({ busy: 'Restoring experiment', error: null });
    try {
      await api.command(sessionId, { kind: 'pause' });
      const state = await api.restore(sessionId, data);
      useLab.getState().receive(state);
      useLab.getState().set({
        preview: null,
        selectedId: state.objects.find((o) => !o.static)?.id || null,
        follow: false,
        cameraAction: { kind: 'reset', seq: useLab.getState().cameraAction.seq + 1 },
      });
      setModal(null);
      setNotice('Experiment restored through deterministic replay.');
    } catch (err) {
      useLab.getState().set({
        error: err instanceof Error ? err.message : 'This experiment could not be restored.',
      });
    } finally {
      useLab.getState().set({ busy: null });
    }
  };
  const loadScene = async () => {
    if (!sessionId || busy) return;
    const n = Number(seed);
    if (!/^\d+$/.test(seed) || !Number.isInteger(n) || n < 0 || n > 2 ** 32 - 1) {
      useLab.getState().set({ error: 'Choose an integer seed between 0 and 4294967295.' });
      return;
    }
    useLab.getState().set({ busy: 'Preparing scene', error: null });
    try {
      const state = await api.scene(sessionId, n, preset);
      useLab.getState().receive(state);
      useLab.getState().set({
        selectedId: state.objects.find((o) => !o.static)?.id || null,
        preview: null,
        history: [],
        follow: false,
        cameraAction: { kind: 'reset', seq: useLab.getState().cameraAction.seq + 1 },
      });
      setModal(null);
    } catch {
      useLab.getState().set({ error: 'The new scene could not be created.' });
    } finally {
      useLab.getState().set({ busy: null });
    }
  };
  const add = (shape: Shape) => {
    const staticBody = ['ramp', 'wall', 'platform'].includes(shape);
    const body: Body = {
      id: `${shape}-${newId()}`,
      label: `${shape[0].toUpperCase()}${shape.slice(1)} specimen`,
      shape,
      static: staticBody,
      position: { x: 12, y: 10 },
      velocity: { x: 0, y: 0 },
      rotation: shape === 'ramp' ? -0.25 : 0,
      angular_velocity: 0,
      mass: 2,
      friction: 0.5,
      restitution: 0.65,
      radius: 0.6,
      width: shape === 'wall' ? 0.3 : staticBody ? 4 : 1.2,
      height: shape === 'wall' ? 4 : staticBody ? 0.3 : 1.2,
    };
    void command({ kind: 'add', object: body }).then(() => {
      if (useLab.getState().world?.objects.some((o) => o.id === body.id))
        useLab.getState().select(body.id);
    });
    setAddMenu(false);
  };
  const duplicate = (body: Body) => {
    const copy = {
      ...body,
      id: `${body.shape}-${newId()}`,
      label: `${body.label.slice(0, 48)} · copy`,
      position: { x: body.position.x + 1.5, y: body.position.y + 1.5 },
    };
    void command({ kind: 'add', object: copy }).then(() => {
      if (useLab.getState().world?.objects.some((o) => o.id === copy.id))
        useLab.getState().select(copy.id);
    });
  };
  const exportFile = (snapshot: Snapshot) => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot.data, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `oracle-${snapshot.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const disabled = connection !== 'online' || !!busy;
  const selected = world?.objects.find((o) => o.id === selectedId);
  const moving = world?.objects.filter((o) => !o.static) || [];
  const kinetic = moving.reduce(
    (sum, o) => sum + 0.5 * o.mass * (o.velocity.x ** 2 + o.velocity.y ** 2),
    0,
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <img src="/oracle.svg" alt="" />
          <div>
            <strong>
              ORACLE<span className="brand-version"> / 08</span>
            </strong>
            <span>COUNTERFACTUAL PHYSICS LAB</span>
          </div>
        </div>
        <nav className="mode-nav" aria-label="Workspace">
          <button
            className={page === 'lab' ? 'selected' : ''}
            onClick={() => useLab.getState().set({ page: 'lab' })}
          >
            <Orbit size={15} />
            Lab
          </button>
          <button
            className={page === 'counterfactual' ? 'selected' : ''}
            onClick={() => useLab.getState().set({ page: 'counterfactual' })}
          >
            <GitBranch size={15} />
            Counterfactual
          </button>
          <button
            className={page === 'research' ? 'selected' : ''}
            onClick={() => useLab.getState().set({ page: 'research' })}
          >
            <FlaskConical size={15} />
            Research<span className="nav-tag">ML</span>
          </button>
          <button
            className={page === 'planning' ? 'selected' : ''}
            onClick={() => useLab.getState().set({ page: 'planning' })}
          >
            <Target size={15} />
            Planning
          </button>
        </nav>
        <div className="header-status">
          <span className={`connection-dot ${connection}`} />
          <span>
            {connection === 'online'
              ? 'ENGINE CONNECTED'
              : connection === 'connecting'
                ? 'CONNECTING'
                : 'ENGINE OFFLINE'}
          </span>
          <span className="version-pill">v0.8.0</span>
        </div>
      </header>
      <div className="app-body">
        <aside className="rail">
          <div>
            <button
              aria-label="Open lab"
              title="Physics lab"
              className={page === 'lab' ? 'active' : ''}
              onClick={() => useLab.getState().set({ page: 'lab' })}
            >
              <Orbit size={21} />
            </button>
            <button
              aria-label="Open research"
              title="Research roadmap"
              className={page === 'research' ? 'active' : ''}
              onClick={() => useLab.getState().set({ page: 'research' })}
            >
              <Activity size={21} />
            </button>
            <button
              aria-label="Snapshot library"
              title="Snapshot library"
              onClick={() => setModal('snapshots')}
            >
              <Layers size={21} />
              {snapshots.length > 0 && <i />}
            </button>
          </div>
          <div>
            <button
              aria-label="About ORACLE"
              title="About & keyboard shortcuts"
              onClick={() => setModal('about')}
            >
              <Info size={20} />
            </button>
            <span className="rail-index">O / 1</span>
          </div>
        </aside>
        <main className="main-content">
          {page === 'lab' ? (
            <>
              <div className="workspace-heading">
                <div>
                  <div className="breadcrumb">
                    WORKSPACE <span>/</span> PREDICTION LAB
                  </div>
                  <h1>
                    {world ? sceneTitles[world.scene] : 'Your physics laboratory'}
                    <span className="tag">LIVE LAB</span>
                  </h1>
                  <p>
                    A controlled world. A reproducible experiment. A starting point for
                    intelligence.
                  </p>
                </div>
                <div className="workspace-actions">
                  <button
                    className="button secondary"
                    onClick={() => {
                      setSeed(String(world?.seed || 42));
                      setPreset(world?.scene || 'incline');
                      setModal('scene');
                    }}
                    disabled={disabled}
                  >
                    <FolderOpen size={15} />
                    Scene library
                  </button>
                  <button
                    className="button primary"
                    onClick={() => void save()}
                    disabled={disabled}
                  >
                    <Save size={15} />
                    Save state
                  </button>
                </div>
              </div>
              <div className="workspace-grid">
                <div className="world-column">
                  <div className="world-panel">
                    <div className="world-toolbar">
                      <div className="scene-meta">
                        <span className="mini-orbit" />
                        <span>WORLD 01</span>
                        <span className="meta-divider" />
                        <span className="dim">SEED</span>
                        <strong>{world?.seed ?? '—'}</strong>
                        <span className="determinism-tag">DETERMINISTIC</span>
                      </div>
                      <div className="add-object">
                        <button
                          className="button small"
                          disabled={disabled || world?.playing}
                          onClick={() => setAddMenu(!addMenu)}
                        >
                          <Plus size={14} />
                          Add object
                          <ChevronDown size={12} />
                        </button>
                        {addMenu && (
                          <>
                            <button
                              className="menu-dismiss"
                              aria-label="Close object menu"
                              onClick={() => setAddMenu(false)}
                            />
                            <div className="add-menu">
                              {(['circle', 'box', 'ramp', 'wall', 'platform'] as Shape[]).map(
                                (shape) => (
                                  <button key={shape} onClick={() => add(shape)}>
                                    {shape === 'circle' ? (
                                      <Circle size={14} />
                                    ) : (
                                      <Square size={14} />
                                    )}
                                    <span>
                                      {shape === 'circle'
                                        ? 'Sphere'
                                        : shape[0].toUpperCase() + shape.slice(1)}
                                    </span>
                                    <Plus size={12} />
                                  </button>
                                ),
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <WorldViewport command={command} />
                    <div className="world-telemetry">
                      <span>
                        <Box size={13} />
                        <strong>{world?.objects.length || 0}</strong> OBJECTS
                      </span>
                      <span>
                        <Activity size={13} />
                        <strong>{kinetic.toFixed(2)}</strong> J{' '}
                        <small>TRANSLATIONAL KINETIC ENERGY</small>
                      </span>
                      <span className="telemetry-tick">
                        <span className="live-dot" />
                        120 Hz <small>PHYSICS</small>
                      </span>
                    </div>
                  </div>
                  <ForecastTimeline />
                  <Timeline command={command} />
                  <div className="lab-footnote">
                    <span>
                      <span className="legend-line" />
                      Actual observation
                    </span>
                    <span className="future-legend">
                      <span className="legend-line violet-line" />
                      Learned future{' '}
                      <span className="tag violet">
                        {prediction
                          ? prediction.model.architecture.family.toUpperCase()
                          : 'READY TO CONNECT'}
                      </span>
                    </span>
                    <span className="lab-footnote-right">
                      {prediction
                        ? `Forecast anchored at t${prediction.anchor.tick}`
                        : 'Observation precedes prediction.'}
                      <ArrowRight size={13} />
                    </span>
                  </div>
                </div>
                <div className="lab-sidebar">
                  <div className="lab-sidebar-tabs" role="tablist" aria-label="Lab tools">
                    <button
                      role="tab"
                      aria-selected={sidePanel === 'prediction'}
                      onClick={() => useLab.getState().set({ sidePanel: 'prediction' })}
                    >
                      Prediction
                    </button>
                    <button
                      role="tab"
                      aria-selected={sidePanel === 'object'}
                      onClick={() => useLab.getState().set({ sidePanel: 'object' })}
                    >
                      Object inspector
                    </button>
                  </div>
                  {sidePanel === 'prediction' ? (
                    <PredictionPanel command={command} />
                  ) : (
                    <Inspector command={command} duplicate={duplicate} />
                  )}
                </div>
              </div>
            </>
          ) : page === 'counterfactual' ? (
            <Suspense
              fallback={
                <div className="research-page" role="status">
                  Loading counterfactual workspace…
                </div>
              }
            >
              <CounterfactualLab />
            </Suspense>
          ) : page === 'planning' ? (
            <Suspense
              fallback={
                <div className="research-page" role="status">
                  Loading planning workspace…
                </div>
              }
            >
              <PlanningLab />
            </Suspense>
          ) : (
            <Suspense
              fallback={
                <div className="research-page" role="status">
                  Loading research workspace…
                </div>
              }
            >
              <Research />
            </Suspense>
          )}
          <footer className="app-footer">
            <span>
              <Cpu size={12} />
              PYMUNK 7.2 <span className="dim">·</span> FIXED Δt 1/120 s
            </span>
            <span>
              {selected && page === 'lab'
                ? `SELECTED / ${selected.id.toUpperCase()}`
                : 'ORACLE / RESEARCH'}
              <span className="dim">·</span> LOCAL SESSION
            </span>
          </footer>
        </main>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <Info size={17} />
          <p>{error}</p>
          {connection === 'offline' && (
            <button onClick={() => setRetry((n) => n + 1)}>Reconnect</button>
          )}
          <button aria-label="Dismiss error" onClick={() => useLab.getState().set({ error: null })}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Save size={15} />
          {notice}
        </div>
      )}
      {busy && ['Restoring experiment', 'Preparing scene', 'Saving experiment'].includes(busy) && (
        <div className="operation-toast" role="status">
          <span className="spinner" />
          {busy}…
        </div>
      )}
      <ExperimentDialog
        modal={modal}
        busy={!!busy}
        disabled={disabled}
        preset={preset}
        setPreset={setPreset}
        seed={seed}
        setSeed={setSeed}
        sceneTitles={sceneTitles}
        snapshots={snapshots}
        onClose={closeDialog}
        onLoadScene={loadScene}
        onRestore={restore}
        onExport={exportFile}
        onImport={() => fileInput.current?.click()}
        onDelete={(id) => {
          try {
            saveSnapshots(snapshots.filter((v) => v.id !== id));
          } catch {
            useLab.getState().set({ error: 'Browser storage could not be updated.' });
          }
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) {
            useLab.getState().set({ error: 'Experiment files must be smaller than 2 MB.' });
            return;
          }
          void file.text().then((value) => {
            try {
              void restore(JSON.parse(value));
            } catch {
              useLab
                .getState()
                .set({ error: 'Malformed experiment: select a valid ORACLE JSON export.' });
            }
          });
        }}
      />
    </div>
  );
}
