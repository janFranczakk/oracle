import { Copy, Plus, RotateCw, Trash2, Undo2 } from 'lucide-react';
import type { Body } from '../types';
import { useBranches } from './state';
import { newObstacle } from './branches';
import type { Patch } from './types';

function Control({
  label,
  value,
  original,
  min,
  max,
  step,
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  original: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <label className="intervention-control">
      <span>
        {label}
        <output>
          <span>{original.toFixed(2)}</span> → <strong>{value.toFixed(2)}</strong> {unit}
        </output>
      </span>
      <div>
        <input
          type="range"
          aria-label={label}
          min={Math.min(min, value, original)}
          max={Math.max(max, value, original)}
          step={step}
          value={Number(value.toFixed(4))}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
        />
        <input
          type="number"
          aria-label={`${label} value`}
          step={step}
          min={min}
          max={max}
          value={Number(value.toFixed(4))}
          onChange={(e) => {
            if (e.target.value) onChange(Number(e.target.value));
          }}
          disabled={disabled}
        />
      </div>
    </label>
  );
}

export function InterventionEditor({
  body,
  original,
  disabled,
}: {
  body: Body | undefined;
  original: Body | undefined;
  disabled: boolean;
}) {
  const draft = useBranches((s) => s.draft);
  const change = (patch: Patch) => {
    if (!body) return;
    const index = draft.findIndex((c) => c.kind === 'update' && c.object_id === body.id);
    const existing = index < 0 ? null : draft[index];
    const next = {
      kind: 'update' as const,
      object_id: body.id,
      patch: { ...(existing?.kind === 'update' ? existing.patch : {}), ...patch },
    };
    if (index < 0 && draft.length >= 4) return;
    useBranches.getState().set({
      draft: index < 0 ? [...draft, next] : draft.map((c, i) => (i === index ? next : c)),
      step: 0,
    });
  };
  const append = (kind: 'wall' | 'box') => {
    const object = newObstacle(kind);
    useBranches
      .getState()
      .set({ draft: [...draft, { kind: 'add', object }], selectedObject: object.id, step: 0 });
  };
  const controlsDisabled =
    disabled ||
    (!draft.some((c) => c.kind === 'update' && c.object_id === body?.id) && draft.length >= 4);
  const baseline = original || body;
  return (
    <section className="intervention-editor">
      <div className="branch-section-title">
        <span className="eyebrow">INTERVENTION PREVIEW</span>
        <button
          disabled={!draft.length || disabled}
          onClick={() => useBranches.getState().set({ draft: [], step: 0 })}
          aria-label="Discard draft"
        >
          <Undo2 size={13} />
        </button>
      </div>
      {body && baseline ? (
        <>
          <div className="intervention-shortcuts">
            <button
              disabled={controlsDisabled || body.mass * 2 > 100 || body.static}
              onClick={() => change({ mass: body.mass * 2 })}
            >
              Mass ×2
            </button>
            <button
              disabled={controlsDisabled || body.static}
              onClick={() =>
                change({ velocity: { x: body.velocity.x * 1.5, y: body.velocity.y * 1.5 } })
              }
            >
              Speed ×1.5
            </button>
            <button
              disabled={controlsDisabled}
              onClick={() => {
                const a = Math.PI / 9;
                change(
                  body.static
                    ? { rotation: body.rotation + a }
                    : {
                        velocity: {
                          x: body.velocity.x * Math.cos(a) - body.velocity.y * Math.sin(a),
                          y: body.velocity.x * Math.sin(a) + body.velocity.y * Math.cos(a),
                        },
                      },
                );
              }}
            >
              <RotateCw size={11} /> +20°
            </button>
          </div>
          {!body.static && (
            <Control
              label="Mass"
              value={body.mass}
              original={baseline.mass}
              min={0.05}
              max={20}
              step={0.05}
              unit="kg"
              onChange={(mass) => change({ mass })}
              disabled={controlsDisabled}
            />
          )}
          {!body.static && (
            <>
              <Control
                label="Velocity x"
                value={body.velocity.x}
                original={baseline.velocity.x}
                min={-20}
                max={20}
                step={0.1}
                unit="m/s"
                onChange={(x) => change({ velocity: { ...body.velocity, x } })}
                disabled={controlsDisabled}
              />
              <Control
                label="Velocity y"
                value={body.velocity.y}
                original={baseline.velocity.y}
                min={-20}
                max={20}
                step={0.1}
                unit="m/s"
                onChange={(y) => change({ velocity: { ...body.velocity, y } })}
                disabled={controlsDisabled}
              />
            </>
          )}
          <Control
            label="Rotation"
            value={(body.rotation * 180) / Math.PI}
            original={(baseline.rotation * 180) / Math.PI}
            min={-180}
            max={180}
            step={1}
            unit="°"
            onChange={(degrees) => change({ rotation: (degrees * Math.PI) / 180 })}
            disabled={controlsDisabled}
          />
          <details>
            <summary>Position, material & geometry</summary>
            <Control
              label="Position x"
              value={body.position.x}
              original={baseline.position.x}
              min={0}
              max={24}
              step={0.1}
              unit="m"
              onChange={(x) => change({ position: { ...body.position, x } })}
              disabled={controlsDisabled}
            />
            <Control
              label="Position y"
              value={body.position.y}
              original={baseline.position.y}
              min={0}
              max={14}
              step={0.1}
              unit="m"
              onChange={(y) => change({ position: { ...body.position, y } })}
              disabled={controlsDisabled}
            />
            <Control
              label="Friction"
              value={body.friction}
              original={baseline.friction}
              min={0}
              max={1}
              step={0.01}
              unit=""
              onChange={(friction) => change({ friction })}
              disabled={controlsDisabled}
            />
            <Control
              label="Restitution"
              value={body.restitution}
              original={baseline.restitution}
              min={0}
              max={1}
              step={0.01}
              unit=""
              onChange={(restitution) => change({ restitution })}
              disabled={controlsDisabled}
            />
            {!body.static && (
              <Control
                label="Angular velocity"
                value={body.angular_velocity}
                original={baseline.angular_velocity}
                min={-20}
                max={20}
                step={0.1}
                unit="rad/s"
                onChange={(angular_velocity) => change({ angular_velocity })}
                disabled={controlsDisabled}
              />
            )}
            {body.shape === 'circle' ? (
              <Control
                label="Radius"
                value={body.radius}
                original={baseline.radius}
                min={0.1}
                max={3}
                step={0.05}
                unit="m"
                onChange={(radius) => change({ radius })}
                disabled={controlsDisabled}
              />
            ) : (
              <>
                <Control
                  label="Width"
                  value={body.width}
                  original={baseline.width}
                  min={0.1}
                  max={30}
                  step={0.1}
                  unit="m"
                  onChange={(width) => change({ width })}
                  disabled={controlsDisabled}
                />
                <Control
                  label="Height"
                  value={body.height}
                  original={baseline.height}
                  min={0.1}
                  max={20}
                  step={0.1}
                  unit="m"
                  onChange={(height) => change({ height })}
                  disabled={controlsDisabled}
                />
              </>
            )}
          </details>
          <div className="intervention-object-actions">
            <button
              disabled={disabled || draft.length >= 4}
              onClick={() => {
                const copy = structuredClone(body);
                copy.id = `copy-${crypto.randomUUID().slice(0, 8)}`;
                copy.label = `${body.label.slice(0, 48)} · copy`;
                copy.position.x += 1.5;
                useBranches.getState().set({
                  draft: [...draft, { kind: 'add', object: copy }],
                  selectedObject: copy.id,
                  step: 0,
                });
              }}
            >
              <Copy size={12} /> Duplicate
            </button>
            <button
              disabled={disabled || draft.length >= 4}
              onClick={() =>
                useBranches.getState().set({
                  draft: [...draft, { kind: 'remove', object_id: body.id }],
                  selectedObject: null,
                  step: 0,
                })
              }
            >
              <Trash2 size={12} /> Remove
            </button>
          </div>
        </>
      ) : (
        <p className="branch-help">
          Select a body in the world or the object list to preview an intervention.
        </p>
      )}
      <div className="intervention-object-actions">
        <button disabled={disabled || draft.length >= 4} onClick={() => append('wall')}>
          <Plus size={12} /> Add wall
        </button>
        <button disabled={disabled || draft.length >= 4} onClick={() => append('box')}>
          <Plus size={12} /> Add block
        </button>
      </div>
      {draft.length > 0 && (
        <p className="branch-draft-note">{draft.length}/4 draft operations · source preserved</p>
      )}
    </section>
  );
}
