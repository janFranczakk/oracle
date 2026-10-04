import { useEffect, useState } from 'react';
import {
  ArrowDownRight,
  Circle,
  Copy,
  Focus,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useLab } from '../state/lab';
import type { Body, Command } from '../types';

type Props = { command: (cmd: Command) => Promise<void>; duplicate: (body: Body) => void };
const degrees = (rad: number) => (rad * 180) / Math.PI;
const radians = (deg: number) => (deg * Math.PI) / 180;
const speedOf = (body: Body) => Math.hypot(body.velocity.x, body.velocity.y);

function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="parameter">
      <span>
        <span>{label}</span>
        <strong>
          {value.toFixed(step >= 1 ? 0 : 2)} <small>{unit}</small>
        </strong>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={
          {
            '--range-fill': `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%`,
          } as React.CSSProperties
        }
      />
      <span className="range-bounds">
        <span>{min}</span>
        <span>{max}</span>
      </span>
    </label>
  );
}

export function Inspector({ command, duplicate }: Props) {
  const selectedId = useLab((s) => s.selectedId),
    world = useLab((s) => s.world),
    busy = useLab((s) => s.busy);
  const body = world?.objects.find((o) => o.id === selectedId);
  const [draft, setDraft] = useState<Body | null>(null);
  const [tab, setTab] = useState<'properties' | 'motion'>('properties');
  useEffect(() => {
    setDraft(body || null);
    useLab.getState().set({ preview: null });
  }, [body]);
  if (!body || !draft)
    return (
      <aside className="inspector">
        <div className="panel-heading">
          <SlidersHorizontal size={16} />
          <span>OBJECT INSPECTOR</span>
        </div>
        <div className="empty-inspector">
          <div className="empty-symbol">
            <Focus size={26} />
          </div>
          <h3>Every object has a story.</h3>
          <p>Select a sphere, a block or a surface to inspect its physical state.</p>
          <span className="tag">CLICK AN OBJECT IN THE WORLD</span>
        </div>
        <ModelStatus />
      </aside>
    );
  const disabled = !!world?.playing || !!busy;
  const changed = JSON.stringify(draft) !== JSON.stringify(body);
  const update = (patch: Partial<Body>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    useLab.getState().set({ preview: next });
  };
  const apply = async () => {
    const {
      position,
      velocity,
      mass,
      friction,
      restitution,
      rotation,
      angular_velocity,
      width,
      height,
      radius,
    } = draft;
    await command({
      kind: 'edit',
      object_id: body.id,
      patch: {
        position,
        velocity,
        mass,
        friction,
        restitution,
        rotation,
        angular_velocity,
        width,
        height,
        radius,
      },
    });
    useLab.getState().set({ preview: null });
  };
  const speed = speedOf(draft),
    direction = degrees(Math.atan2(draft.velocity.y, draft.velocity.x));
  return (
    <aside className="inspector">
      <div className="panel-heading">
        <SlidersHorizontal size={15} />
        <span>OBJECT INSPECTOR</span>
        <button aria-label="Deselect object" onClick={() => useLab.getState().select(null)}>
          <X size={14} />
        </button>
      </div>
      <div className="object-identity">
        <div className={`object-symbol ${body.static ? 'is-static' : ''}`}>
          {body.shape === 'circle' ? <Circle size={27} /> : <Square size={25} />}
        </div>
        <div>
          <span className="eyebrow cyan">{body.id.toUpperCase()}</span>
          <h3>{body.label}</h3>
        </div>
        <span className="object-status">{body.static ? 'FIXED' : 'DYNAMIC'}</span>
      </div>
      <div className="inspector-tabs">
        <button
          className={tab === 'properties' ? 'selected' : ''}
          onClick={() => setTab('properties')}
        >
          Properties
        </button>
        <button className={tab === 'motion' ? 'selected' : ''} onClick={() => setTab('motion')}>
          Motion & transform
        </button>
      </div>
      <div className="inspector-content">
        <div className="section-label">
          <span>{tab === 'properties' ? 'PHYSICAL PROPERTIES' : 'WORLD TRANSFORM'}</span>
          <span className={`state-indicator ${world?.playing ? 'amber' : ''}`}>
            <i />
            {world?.playing ? 'LIVE' : 'EDITABLE'}
          </span>
        </div>
        {tab === 'properties' ? (
          <>
            {!body.static && (
              <Slider
                label="Mass"
                value={draft.mass}
                min={0.05}
                max={10}
                unit="kg"
                disabled={disabled}
                onChange={(mass) => update({ mass })}
              />
            )}
            <Slider
              label="Friction"
              value={draft.friction}
              min={0}
              max={1}
              unit="μ"
              disabled={disabled}
              onChange={(friction) => update({ friction })}
            />
            <Slider
              label="Restitution"
              value={draft.restitution}
              min={0}
              max={1}
              unit="e"
              disabled={disabled}
              onChange={(restitution) => update({ restitution })}
            />
            <div className="divider" />
            {body.shape === 'circle' ? (
              <Slider
                label="Radius"
                value={draft.radius}
                min={0.1}
                max={3}
                unit="m"
                disabled={disabled}
                onChange={(radius) => update({ radius })}
              />
            ) : (
              <div className="coordinate-row">
                <Numeric
                  label="Width"
                  value={draft.width}
                  unit="m"
                  disabled={disabled}
                  onChange={(width) => update({ width })}
                />
                <Numeric
                  label="Height"
                  value={draft.height}
                  unit="m"
                  disabled={disabled}
                  onChange={(height) => update({ height })}
                />
              </div>
            )}
            <div className="observation">
              <span className="eyebrow">OBSERVED STATE</span>
              <div>
                <span>Speed</span>
                <strong>
                  {speedOf(body).toFixed(3)} <small>m/s</small>
                </strong>
              </div>
              <div>
                <span>Position</span>
                <strong>
                  {body.position.x.toFixed(2)} <span className="dim">/</span>{' '}
                  {body.position.y.toFixed(2)} <small>m</small>
                </strong>
              </div>
              <div>
                <span>Body type</span>
                <strong>{body.static ? 'Static' : 'Dynamic'}</strong>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="coordinate-row">
              <Numeric
                label="Position X"
                value={draft.position.x}
                unit="m"
                disabled={disabled}
                onChange={(x) => update({ position: { ...draft.position, x } })}
              />
              <Numeric
                label="Position Y"
                value={draft.position.y}
                unit="m"
                disabled={disabled}
                onChange={(y) => update({ position: { ...draft.position, y } })}
              />
            </div>
            <Slider
              label="Rotation"
              value={((((degrees(draft.rotation) + 180) % 360) + 360) % 360) - 180}
              min={-180}
              max={180}
              step={1}
              unit="°"
              disabled={disabled}
              onChange={(angle) => update({ rotation: radians(angle) })}
            />
            {!body.static && (
              <>
                <div className="divider" />
                <Slider
                  label="Velocity"
                  value={speed}
                  min={0}
                  max={15}
                  unit="m/s"
                  disabled={disabled}
                  onChange={(value) =>
                    update({
                      velocity: {
                        x: value * Math.cos(radians(direction)),
                        y: value * Math.sin(radians(direction)),
                      },
                    })
                  }
                />
                <Slider
                  label="Direction"
                  value={direction}
                  min={-180}
                  max={180}
                  step={1}
                  unit="°"
                  disabled={disabled}
                  onChange={(angle) =>
                    update({
                      velocity: {
                        x: speed * Math.cos(radians(angle)),
                        y: speed * Math.sin(radians(angle)),
                      },
                    })
                  }
                />
                <Numeric
                  label="Angular velocity"
                  value={draft.angular_velocity}
                  unit="rad/s"
                  disabled={disabled}
                  onChange={(angular_velocity) => update({ angular_velocity })}
                />
              </>
            )}
          </>
        )}
        {world?.playing && (
          <div className="inline-note">
            <span className="amber">Ⅱ</span> Pause the world to change its conditions.
          </div>
        )}
        {changed && !disabled && (
          <div className="edit-actions">
            <button className="primary" onClick={() => void apply()}>
              Apply to world <ArrowDownRight size={15} />
            </button>
            <button
              onClick={() => {
                setDraft(body);
                useLab.getState().set({ preview: null });
              }}
            >
              Discard
            </button>
            <p>Editing starts a new recording from this frame.</p>
          </div>
        )}
      </div>
      <div className="object-actions">
        <button disabled={disabled} onClick={() => duplicate(body)}>
          <Copy size={14} />
          Duplicate
        </button>
        <button
          className="danger"
          disabled={disabled}
          onClick={() => void command({ kind: 'remove', object_id: body.id })}
        >
          <Trash2 size={14} />
          Remove
        </button>
      </div>
      <ModelStatus />
    </aside>
  );
}

function Numeric({
  label,
  value,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="numeric">
      <span>{label}</span>
      <div>
        <input
          type="number"
          aria-label={label}
          step="0.1"
          value={Number(value.toFixed(3))}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value !== '' && Number.isFinite(Number(e.target.value)))
              onChange(Number(e.target.value));
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}

function ModelStatus() {
  return (
    <div className="model-status">
      <div className="section-label">
        <span>LEARNED WORLD MODEL</span>
        <span className="tag violet">STAGE 3</span>
      </div>
      <div className="model-empty">
        <div className="latent-mark">◈</div>
        <div>
          <strong>No model connected</strong>
          <p>Predictions begin with a trained model.</p>
        </div>
      </div>
      <div className="model-meta">
        <span>Prediction</span>
        <span>Unavailable</span>
      </div>
      <div className="model-meta">
        <span>Confidence</span>
        <span>Not estimated</span>
      </div>
    </div>
  );
}
