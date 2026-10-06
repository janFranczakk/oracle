import { useEffect, useRef, useState } from 'react';
import {
  Crosshair,
  Download,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Target,
} from 'lucide-react';
import { api, request } from '../api/client';
import { useLab } from '../state/lab';
import { BranchViewport } from '../counterfactual/BranchViewport';
import type { ModelCatalog } from '../prediction/types';
import type { Camera } from '../rendering/coordinates';
import {
  atStep,
  goalFromControls,
  matchesControls,
  planningApi,
  searchRequest,
  usePlanning,
} from './planning';
import './planning.css';
import '../counterfactual/counterfactual.css';

const measured = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(3));
export function PlanningLab() {
  const world = useLab((s) => s.world),
    sid = useLab((s) => s.sessionId);
  const busy = useLab((s) => s.busy),
    connection = useLab((s) => s.connection);
  const state = usePlanning();
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const camera = useRef<Camera>({ x: 12, y: 6.6, zoom: 1 });
  const model = catalog?.models.find((m) => m.id === state.modelId);
  const report = state.owner === sid ? state.report : null;
  const shown = report && matchesControls(report, state) ? report : null;
  const future = shown?.prediction;
  const actual = shown?.verification?.reality;
  const anchor = future?.anchor_frame || world;
  const missing =
    world && model
      ? Math.max(
          0,
          world.last_edit_tick +
            (model.architecture.history - 1) * model.sample_stride -
            world.tick,
        )
      : 0;
  const disabled = !!busy || !world || !sid || connection !== 'online';
  let goal;
  try {
    goal = goalFromControls(state);
  } catch {
    goal = undefined;
  }
  const refresh = async () => {
    const value = await request<ModelCatalog>('/prediction/models');
    setCatalog(value);
    if (!value.models.some((m) => m.id === usePlanning.getState().modelId))
      usePlanning.getState().set({
        modelId: value.models.find((m) => m.id === 'stage3-gru')?.id || value.models[0]?.id || '',
      });
  };
  useEffect(() => {
    void refresh().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'Models unavailable.'),
    );
  }, []);
  useEffect(() => {
    if (!playing || !future) return;
    const timer = setInterval(
      () => {
        const step = usePlanning.getState().step;
        if (step >= future.horizon) setPlaying(false);
        else usePlanning.getState().set({ step: step + 1 });
      },
      Math.max(16, future.sample_dt * 1000),
    );
    return () => clearInterval(timer);
  }, [playing, future]);
  const perform = async (label: string, action: () => Promise<void>) => {
    if (useLab.getState().busy) return;
    useLab.getState().set({ busy: label });
    setError(null);
    setPlaying(false);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Planning failed. Try again.');
    } finally {
      useLab.getState().set({ busy: null });
    }
  };
  const selected = shown?.candidates.find((c) => c.id === shown.selected_id);
  const frozenGoal = shown?.request.goal || goal;
  const field = (
    label: string,
    key: 'x' | 'y' | 'tolerance' | 'delta' | 'horizon',
    step: number,
    min: number,
    max: number,
  ) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        step={step}
        min={min}
        max={max}
        value={state[key]}
        disabled={!!busy}
        onChange={(e) => state.set({ [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="planning-lab">
      <header className="workspace-heading planning-heading">
        <div>
          <div className="breadcrumb">
            WORKSPACE <span>/</span> LEARNED PLANNING
          </div>
          <h1>
            A goal. Nine possible moves.<span className="tag violet">STAGE 08</span>
          </h1>
          <p>Search with learned dynamics. Verify the chosen future in reality.</p>
        </div>
        <div className="workspace-actions">
          <button
            className="button"
            disabled={disabled}
            onClick={() => void perform('Refreshing planning models', refresh)}
          >
            <RefreshCw size={13} />
            Models
          </button>
          {world?.playing && (
            <button
              className="button"
              disabled={disabled}
              onClick={() =>
                void perform('Pausing source', async () => {
                  if (sid) useLab.getState().receive(await api.command(sid, { kind: 'pause' }));
                })
              }
            >
              <Pause size={13} />
              Pause source
            </button>
          )}
          {missing > 0 && (
            <button
              className="button"
              disabled={disabled || world?.playing}
              onClick={() =>
                void perform('Recording planning observations', async () => {
                  if (!sid) return;
                  let remaining = missing;
                  while (remaining > 0) {
                    const count = Math.min(600, remaining);
                    useLab
                      .getState()
                      .receive(await api.command(sid, { kind: 'step', steps: count }));
                    remaining -= count;
                  }
                })
              }
            >
              Record {missing} ticks
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="planning-error" role="alert">
          {error}
        </div>
      )}
      <div className="planning-source">
        <Crosshair size={13} />
        <span>
          {busy === 'Searching learned futures'
            ? 'Evaluating nine learned candidates…'
            : shown
              ? `FROZEN SOURCE / t ${shown.plan.snapshot.frame.tick} · ${shown.request.object_id}`
              : `LIVE SOURCE / t ${world?.tick ?? 0}`}
        </span>
        <span>
          {shown
            ? 'Action search and verification leave the live world untouched.'
            : 'Pause and record real history before searching.'}
        </span>
        <span>
          {shown ? `${shown.elapsed_seconds.toFixed(2)} s / CPU` : 'DETERMINISTIC POINT ROLLOUT'}
        </span>
      </div>
      <div className="planning-workspace">
        <section className="planning-evidence" aria-label="Planning trajectories and candidates">
          {anchor && (
            <BranchViewport
              title="GOAL / SELECTED FUTURE"
              subtitle={
                shown
                  ? `${shown.selected_id} · +${state.step} / ${shown.request.horizon} observations`
                  : 'Goal preview · observed source'
              }
              frame={future ? atStep(future, state.step) : anchor}
              anchor={anchor}
              future={future}
              other={
                actual && future
                  ? {
                      frame: atStep(actual, state.step),
                      anchor: actual.anchor_frame,
                      future: actual,
                      color: 0x93e3eb,
                    }
                  : undefined
              }
              color={0xa79ad7}
              selected={shown?.request.object_id || state.objectId}
              onSelect={(id) => {
                if (!shown && world?.objects.some((b) => b.id === id && !b.static))
                  state.set({ objectId: id });
              }}
              camera={camera}
              goal={frozenGoal}
              alternatives={shown?.candidates
                .filter((c) => c.id !== shown.selected_id)
                .map((c) => c.trajectory.map((p) => p.position))}
            />
          )}
          <div className="planning-timeline" aria-label="Planning future cursor">
            <button
              aria-label="Play planning future"
              disabled={!future || !!busy}
              onClick={() => {
                if (future && state.step >= future.horizon) state.set({ step: 0 });
                setPlaying((p) => !p);
              }}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <span>FUTURE / +{future ? state.step : 0}</span>
            <input
              aria-label="Planning future step"
              type="range"
              min={0}
              max={future?.horizon || 0}
              disabled={!future}
              value={future ? state.step : 0}
              onChange={(e) => {
                setPlaying(false);
                state.set({ step: Number(e.target.value) });
              }}
            />
            <span>{future ? (state.step * future.sample_dt).toFixed(3) : '0.000'} s</span>
          </div>
          <div className="planning-ranking">
            <header>
              <span className="eyebrow">CANDIDATE ACTIONS / LEARNED RANKING</span>
              <span>
                {shown ? 'Endpoint distance · metres' : 'Baseline + eight velocity offsets'}
              </span>
            </header>
            {shown ? (
              <div className="planning-candidates">
                {shown.candidates.map((c, i) => (
                  <div
                    key={c.id}
                    className={`planning-candidate ${c.id === shown.selected_id ? 'winner' : ''}`}
                  >
                    <span>
                      {String(i + 1).padStart(2, '0')} /{' '}
                      {c.id === 'baseline' ? 'UNCHANGED' : c.id.toUpperCase()}
                    </span>
                    <strong>
                      {measured(c.goal_distance_m)}
                      <small> m</small>
                    </strong>
                    <span>
                      v ({c.velocity.x.toFixed(1)}, {c.velocity.y.toFixed(1)}) m/s
                    </span>
                    <small>
                      {c.id === shown.selected_id
                        ? 'SELECTED BY MODEL'
                        : c.predicted_within_goal
                          ? 'PREDICTED WITHIN GOAL'
                          : `Δv ${c.velocity_change_m_s.toFixed(2)} m/s`}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="planning-empty">
                <Target size={22} />
                <p>
                  {report
                    ? 'Goal or search settings changed. Run a new search to measure these candidates.'
                    : 'Set a terminal position goal. The model will roll out each action and choose the nearest endpoint.'}
                </p>
              </div>
            )}
          </div>
        </section>
        <aside className="planning-mission" aria-label="Planning goal and measurements">
          <div className="planning-mission-title">
            <Target size={15} />
            <span className="eyebrow">TERMINAL POSITION GOAL</span>
          </div>
          <div className="planning-goal-readout">
            <strong>
              ({goal ? measured(goal.x) : '—'}, {goal ? measured(goal.y) : '—'}) m
            </strong>
            <span>
              {state.objectId} · tolerance {goal ? measured(goal.tolerance_m) : '—'} m
            </span>
          </div>
          <details
            className="planning-settings"
            open={settingsOpen}
            onToggle={(e) => setSettingsOpen(e.currentTarget.open)}
          >
            <summary>Goal & search settings</summary>
            <label>
              CONTROLLED OBJECT
              <select
                aria-label="Planning object"
                value={state.objectId}
                disabled={!!busy}
                onChange={(e) => state.set({ objectId: e.target.value })}
              >
                {world?.objects
                  .filter((b) => !b.static)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label} · {b.id}
                    </option>
                  ))}
              </select>
            </label>
            <div className="planning-goal-fields">
              {field('Goal X · m', 'x', 0.1, 0, 24)}
              {field('Goal Y · m', 'y', 0.1, 0, 14)}
            </div>
            {field('Goal tolerance · m', 'tolerance', 0.05, 0.05, 3)}
            <label>
              WORLD MODEL
              <select
                aria-label="Planning model"
                value={state.modelId}
                disabled={!!busy}
                onChange={(e) => state.set({ modelId: e.target.value })}
              >
                {!catalog?.models.length && <option value="">No completed checkpoints</option>}
                {catalog?.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.architecture.family.toUpperCase()} · {m.id}
                  </option>
                ))}
              </select>
            </label>
            {field('Observed horizon', 'horizon', 1, 1, 120)}
            {field('Velocity grid step · m/s', 'delta', 0.1, 0.1, 15)}
            <p className="planning-caption">
              One velocity change at the observed anchor. Nine fixed candidates; baseline included.
              Choose nearest predicted endpoint, then smaller Δv on ties.
            </p>
          </details>
          <button
            className="button primary planning-action"
            disabled={
              disabled || world?.playing || missing > 0 || !model || !catalog?.torch_available
            }
            onClick={() =>
              void perform('Searching learned futures', async () => {
                if (!sid || !world) return;
                const result = await planningApi.search(sid, searchRequest(world, state));
                state.set({ owner: sid, report: result, step: result.request.horizon });
                setSettingsOpen(false);
              })
            }
          >
            {busy === 'Searching learned futures' ? (
              <LoaderCircle size={14} />
            ) : (
              <Target size={14} />
            )}
            Search learned futures
          </button>
          <div className="planning-score">
            <span>PREDICTED GOAL DISTANCE</span>
            <strong>
              {measured(selected?.goal_distance_m)}
              <small> m</small>
            </strong>
            <p>
              {selected
                ? selected.predicted_within_goal
                  ? 'Predicted endpoint is within goal tolerance.'
                  : 'No candidate is predicted to reach the goal tolerance.'
                : 'Awaiting a learned search.'}
            </p>
          </div>
          <button
            className="button planning-action"
            disabled={disabled || !shown}
            onClick={() =>
              void perform('Verifying chosen action in reality', async () => {
                if (sid && shown) {
                  const result = await planningApi.reality(sid, shown.id);
                  state.set({ owner: sid, report: result });
                }
              })
            }
          >
            <ShieldCheck size={14} />
            Run reality
          </button>
          <div className="planning-score actual">
            <span>ACTUAL GOAL DISTANCE</span>
            <strong>
              {measured(shown?.verification?.actual_goal_distance_m)}
              <small> m</small>
            </strong>
            <p>
              {shown?.verification
                ? `${shown.verification.actual_within_goal ? 'Goal reached' : 'Goal not reached'} · target FDE ${measured(shown.verification.target_error.fde_m)} m. Learned ranking remains fixed.`
                : 'Execute the chosen action separately to measure its physical endpoint.'}
            </p>
          </div>
          <p className="planning-caption">
            Violet: learned future · cyan: explicit reality · amber: goal. These checkpoints were
            trained on ordinary observations; action conditioning is exploratory. Goal attainment is
            a prediction until verified.
          </p>
          {shown && (
            <>
              <button
                className="button planning-action"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(shown, null, 2)], { type: 'application/json' }),
                  );
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `oracle-planning-${shown.id}.json`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 0);
                }}
              >
                <Download size={13} />
                Export planning report
              </button>
              <details className="planning-provenance">
                <summary>Source, weights & search protocol</summary>
                <p>
                  {shown.model.id} · epoch {shown.model.epoch} · {shown.model.architecture.history}{' '}
                  real observations · {shown.model.sample_dt.toFixed(4)} s stride
                </p>
                <code>{shown.model.sha256}</code>
                <p>Search SHA-256</p>
                <code>{shown.search_sha256}</code>
                <p>
                  {shown.runtime.device} / {shown.runtime.threads} threads · PyTorch{' '}
                  {shown.runtime.torch}. Finite grid search; no global optimality or calibrated
                  confidence.
                </p>
              </details>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
