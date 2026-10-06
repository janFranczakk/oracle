import { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  Expand,
  Focus,
  Grid2X2,
  Minus,
  MoveUpRight,
  Plus,
  Route,
  Scan,
  Target,
} from 'lucide-react';
import type { Body, Command, Vec2 } from '../types';
import { useLab } from '../state/lab';
import { hitTest, scaleFor, screenToWorld, worldToScreen } from './coordinates';
import type { Camera } from './coordinates';
import { frameAt, ghostAlpha, ghostSteps, pairedBodies, trajectory } from '../prediction/forecast';
import { bodyGraphic, ghostGraphic, CURVE_SCALE } from './graphics';

type Props = { command: (value: Command) => Promise<void> };
const HOME: Camera = { x: 12, y: 6.6, zoom: 1 };
export function WorldViewport({ command }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cameraRef = useRef({ ...HOME });
  const [zoom, setZoom] = useState(100);
  const [rendererError, setRendererError] = useState(false);
  const grid = useLab((s) => s.grid),
    vectors = useLab((s) => s.vectors),
    trails = useLab((s) => s.trails);
  const world = useLab((s) => s.world),
    connection = useLab((s) => s.connection);
  const selected = useLab((s) => s.selectedId),
    follow = useLab((s) => s.follow);
  const prediction = useLab((s) => s.prediction);
  const ghosts = useLab((s) => s.ghosts),
    reference = useLab((s) => s.reference),
    errorVectors = useLab((s) => s.errorVectors);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    const app = new Application();
    const root = new Container(),
      bodies = new Container(),
      labels = new Container();
    const gridLines = new Graphics(),
      trajectories = new Graphics(),
      vectorsLayer = new Graphics();
    const selection = new Graphics(),
      preview = new Graphics(),
      impacts = new Graphics();
    const forecastPaths = new Graphics(),
      gaps = new Graphics(),
      forecastBodies = new Container();
    let lastForecast = '';
    impacts.scale.set(1 / CURVE_SCALE);
    const objects = new Map<string, { g: Graphics; label: Text; signature: string }>();
    const target = cameraRef.current;
    const camera = { ...target };
    let lastAction = -1,
      lastGrid = '',
      lastTick = -1,
      lastSelected = '',
      lastHistory = -1;
    let previous = new Map<string, Body>(),
      current = new Map<string, Body>();
    let receivedAt = performance.now();
    let selectionStarted = performance.now();
    let lastRevision = -1;
    let drag: { id: string | null; start: Vec2; camera: Vec2; moved: boolean } | null = null;
    const contactTimes = new Map<string, number>();
    const point = (e: PointerEvent | WheelEvent) => {
      const rect = element.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const dimensions = () => ({ width: element.clientWidth, height: element.clientHeight });
    const down = (e: PointerEvent) => {
      const state = useLab.getState();
      const p = point(e),
        { width, height } = dimensions();
      const at = screenToWorld(p, camera, width, height);
      const hit =
        !e.altKey &&
        e.button === 0 &&
        state.world?.objects
          .slice()
          .reverse()
          .find((o) => hitTest(at, o));
      if (hit) state.select(hit.id);
      else if (e.button === 0 && !e.altKey) state.select(null);
      drag = {
        id: hit && !state.world?.playing && !state.busy ? hit.id : null,
        start: p,
        camera: { x: target.x, y: target.y },
        moved: false,
      };
      element.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const p = point(e),
        { width, height } = dimensions();
      if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 3) drag.moved = true;
      if (drag.id && drag.moved) {
        useLab.getState().set({ preview: { position: screenToWorld(p, camera, width, height) } });
      } else if (!drag.id && drag.moved) {
        useLab.getState().set({ follow: false });
        const scale = scaleFor(width, height, target.zoom);
        target.x = drag.camera.x - (p.x - drag.start.x) / scale;
        target.y = drag.camera.y + (p.y - drag.start.y) / scale;
      }
    };
    const up = () => {
      const state = useLab.getState();
      if (drag?.id && drag.moved && state.preview?.position) {
        void command({
          kind: 'edit',
          object_id: drag.id,
          patch: { position: state.preview.position },
        });
      }
      state.set({ preview: null });
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = point(e),
        { width, height } = dimensions();
      const before = screenToWorld(p, target, width, height);
      target.zoom = Math.max(0.5, Math.min(3, target.zoom * Math.exp(-e.deltaY * 0.0015)));
      const after = screenToWorld(p, target, width, height);
      target.x += before.x - after.x;
      target.y += before.y - after.y;
      setZoom(Math.round(target.zoom * 100));
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('wheel', wheel, { passive: false });

    void app
      .init({
        backgroundAlpha: 0,
        resizeTo: element,
        antialias: true,
        resolution: Math.min(devicePixelRatio, 2),
        autoDensity: true,
        preference: 'webgl',
      })
      .then(() => {
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }
        element.appendChild(app.canvas);
        root.addChild(
          gridLines,
          trajectories,
          forecastPaths,
          forecastBodies,
          gaps,
          bodies,
          vectorsLayer,
          preview,
          selection,
          impacts,
        );
        app.stage.addChild(root, labels);
        app.ticker.add(() => {
          const s = useLab.getState(),
            state = s.world;
          const { width, height } = dimensions();
          if (!state) return;
          if (s.cameraAction.seq !== lastAction) {
            lastAction = s.cameraAction.seq;
            const obj = state.objects.find((o) => o.id === s.selectedId);
            if (s.cameraAction.kind === 'focus' && obj)
              Object.assign(target, { ...obj.position, zoom: 1.7 });
            else Object.assign(target, HOME);
            setZoom(Math.round(target.zoom * 100));
          }
          const focused = state.objects.find((o) => o.id === s.selectedId);
          if (s.follow && focused) {
            target.x = focused.position.x;
            target.y = focused.position.y;
          }
          const ease = 1 - Math.exp(-app.ticker.deltaMS / 100);
          camera.x += (target.x - camera.x) * ease;
          camera.y += (target.y - camera.y) * ease;
          camera.zoom += (target.zoom - camera.zoom) * ease;
          const scale = scaleFor(width, height, camera.zoom);
          root.scale.set(scale, -scale);
          root.position.set(width / 2 - camera.x * scale, height / 2 + camera.y * scale);
          const prediction = s.prediction;
          const forecastKey = `${prediction?.created_at}-${s.forecastStep}-${s.selectedId}-${s.ghosts}-${s.reference}-${s.errorVectors}`;
          if (forecastKey !== lastForecast) {
            lastForecast = forecastKey;
            forecastPaths.clear();
            gaps.clear();
            for (const child of forecastBodies.removeChildren()) child.destroy();
            if (prediction) {
              const dynamic = prediction.anchor_frame.objects.filter((body) => !body.static);
              for (const body of dynamic) {
                const focus = !s.selectedId || body.id === s.selectedId;
                for (const actual of [false, true]) {
                  if (actual ? !s.reference : !s.ghosts) continue;
                  const points = trajectory(prediction, body.id, actual);
                  forecastPaths.moveTo(points[0].x, points[0].y);
                  for (const point of points.slice(1)) forecastPaths.lineTo(point.x, point.y);
                  forecastPaths.stroke({
                    color: actual ? 0x93e3eb : 0xa79ad7,
                    width: actual ? 0.025 : 0.04,
                    alpha: focus ? (actual ? 0.4 : 0.65) : 0.16,
                  });
                }
              }
              if (s.ghosts)
                for (const step of ghostSteps(prediction.horizon)) {
                  for (const body of frameAt(prediction, step).objects.filter(
                    (body) => !body.static,
                  ))
                    forecastBodies.addChild(
                      ghostGraphic(
                        body,
                        0xa79ad7,
                        ghostAlpha(step, prediction.horizon) *
                          (!s.selectedId || s.selectedId === body.id ? 1 : 0.4),
                      ),
                    );
                }
              for (const pair of pairedBodies(prediction, s.forecastStep)) {
                const focus = !s.selectedId || pair.actual.id === s.selectedId;
                if (s.ghosts)
                  forecastBodies.addChild(
                    ghostGraphic(pair.predicted, 0xc3b6f1, focus ? 0.85 : 0.28, true),
                  );
                if (s.reference)
                  forecastBodies.addChild(
                    ghostGraphic(pair.actual, 0x93e3eb, focus ? 0.75 : 0.25, true),
                  );
                if (s.errorVectors && s.forecastStep > 0) {
                  const a = pair.actual.position,
                    p = pair.predicted.position;
                  gaps
                    .moveTo(a.x, a.y)
                    .lineTo(p.x, p.y)
                    .stroke({ color: 0xdfb978, width: 0.025, alpha: focus ? 0.8 : 0.15 });
                  gaps.circle(p.x, p.y, 0.065).fill({ color: 0xdfb978, alpha: focus ? 0.8 : 0.15 });
                }
              }
            }
          }
          const gridKey = `${s.grid}-${width}-${height}-${Math.round(camera.zoom * 100)}`;
          if (gridKey !== lastGrid) {
            lastGrid = gridKey;
            gridLines.clear();
            if (s.grid) {
              for (let x = -24; x <= 48; x++) gridLines.moveTo(x, -14).lineTo(x, 28);
              for (let y = -14; y <= 28; y++) gridLines.moveTo(-24, y).lineTo(48, y);
              gridLines.stroke({ color: 0x385264, width: 0.65 / scale, alpha: 0.19 });
              for (let x = -24; x <= 48; x += 4)
                for (let y = -12; y <= 28; y += 4)
                  gridLines.circle(x, y, 1.2 / scale).fill({ color: 0x678496, alpha: 0.23 });
            }
          }
          const changed =
            state.tick !== lastTick ||
            state.revision !== lastRevision ||
            s.selectedId !== lastSelected;
          if (changed) {
            if (s.selectedId !== lastSelected) selectionStarted = performance.now();
            const reset = state.revision !== lastRevision || state.tick <= lastTick;
            previous = reset ? new Map(state.objects.map((o) => [o.id, o])) : current;
            current = new Map(state.objects.map((o) => [o.id, o]));
            receivedAt = performance.now();
            lastTick = state.tick;
            lastRevision = state.revision;
            lastSelected = s.selectedId || '';
            for (const id of state.collisions) contactTimes.set(id, performance.now());
            for (const [id, entry] of objects)
              if (!current.has(id)) {
                entry.g.destroy();
                entry.label.destroy();
                objects.delete(id);
              }
            for (const body of state.objects) {
              const signature = `${body.shape}-${body.radius}-${body.width}-${body.height}-${body.static}`;
              let entry = objects.get(body.id);
              if (entry?.signature !== signature) {
                entry?.g.destroy();
                entry?.label.destroy();
                const g = bodyGraphic(body);
                const label = new Text({
                  text: body.id.toUpperCase(),
                  style: {
                    fontFamily: 'IBM Plex Mono',
                    fontSize: 10,
                    letterSpacing: 1.4,
                    fill: 0x708b9c,
                  },
                });
                label.anchor.set(0.5, 0);
                label.visible = !body.static;
                bodies.addChild(g);
                labels.addChild(label);
                entry = { g, label, signature };
                objects.set(body.id, entry);
              }
            }
          }
          const alpha = state.playing ? Math.min(1, (performance.now() - receivedAt) / 50) : 1;
          vectorsLayer.clear();
          selection.clear();
          preview.clear();
          impacts.clear();
          for (const body of state.objects) {
            const entry = objects.get(body.id)!;
            const old = previous.get(body.id) || body;
            const p = {
              x: old.position.x + (body.position.x - old.position.x) * alpha,
              y: old.position.y + (body.position.y - old.position.y) * alpha,
            };
            entry.g.position.set(p.x, p.y);
            entry.g.rotation = old.rotation + (body.rotation - old.rotation) * alpha;
            const screen = worldToScreen(
              { x: p.x, y: p.y - (body.shape === 'circle' ? body.radius : body.height / 2) },
              camera,
              width,
              height,
            );
            entry.label.position.set(screen.x, screen.y + 12);
            entry.label.style.fill = body.id === s.selectedId ? 0x91dce4 : 0x708b9c;
            if (s.vectors && !body.static) {
              const end = { x: p.x + body.velocity.x * 0.35, y: p.y + body.velocity.y * 0.35 };
              if (Math.hypot(end.x - p.x, end.y - p.y) > 0.18) {
                const a = Math.atan2(end.y - p.y, end.x - p.x);
                vectorsLayer
                  .moveTo(p.x, p.y)
                  .lineTo(end.x, end.y)
                  .stroke({ color: 0xa4bac5, width: 1 / scale, alpha: 0.52 });
                vectorsLayer
                  .moveTo(end.x - 0.18 * Math.cos(a - 0.5), end.y - 0.18 * Math.sin(a - 0.5))
                  .lineTo(end.x, end.y)
                  .lineTo(end.x - 0.18 * Math.cos(a + 0.5), end.y - 0.18 * Math.sin(a + 0.5))
                  .stroke({ color: 0xa4bac5, width: 1 / scale, alpha: 0.52 });
              }
            }
            if (body.id === s.selectedId) {
              const curveScale = body.shape === 'circle' ? CURVE_SCALE : 1;
              selection.scale.set(1 / curveScale);
              if (body.shape === 'circle')
                selection.circle(0, 0, (body.radius + 0.15) * curveScale);
              else
                selection.rect(
                  -body.width / 2 - 0.1,
                  -body.height / 2 - 0.1,
                  body.width + 0.2,
                  body.height + 0.2,
                );
              selection.stroke({
                color: 0x91e4ed,
                width: (1.3 / scale) * curveScale,
                alpha: 0.85 * Math.min(1, (performance.now() - selectionStarted) / 180),
              });
              selection.position.set(p.x, p.y);
              selection.rotation = body.rotation;
              if (s.preview) {
                const previewBody = { ...body, ...s.preview };
                preview.scale.set(1 / curveScale);
                preview.rect(
                  -previewBody.width / 2,
                  -previewBody.height / 2,
                  previewBody.width,
                  previewBody.height,
                );
                if (body.shape === 'circle') {
                  preview.clear();
                  preview.circle(0, 0, previewBody.radius * curveScale);
                }
                preview
                  .fill({ color: 0x9eeaf2, alpha: 0.12 })
                  .stroke({ color: 0x9eeaf2, width: curveScale / scale, alpha: 0.8 });
                preview.position.set(previewBody.position.x, previewBody.position.y);
                preview.rotation = previewBody.rotation;
                if (!body.static) {
                  const start = previewBody.position;
                  const end = {
                    x: start.x + previewBody.velocity.x * 0.35,
                    y: start.y + previewBody.velocity.y * 0.35,
                  };
                  vectorsLayer
                    .moveTo(start.x, start.y)
                    .lineTo(end.x, end.y)
                    .stroke({ color: 0x93e3eb, width: 1.7 / scale, alpha: 0.9 });
                }
              }
            }
            const contactAt = contactTimes.get(body.id);
            const age = contactAt === undefined ? Infinity : performance.now() - contactAt;
            if (age < 350 && !body.static)
              impacts
                .circle(
                  p.x * CURVE_SCALE,
                  p.y * CURVE_SCALE,
                  (body.radius + 0.2 + age / 900) * CURVE_SCALE,
                )
                .stroke({
                  color: 0xc5f0ed,
                  width: (1.2 / scale) * CURVE_SCALE,
                  alpha: (1 - age / 350) * 0.65,
                });
          }
          if (changed || s.history.length !== lastHistory || trajectories.visible !== s.trails) {
            lastHistory = s.history.length;
            trajectories.clear();
            trajectories.visible = s.trails;
            if (s.trails)
              for (const body of state.objects.filter((o) => !o.static)) {
                const points = s.history
                  .filter((f) => f.tick <= state.tick)
                  .map((f) => f.objects.find((o) => o.id === body.id)?.position)
                  .filter((p): p is Vec2 => !!p);
                if (points.length > 1) {
                  trajectories.moveTo(points[0].x, points[0].y);
                  for (const p of points.slice(1)) trajectories.lineTo(p.x, p.y);
                  trajectories.stroke({
                    color: 0xd1e1e6,
                    width: 0.025,
                    alpha: body.id === s.selectedId ? 0.55 : 0.22,
                  });
                }
              }
          }
        });
      })
      .catch(() => {
        if (!disposed) setRendererError(true);
      });
    return () => {
      disposed = true;
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      element.removeEventListener('wheel', wheel);
      if (app.renderer) app.destroy(true, { children: true });
    };
  }, [command]);

  const cameraAction = (kind: 'reset' | 'focus') => useLab.getState().camera(kind);
  const zoomBy = (amount: number) => {
    cameraRef.current.zoom = Math.max(0.5, Math.min(3, cameraRef.current.zoom * amount));
    setZoom(Math.round(cameraRef.current.zoom * 100));
  };
  return (
    <div className="viewport">
      <div ref={host} className="pixi-host" aria-label="Interactive ground-truth physics world" />
      <div className="viewport-top">
        <div className="viewport-label">
          <span className="live-dot" />
          GROUND TRUTH <span className="dim">/</span> <span className="dim">PYMUNK 2D</span>
        </div>
        <span className="scene-scale">24 × 14 m</span>
      </div>
      {prediction && (
        <div className="forecast-legend">
          {ghosts && (
            <span>
              <i />
              Learned future
            </span>
          )}
          {reference && (
            <span className="truth">
              <i />
              Pymunk actual
            </span>
          )}
          {errorVectors && (
            <span className="error">
              <i />
              Position gap
            </span>
          )}
        </div>
      )}
      <div className="viewport-caption">
        <span className="eyebrow">EXPERIMENT 001</span>
        <h2>A world in motion.</h2>
        <p>Observe. Pause. Change the conditions.</p>
      </div>
      <div className="view-tools">
        <button
          aria-label="Toggle grid"
          title="Grid"
          className={grid ? 'active' : ''}
          onClick={() => useLab.getState().set({ grid: !grid })}
        >
          <Grid2X2 size={16} />
        </button>
        <button
          aria-label="Toggle velocity vectors"
          title="Velocity vectors"
          className={vectors ? 'active' : ''}
          onClick={() => useLab.getState().set({ vectors: !vectors })}
        >
          <MoveUpRight size={16} />
        </button>
        <button
          aria-label="Toggle recorded trails"
          title="Recorded ground-truth trails"
          className={trails ? 'active' : ''}
          onClick={() => useLab.getState().set({ trails: !trails })}
        >
          <Route size={16} />
        </button>
        <i />
        <button
          aria-label="Focus selected object"
          title="Focus selected object"
          disabled={!selected}
          onClick={() => cameraAction('focus')}
        >
          <Focus size={16} />
        </button>
        <button
          aria-label="Follow selected object"
          title="Follow selected object"
          disabled={!selected}
          className={follow ? 'active' : ''}
          onClick={() => useLab.getState().set({ follow: !follow })}
        >
          <Target size={16} />
        </button>
        <button
          aria-label="Reset camera"
          title="Reset camera · R"
          onClick={() => cameraAction('reset')}
        >
          <Expand size={16} />
        </button>
      </div>
      <div className="viewport-bottom">
        <div className="view-hint">
          <Scan size={13} />
          <span>
            {world?.playing ? 'Pause to edit objects' : 'Select an object · drag to reposition'}
          </span>
        </div>
        <div className="zoom-controls">
          <button aria-label="Zoom out" onClick={() => zoomBy(0.85)}>
            <Minus size={14} />
          </button>
          <span>{zoom}%</span>
          <button aria-label="Zoom in" onClick={() => zoomBy(1.15)}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      <div className="axis-indicator">
        <span>Y</span>
        <svg viewBox="0 0 44 44">
          <path d="M10 34V9m0 25h25M7 13l3-4 3 4m18 18 4 3-4 3" />
        </svg>
        <span>X</span>
      </div>
      {(connection !== 'online' || rendererError) && (
        <div className="viewport-overlay">
          <div className="loader-ring" />
          <h3>
            {rendererError
              ? 'Renderer unavailable'
              : connection === 'connecting'
                ? 'Preparing your laboratory'
                : 'World connection interrupted'}
          </h3>
          <p>
            {rendererError
              ? 'This laboratory requires a browser with WebGL enabled.'
              : connection === 'connecting'
                ? 'Connecting to the ground-truth engine…'
                : 'Reconnect to continue your experiment.'}
          </p>
        </div>
      )}
    </div>
  );
}
