import { useEffect, useRef } from 'react';
import { Application, Container, Graphics } from 'pixi.js';
import { Expand, Minus, Plus } from 'lucide-react';
import type { Frame, Vec2 } from '../types';
import { bodyGraphic, ghostGraphic } from '../rendering/graphics';
import { hitTest, scaleFor, screenToWorld } from '../rendering/coordinates';
import type { Camera } from '../rendering/coordinates';
import type { Future } from './types';
import { ghostAlpha, ghostSteps } from '../prediction/forecast';
import { intervalGraphic } from '../rendering/uncertainty';

type Props = {
  title: string;
  frame: Frame;
  anchor: Frame;
  future?: Future;
  other?: { frame: Frame; anchor: Frame; future?: Future; color: number };
  color: number;
  selected: string | null;
  onSelect: (id: string) => void;
  camera: React.RefObject<Camera>;
  subtitle: string;
  goal?: Vec2 & { tolerance_m: number };
  alternatives?: Vec2[][];
};

export function BranchViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const app = new Application(),
      root = new Container(),
      drawing = new Container(),
      grid = new Graphics();
    for (let x = 0; x <= 24; x++) grid.moveTo(x, 0).lineTo(x, 14);
    for (let y = 0; y <= 14; y++) grid.moveTo(0, y).lineTo(24, y);
    grid.stroke({ color: 0x263643, width: 0.018, alpha: 0.6 });
    root.addChild(grid, drawing);
    const camera = { ...latest.current.camera.current };
    let disposed = false,
      previous: Props | null = null;
    let drag: { x: number; y: number; camera: Camera } | null = null;
    const point = (event: PointerEvent | WheelEvent) => {
      const box = element.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const p = point(event),
        state = latest.current;
      const world = screenToWorld(p, camera, element.clientWidth, element.clientHeight);
      const body =
        !event.altKey &&
        state.frame.objects
          .slice()
          .reverse()
          .find((b) => hitTest(world, b));
      if (body) state.onSelect(body.id);
      else drag = { ...p, camera: { ...state.camera.current } };
      element.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!drag) return;
      const p = point(event),
        target = latest.current.camera.current;
      const scale = scaleFor(element.clientWidth, element.clientHeight, target.zoom);
      target.x = drag.camera.x - (p.x - drag.x) / scale;
      target.y = drag.camera.y + (p.y - drag.y) / scale;
    };
    const up = () => {
      drag = null;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const target = latest.current.camera.current,
        p = point(event);
      const before = screenToWorld(p, target, element.clientWidth, element.clientHeight);
      target.zoom = Math.max(0.5, Math.min(3, target.zoom * Math.exp(-event.deltaY * 0.0015)));
      const after = screenToWorld(p, target, element.clientWidth, element.clientHeight);
      target.x += before.x - after.x;
      target.y += before.y - after.y;
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('wheel', wheel, { passive: false });
    const draw = (state: Props) => {
      for (const child of drawing.removeChildren()) child.destroy({ children: true });
      if (state.goal) {
        const marker = new Graphics();
        const { x, y, tolerance_m } = state.goal;
        marker
          .circle(x, y, tolerance_m)
          .fill({ color: 0xdfb978, alpha: 0.08 })
          .stroke({ color: 0xdfb978, width: 0.03, alpha: 0.8 });
        marker
          .moveTo(x - 0.2, y)
          .lineTo(x + 0.2, y)
          .moveTo(x, y - 0.2)
          .lineTo(x, y + 0.2)
          .stroke({ color: 0xdfb978, width: 0.04 });
        drawing.addChild(marker);
      }
      if (state.alternatives) {
        const paths = new Graphics();
        for (const points of state.alternatives) {
          if (!points.length) continue;
          paths.moveTo(points[0].x, points[0].y);
          for (const p of points.slice(1)) paths.lineTo(p.x, p.y);
          paths.stroke({ color: 0xa79ad7, width: 0.018, alpha: 0.2 });
          const end = points[points.length - 1];
          paths.circle(end.x, end.y, 0.06).fill({ color: 0xa79ad7, alpha: 0.4 });
        }
        drawing.addChild(paths);
      }
      const series = [
        { frame: state.frame, anchor: state.anchor, future: state.future, color: state.color },
        ...(state.other ? [state.other] : []),
      ];
      for (const set of series) {
        if (!set.future) continue;
        if (set.future.uncertainty)
          drawing.addChild(intervalGraphic(set.future.uncertainty, set.frame.tick, state.selected));
        const paths = new Graphics();
        for (const body of set.anchor.objects.filter((b) => !b.static)) {
          paths.moveTo(body.position.x, body.position.y);
          for (const frame of set.future.frames) {
            const at = frame.objects.find((b) => b.id === body.id);
            if (at) paths.lineTo(at.position.x, at.position.y);
          }
          paths.stroke({
            color: set.color,
            width: 0.035,
            alpha: !state.selected || state.selected === body.id ? 0.6 : 0.15,
          });
        }
        drawing.addChild(paths);
        for (const step of ghostSteps(set.future.horizon)) {
          const frame = set.future.frames[step - 1];
          for (const body of frame.objects.filter((b) => !b.static)) {
            drawing.addChild(
              ghostGraphic(
                body,
                set.color,
                ghostAlpha(step, set.future.horizon) *
                  (!state.selected || body.id === state.selected ? 1 : 0.3),
              ),
            );
          }
        }
      }
      for (const body of state.frame.objects) {
        const graphic = bodyGraphic(body);
        graphic.position.set(body.position.x, body.position.y);
        graphic.rotation = body.rotation;
        drawing.addChild(graphic);
        if (!body.static && state.future)
          drawing.addChild(ghostGraphic(body, state.color, 0.9, true));
        if (body.id === state.selected) drawing.addChild(ghostGraphic(body, 0xdfb978, 0.9, true));
      }
      if (state.other) {
        const gaps = new Graphics();
        for (const body of state.other.frame.objects) {
          const primary = state.frame.objects.find((b) => b.id === body.id);
          if (body.static && primary && JSON.stringify(body) === JSON.stringify(primary)) continue;
          drawing.addChild(ghostGraphic(body, state.other.color, body.static ? 0.6 : 0.85, true));
          if (primary && !body.static && (!state.selected || state.selected === body.id)) {
            gaps
              .moveTo(primary.position.x, primary.position.y)
              .lineTo(body.position.x, body.position.y)
              .stroke({ color: 0xdfb978, width: 0.035, alpha: 0.8 });
          }
        }
        drawing.addChild(gaps);
      }
    };
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
        app.stage.addChild(root);
        app.ticker.add(() => {
          const state = latest.current,
            target = state.camera.current;
          if (
            app.screen.width !== element.clientWidth ||
            app.screen.height !== element.clientHeight
          )
            app.renderer.resize(element.clientWidth, element.clientHeight);
          if (previous !== state) {
            draw(state);
            previous = state;
          }
          const ease = 1 - Math.exp(-app.ticker.deltaMS / 100);
          camera.x += (target.x - camera.x) * ease;
          camera.y += (target.y - camera.y) * ease;
          camera.zoom += (target.zoom - camera.zoom) * ease;
          const scale = scaleFor(element.clientWidth, element.clientHeight, camera.zoom);
          root.scale.set(scale, -scale);
          root.position.set(
            element.clientWidth / 2 - camera.x * scale,
            element.clientHeight / 2 + camera.y * scale,
          );
        });
      })
      .catch(() => {
        if (!disposed) element.setAttribute('data-render-error', 'true');
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
  }, []);
  return (
    <section className="branch-world">
      <header>
        <div>
          <span className="eyebrow">{props.title}</span>
          <span>{props.subtitle}</span>
        </div>
        <span className="branch-color" style={{ background: `#${props.color.toString(16)}` }} />
      </header>
      <div
        ref={host}
        className="branch-canvas"
        role="img"
        aria-label={`${props.title} — ${props.subtitle}`}
      />
      <div className="branch-camera-tools">
        <button
          title="Zoom out"
          aria-label={`Zoom out ${props.title}`}
          onClick={() => {
            props.camera.current.zoom = Math.max(0.5, props.camera.current.zoom / 1.2);
          }}
        >
          <Minus size={13} />
        </button>
        <button
          title="Reset shared camera"
          aria-label={`Reset camera ${props.title}`}
          onClick={() => {
            Object.assign(props.camera.current, { x: 12, y: 6.6, zoom: 1 });
          }}
        >
          <Expand size={13} />
        </button>
        <button
          title="Zoom in"
          aria-label={`Zoom in ${props.title}`}
          onClick={() => {
            props.camera.current.zoom = Math.min(3, props.camera.current.zoom * 1.2);
          }}
        >
          <Plus size={13} />
        </button>
      </div>
      <span className="branch-scale">SI UNITS · PAN / SCROLL TO ZOOM</span>
    </section>
  );
}
