import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Download,
  Fingerprint,
  GitBranch,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { api, request } from '../api/client';
import { useLab } from '../state/lab';
import { useBranches } from './state';
import {
  aligned,
  applyChanges,
  branchApi,
  changeSummary,
  differences,
  measured,
  sampledFrame,
  treeRows,
} from './branches';
import { BranchViewport } from './BranchViewport';
import { InterventionEditor } from './InterventionEditor';
import type { Camera } from '../rendering/coordinates';
import type { ModelCatalog } from '../prediction/types';
import { ModelDiagnostics, SamplingControls } from '../prediction/ModelDiagnostics';
import { samplingOptions } from '../prediction/diagnostics';
import type { Plan } from './types';
import './counterfactual.css';

const LIBRARY_KEY = 'oracle.counterfactual-plans.v1';
type Saved = { name: string; plan: Plan };
function library(): Saved[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]');
    return Array.isArray(value)
      ? value.filter((v) => v?.plan?.format === 'oracle-counterfactual-plan-v1').slice(0, 2)
      : [];
  } catch {
    return [];
  }
}
const failure = (error: unknown) =>
  error instanceof Error ? error.message : 'Counterfactual operation failed. Try again.';
const format = (number: number | null | undefined) => (number == null ? '—' : number.toFixed(3));

export function CounterfactualLab() {
  const world = useLab((s) => s.world),
    sid = useLab((s) => s.sessionId);
  const busy = useLab((s) => s.busy),
    connection = useLab((s) => s.connection);
  const state = useBranches();
  const {
    description,
    selected,
    compare,
    results,
    draft,
    selectedObject,
    step,
    source,
    view,
    horizon,
  } = state;
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [sampling, setSampling] = useState({ samples: 16, seed: '7' });
  const [name, setName] = useState('Alternative A');
  const [saved, setSaved] = useState(library),
    [savedId, setSavedId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<'alternatives' | 'prediction-reality'>(
    'alternatives',
  );
  const file = useRef<HTMLInputElement>(null);
  const camera = useRef<Camera>({ x: 12, y: 6.6, zoom: 1 });
  const model = catalog?.models.find((m) => m.id === state.modelId);
  const stride = model?.sample_stride || 4;
  const historyTicks = (model ? model.architecture.history - 1 : 3) * stride;
  const missing = world ? Math.max(0, world.last_edit_tick + historyTicks - world.tick) : 0;
  const plan = description?.plan;
  const branch = plan?.branches.find((b) => b.id === selected);
  const baseline = plan?.branches.find((b) => b.id === compare);
  const anchor = description?.previews[selected];
  const draftFrame = anchor ? applyChanges(anchor, draft) : null;
  const leftResult = results[selected],
    rightResult = results[compare];
  const predictedActual = comparisonMode === 'prediction-reality';
  const distinctComparison = predictedActual || compare !== selected;
  const leftFuture = draft.length
    ? undefined
    : predictedActual
      ? leftResult?.prediction
      : leftResult?.[source];
  const rightFuture = draft.length
    ? undefined
    : predictedActual
      ? leftResult?.reality
      : distinctComparison
        ? rightResult?.[source]
        : undefined;
  const rightAnchor = predictedActual ? anchor : description?.previews[compare];
  const compatible = distinctComparison && aligned(leftFuture, rightFuture);
  const maxStep = leftFuture?.horizon || rightFuture?.horizon || 0;
  const cursor = Math.min(step, maxStep);
  const leftFrame = draft.length ? draftFrame : anchor && sampledFrame(leftFuture, anchor, cursor);
  const rightFrame =
    rightAnchor &&
    sampledFrame(compatible || !leftFuture ? rightFuture : undefined, rightAnchor, cursor);
  const delta = leftFrame && rightFrame ? differences(leftFrame, rightFrame) : null;
  const metrics = draft.length ? null : measured(leftResult);
  const row = metrics?.horizons[Math.max(0, cursor - 1)];
  const objectError = cursor > 0 ? row?.objects.find((o) => o.id === selectedObject) : undefined;
  const disabled = !!busy || connection !== 'online' || !sid;
  const sourceLastEdit = plan
    ? Math.max(0, ...plan.snapshot.experiment.events.map((e) => e.tick))
    : 0;
  const enoughHistory = !!plan && plan.snapshot.frame.tick - sourceLastEdit >= historyTicks;
  const currentBody = draftFrame?.objects.find((b) => b.id === selectedObject);
  const originalBody = anchor?.objects.find((b) => b.id === selectedObject);

  const perform = async (label: string, action: () => Promise<void>) => {
    if (useLab.getState().busy) return;
    useLab.getState().set({ busy: label, error: null });
    setPlaying(false);
    try {
      await action();
    } catch (error) {
      useLab.getState().set({ error: failure(error) });
    } finally {
      useLab.getState().set({ busy: null });
    }
  };
  const refresh = async () => {
    const value = await request<ModelCatalog>('/prediction/models');
    setCatalog(value);
    if (!value.models.some((m) => m.id === useBranches.getState().modelId))
      useBranches.getState().set({
        modelId: value.models.find((m) => m.id === 'stage3-gru')?.id || value.models[0]?.id || '',
      });
  };
  useEffect(() => {
    void refresh().catch((error) => useLab.getState().set({ error: failure(error) }));
  }, []);
  useEffect(() => {
    if (!playing || !maxStep || draft.length) return;
    const timer = setInterval(
      () => {
        const current = useBranches.getState().step;
        if (current >= maxStep) setPlaying(false);
        else useBranches.getState().set({ step: current + 1 });
      },
      Math.max(16, (leftFuture?.sample_dt || rightFuture?.sample_dt || 1 / 30) * 1000),
    );
    return () => clearInterval(timer);
  }, [playing, maxStep, draft.length, leftFuture?.sample_dt, rightFuture?.sample_dt]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const capture = () =>
    perform('Capturing immutable source', async () => {
      const live = useLab.getState().world;
      if (!sid || !live) return;
      const value = await branchApi.capture(sid, {
        generation: live.generation,
        anchor_tick: live.tick,
        revision: live.revision,
      });
      useBranches.getState().setDescription(value);
      Object.assign(camera.current, { x: 12, y: 6.6, zoom: 1 });
      setNotice('Source captured. Interventions and futures leave the live world untouched.');
    });
  const commit = () =>
    perform('Saving alternative branch', async () => {
      if (!sid || !plan || !draft.length) return;
      const value = await branchApi.create(sid, plan.id, selected, name.trim(), draft);
      useBranches.getState().setDescription(value);
      useBranches.getState().select(value.plan.branches.at(-1)!.id);
      setName(`Alternative ${String.fromCharCode(65 + value.plan.branches.length - 1)}`);
    });
  const execute = (operation: 'predict' | 'reality') =>
    perform(
      operation === 'predict'
        ? 'Predicting counterfactual future'
        : 'Executing isolated Pymunk reality',
      async () => {
        if (!sid || !plan) return;
        const value =
          operation === 'predict'
            ? await branchApi.predict(
                sid,
                plan.id,
                selected,
                state.modelId,
                horizon,
                stride,
                samplingOptions(
                  model?.architecture.family === 'transformer' &&
                    (model.architecture.dropout ?? 0) > 0,
                  sampling,
                ),
              )
            : await branchApi.reality(sid, plan.id, selected, horizon, stride);
        if (!useBranches.getState().accept(value))
          throw new Error('This result belongs to another source. Select its saved plan.');
        if (operation === 'reality') {
          useBranches.getState().set({ step: 0 });
          setPlaying(true);
          if (results[selected]?.prediction) setComparisonMode('prediction-reality');
        }
      },
    );
  const save = () => {
    if (!plan) return;
    try {
      const next = [
        {
          name: `${plan.snapshot.experiment.origin.scene} · t${plan.snapshot.frame.tick} · ${plan.branches.length} branches`,
          plan,
        },
        ...saved.filter((v) => v.plan.id !== plan.id),
      ].slice(0, 2);
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
      setSaved(next);
      setSavedId(plan.id);
      setNotice(
        'Plan saved locally. Model weights and computed futures remain separate; export results to keep them.',
      );
    } catch {
      useLab
        .getState()
        .set({ error: 'Browser storage is full. Export this experiment to preserve it.' });
    }
  };
  const restore = (value: unknown) =>
    perform('Validating saved source replay', async () => {
      if (!sid) return;
      const data = await branchApi.restore(sid, value);
      useBranches.getState().setDescription(data);
      Object.assign(camera.current, { x: 12, y: 6.6, zoom: 1 });
      setNotice(
        'Source and branches restored after replay validation. Imported results are not trusted; run new futures.',
      );
    });
  const download = () => {
    if (!plan) return;
    const report = {
      format: 'oracle-counterfactual-report-v1',
      created_at: new Date().toISOString(),
      plan,
      results: Object.fromEntries(
        Object.entries(results).map(([id, result]) => [
          id,
          { ...result, metrics: measured(result) },
        ]),
      ),
      uncertainty: Object.values(results).some((result) => result.prediction?.uncertainty)
        ? {
            method: 'mc_dropout_autoregressive_v1',
            calibrated: false,
            location: 'results[branch].prediction.uncertainty',
          }
        : null,
    };
    const raw = JSON.stringify(report, null, 2);
    if (new Blob([raw]).size > 16 * 1024 * 1024) {
      useLab.getState().set({
        error: 'This report exceeds the 16 MiB export limit. Export a smaller experiment.',
      });
      return;
    }
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const element = document.createElement('a');
    element.href = url;
    element.download = `oracle-counterfactual-t${plan.snapshot.frame.tick}.json`;
    element.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="counterfactual-lab">
      <div className="workspace-heading branch-heading">
        <div>
          <div className="breadcrumb">
            WORKSPACE <span>/</span> COUNTERFACTUAL LAB
          </div>
          <h1>
            One observation. Multiple futures.<span className="tag violet">STAGE 05</span>
          </h1>
          <p>Freeze a source, intervene in alternatives, then test the learned future.</p>
        </div>
        <div className="workspace-actions">
          {missing > 0 && (
            <button
              className="button secondary"
              disabled={disabled || world?.playing}
              onClick={() =>
                void perform('Recording real source history', async () => {
                  if (sid) {
                    let remaining = missing;
                    while (remaining > 0) {
                      const count = Math.min(600, remaining);
                      useLab
                        .getState()
                        .receive(await api.command(sid, { kind: 'step', steps: count }));
                      remaining -= count;
                    }
                  }
                })
              }
            >
              Record {missing} ticks
            </button>
          )}
          <button
            className="button primary"
            disabled={disabled || !world || world.playing}
            onClick={() => void capture()}
            title="Capture a new source; save the active plan before replacing it"
          >
            <Fingerprint size={15} /> Capture source
          </button>
        </div>
      </div>
      <div className="branch-source-bar">
        <span>
          <ShieldCheck size={14} />
          {plan ? `FROZEN SOURCE / t${plan.snapshot.frame.tick}` : 'NO SOURCE CAPTURED'}
        </span>
        <span>
          {plan
            ? `${plan.snapshot.experiment.origin.scene.toUpperCase()} · SEED ${plan.snapshot.experiment.origin.seed}`
            : `LIVE WORLD / t${world?.tick ?? '—'} ${world?.playing ? '· PAUSE TO CAPTURE' : ''}`}
        </span>
        <span className="branch-source-description">
          {plan
            ? 'Live world and sibling branches are preserved.'
            : 'Record real history before capturing a source for temporal models.'}
        </span>
        <button disabled={!plan || !!busy} onClick={save}>
          <Save size={13} /> Save plan
        </button>
        <button disabled={!plan || !!busy} onClick={download}>
          <Download size={13} /> Export
        </button>
      </div>
      <div className="branch-workspace">
        <aside className="branch-tree">
          <div className="branch-section-title">
            <span className="eyebrow">FUTURE TREE</span>
            <GitBranch size={14} />
          </div>
          <div className="branch-tree-list">
            {plan ? (
              treeRows(plan).map(({ branch: item, depth }) => (
                <button
                  key={item.id}
                  aria-label={`Select branch ${item.name}`}
                  aria-pressed={selected === item.id}
                  className={`branch-node ${selected === item.id ? 'selected' : ''}`}
                  onClick={() => {
                    state.select(item.id);
                    setPlaying(false);
                  }}
                  style={{ paddingLeft: 12 + Math.min(depth, 4) * 12 }}
                >
                  <span className="branch-node-line" />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.parent_id
                        ? `${item.changes.length} intervention${item.changes.length > 1 ? 's' : ''}`
                        : 'Observed anchor'}
                    </small>
                    <i>
                      {results[item.id]?.prediction ? 'PREDICTED' : '—'}
                      {results[item.id]?.reality ? ' / EXECUTED' : ''}
                    </i>
                  </span>
                </button>
              ))
            ) : (
              <p className="branch-help">
                Capture a paused source to create immutable alternatives.
              </p>
            )}
          </div>
          <div className="branch-library">
            <span className="eyebrow">SAVED PLANS</span>
            <select
              aria-label="Saved counterfactual plan"
              value={savedId}
              onChange={(e) => setSavedId(e.target.value)}
            >
              <option value="">
                {saved.length ? 'Choose saved source' : 'No saved plans yet'}
              </option>
              {saved.map((item) => (
                <option key={item.plan.id} value={item.plan.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              className="button small"
              disabled={disabled || !savedId}
              onClick={() => void restore(saved.find((item) => item.plan.id === savedId)?.plan)}
            >
              Restore plan
            </button>
            <button
              className="button small"
              disabled={disabled}
              onClick={() => file.current?.click()}
            >
              <Upload size={12} /> Import JSON
            </button>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label="Import counterfactual JSON"
              onChange={(e) => {
                const selectedFile = e.target.files?.[0];
                e.target.value = '';
                if (!selectedFile) return;
                void perform('Reading counterfactual plan', async () => {
                  if (selectedFile.size > 16 * 1024 * 1024)
                    throw new Error('Imported report exceeds 16 MiB.');
                  const value = JSON.parse(await selectedFile.text());
                  const data = await branchApi.restore(
                    sid!,
                    value.format === 'oracle-counterfactual-report-v1' ? value.plan : value,
                  );
                  state.setDescription(data);
                  setNotice('Plan restored. Imported metrics are ignored; run new futures.');
                });
              }}
            />
            <p>Two local plans. Exports preserve computed futures and model provenance.</p>
          </div>
        </aside>
        <div className="branch-center">
          <div className="branch-compare-toolbar">
            <div role="group" aria-label="Comparison mode">
              <button
                className={comparisonMode === 'alternatives' ? 'selected' : ''}
                onClick={() => {
                  setComparisonMode('alternatives');
                  setPlaying(false);
                }}
              >
                Alternatives
              </button>
              <button
                className={predictedActual ? 'selected' : ''}
                onClick={() => {
                  setComparisonMode('prediction-reality');
                  setPlaying(false);
                }}
              >
                Predicted / actual
              </button>
            </div>
            <div className="branch-layout-toggle" role="group" aria-label="Comparison layout">
              <button
                className={view === 'overlay' ? 'selected' : ''}
                onClick={() => state.set({ view: 'overlay' })}
              >
                Overlay
              </button>
              <button
                className={view === 'split' ? 'selected' : ''}
                onClick={() => state.set({ view: 'split' })}
              >
                Split view
              </button>
            </div>
          </div>
          <div className="branch-compare-selectors">
            {!predictedActual ? (
              <>
                <label>
                  Compare with
                  <select
                    aria-label="Compare branch"
                    disabled={!plan || !!busy}
                    value={compare}
                    onChange={(e) => {
                      state.set({ compare: e.target.value });
                      setPlaying(false);
                    }}
                  >
                    {plan?.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div role="group" aria-label="Future source">
                  <button
                    className={source === 'prediction' ? 'selected' : ''}
                    onClick={() => {
                      state.set({ source: 'prediction', step: 0 });
                      setPlaying(false);
                    }}
                  >
                    Learned
                  </button>
                  <button
                    className={source === 'reality' ? 'selected' : ''}
                    onClick={() => {
                      state.set({ source: 'reality', step: 0 });
                      setPlaying(false);
                    }}
                  >
                    Pymunk
                  </button>
                </div>
              </>
            ) : (
              <p>Same branch, same intervention, independently generated futures.</p>
            )}
            <span className="tag">{draft.length ? 'UNCOMMITTED PREVIEW' : 'ISOLATED FUTURES'}</span>
          </div>
          {leftFrame && anchor ? (
            <div className={`branch-viewports ${view === 'split' ? 'split' : ''}`}>
              <BranchViewport
                key={`selected-${view}`}
                title={branch?.name || 'Alternative'}
                frame={leftFrame}
                anchor={anchor}
                future={draft.length ? undefined : leftFuture}
                other={
                  view === 'overlay' &&
                  distinctComparison &&
                  !draft.length &&
                  rightFrame &&
                  rightAnchor
                    ? {
                        frame: rightFrame,
                        anchor: rightAnchor,
                        future: compatible ? rightFuture : undefined,
                        color: 0x93e3eb,
                      }
                    : undefined
                }
                color={0xa79ad7}
                selected={selectedObject}
                onSelect={(id) => state.set({ selectedObject: id })}
                camera={camera}
                subtitle={
                  draft.length
                    ? 'Hypothetical preview · not committed'
                    : leftFuture
                      ? `${leftFuture.source === 'learned_model' ? leftFuture.model_version : 'Pymunk reality'} · t${leftFrame.tick}`
                      : `Saved anchor · t${anchor.tick} · no future yet`
                }
              />
              {view === 'split' && rightFrame && rightAnchor && (
                <BranchViewport
                  key={`comparison-${view}`}
                  title={predictedActual ? 'Executed reality' : baseline?.name || 'Comparison'}
                  frame={rightFrame}
                  anchor={rightAnchor}
                  future={compatible || !leftFuture ? rightFuture : undefined}
                  color={0x93e3eb}
                  selected={selectedObject}
                  onSelect={(id) => state.set({ selectedObject: id })}
                  camera={camera}
                  subtitle={
                    rightFuture && (compatible || !leftFuture)
                      ? `${rightFuture.source === 'learned_model' ? rightFuture.model_version : 'Pymunk reality'} · t${rightFrame.tick}`
                      : `Saved anchor · t${rightAnchor.tick} · no aligned future`
                  }
                />
              )}
            </div>
          ) : (
            <div className="branch-empty-world">
              <div className="branch-empty-orbit">
                <GitBranch size={42} />
              </div>
              <span className="eyebrow">THE COUNTERFACTUAL QUESTION</span>
              <h2>What would happen if…?</h2>
              <p>
                Pause your world in Lab. Capture its immutable source here, then change mass, motion
                or geometry without changing reality.
              </p>
              <div>
                <span>01 / CAPTURE</span>
                <ArrowRight size={14} />
                <span>02 / INTERVENE</span>
                <ArrowRight size={14} />
                <span>03 / VERIFY</span>
              </div>
            </div>
          )}
          <div className="branch-cursor">
            <button
              aria-label={playing ? 'Pause future replay' : 'Play future replay'}
              disabled={!maxStep || !!draft.length}
              onClick={() => {
                if (cursor >= maxStep) state.set({ step: 0 });
                setPlaying(!playing);
              }}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <span>
              <strong>FUTURE / +{cursor}</strong>
              <small>
                {((leftFuture?.sample_dt || rightFuture?.sample_dt || 1 / 30) * cursor).toFixed(3)}{' '}
                s after source
              </small>
            </span>
            <input
              type="range"
              aria-label="Shared future cursor"
              min={0}
              max={maxStep || 1}
              step={1}
              value={cursor}
              disabled={!maxStep || !!draft.length}
              onChange={(e) => {
                state.set({ step: Number(e.target.value) });
                setPlaying(false);
              }}
            />
            <output>+{maxStep}</output>
          </div>
          <div className="branch-comparison-readout">
            <span>
              <i className="violet-dot" /> {branch?.name || 'Alternative'}
              {leftFuture
                ? ` / ${leftFuture.source === 'learned_model' ? 'LEARNED' : 'PYMUNK'}`
                : ' / ANCHOR'}
            </span>
            <span>
              <i className="cyan-dot" />
              {predictedActual ? 'Explicit reality' : baseline?.name || 'Comparison'}
              {rightFuture
                ? ` / ${rightFuture.source === 'learned_model' ? 'LEARNED' : 'PYMUNK'}`
                : ' / ANCHOR'}
            </span>
            <strong>
              {!draft.length && compatible
                ? `${format(delta?.mean)} m ${predictedActual ? 'MODEL GAP' : 'BRANCH GAP'}`
                : 'ANCHOR PREVIEW'}
            </strong>
          </div>
          {leftFuture && rightFuture && !compatible && (
            <p className="branch-alignment-warning">
              Future clocks or horizons differ. Run both with the same settings to compare sampled
              steps.
            </p>
          )}
          {!!delta && (delta.onlyLeft.length > 0 || delta.onlyRight.length > 0) && (
            <p className="branch-alignment-warning">
              Different identities: {delta.onlyLeft.length} only in selected /{' '}
              {delta.onlyRight.length} only in comparison. Gaps score common dynamic bodies.
            </p>
          )}
        </div>
        <aside className="branch-inspector">
          <div className="branch-section-title">
            <span className="eyebrow">{branch?.name || 'COUNTERFACTUAL PROTOCOL'}</span>
            <span className="tag violet">{plan?.branches.length || 0}/16</span>
          </div>
          <div className="branch-execution">
            <label>
              Learned model
              <div>
                <select
                  aria-label="Counterfactual model"
                  value={state.modelId}
                  disabled={disabled}
                  onChange={(e) => state.set({ modelId: e.target.value })}
                >
                  {!catalog?.models.length && <option value="">No trained model</option>}
                  {catalog?.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.architecture.family.toUpperCase()} · {m.id}
                    </option>
                  ))}
                </select>
                <button
                  aria-label="Refresh counterfactual models"
                  disabled={!!busy}
                  onClick={() => void perform('Refreshing models', refresh)}
                >
                  <RefreshCw size={13} />
                </button>
              </div>
            </label>
            <label>
              Prediction horizon
              <output>
                {horizon} steps · {((horizon * stride) / 120).toFixed(2)} s
              </output>
              <input
                aria-label="Counterfactual horizon"
                type="range"
                min={1}
                max={120}
                step={1}
                value={horizon}
                disabled={disabled}
                onChange={(e) => state.set({ horizon: Number(e.target.value) })}
              />
            </label>
            <SamplingControls
              enabled={
                model?.architecture.family === 'transformer' &&
                (model.architecture.dropout ?? 0) > 0
              }
              settings={sampling}
              disabled={disabled}
              onChange={setSampling}
            />
            <div className="branch-run-actions">
              <button
                className="button branch-predict"
                disabled={
                  disabled ||
                  !plan ||
                  !model ||
                  !catalog?.torch_available ||
                  !enoughHistory ||
                  !!draft.length ||
                  !anchor?.objects.some((b) => !b.static)
                }
                onClick={() => void execute('predict')}
              >
                {busy === 'Predicting counterfactual future' ? (
                  <LoaderCircle className="spinning" size={14} />
                ) : (
                  <GitBranch size={14} />
                )}{' '}
                Predict future
              </button>
              <button
                className="button primary"
                disabled={disabled || !plan || !!draft.length}
                onClick={() => void execute('reality')}
              >
                {busy === 'Executing isolated Pymunk reality' ? (
                  <LoaderCircle className="spinning" size={14} />
                ) : (
                  <Play size={14} />
                )}{' '}
                Run reality
              </button>
            </div>
            <p>
              {draft.length
                ? 'Save the draft as a branch before execution.'
                : plan && !enoughHistory
                  ? `Source needs ${historyTicks} real ticks after its latest edit. Record history and capture a later source.`
                  : 'Two separate requests. Pymunk runs only when you choose Run reality.'}
            </p>
          </div>
          {!draft.length && leftResult?.prediction && (
            <ModelDiagnostics
              uncertainty={leftResult.prediction.uncertainty}
              attention={leftResult.prediction.attention}
              step={cursor}
              selected={selectedObject}
              measurement={metrics ? leftResult.comparison?.uncertainty_measurement : null}
            />
          )}
          <div className="branch-metrics">
            <div>
              <span>PREDICTION ADE</span>
              <strong>
                {format(metrics?.summary.ade_m)}
                <small> m</small>
              </strong>
            </div>
            <div>
              <span>FINAL ERROR</span>
              <strong>
                {format(metrics?.summary.fde_m)}
                <small> m</small>
              </strong>
            </div>
          </div>
          {!metrics && (
            <p className="branch-help">
              Measured error appears after a learned forecast and matching executed reality exist.
            </p>
          )}
          {metrics && (
            <div className="branch-error-chart">
              <span className="eyebrow">MEAN DISPLACEMENT / FUTURE STEP</span>
              <svg
                viewBox="0 0 270 85"
                role="img"
                aria-label="Counterfactual measured displacement error chart"
              >
                <line x1="10" y1="65" x2="260" y2="65" />
                <line x1="10" y1="10" x2="10" y2="65" />
                <polyline
                  points={[{ step: 0, displacement_m: 0 }, ...metrics.horizons]
                    .map(
                      (r) =>
                        `${10 + (r.step / metrics.horizons.length) * 250},${65 - (r.displacement_m / Math.max(0.001, ...metrics.horizons.map((h) => h.displacement_m))) * 50}`,
                    )
                    .join(' ')}
                />
                <line
                  className="chart-cursor"
                  x1={10 + (cursor / metrics.horizons.length) * 250}
                  x2={10 + (cursor / metrics.horizons.length) * 250}
                  y1="10"
                  y2="65"
                />
                <text x="10" y="80">
                  0
                </text>
                <text x="236" y="80">
                  +{metrics.horizons.length}
                </text>
                <text x="16" y="12">
                  {format(Math.max(...metrics.horizons.map((h) => h.displacement_m)))} m
                </text>
              </svg>
            </div>
          )}
          {plan && draftFrame && (
            <>
              <label className="branch-object-select">
                Inspect / intervene
                <select
                  aria-label="Counterfactual object"
                  value={selectedObject || ''}
                  onChange={(e) => state.set({ selectedObject: e.target.value || null })}
                >
                  <option value="">Select a body</option>
                  {draftFrame.objects.map((body) => (
                    <option key={body.id} value={body.id}>
                      {body.id} · {body.static ? 'STATIC' : body.shape.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              {objectError && (
                <div className="branch-object-error">
                  <span>
                    +{cursor} / {selectedObject}
                  </span>
                  <strong>{format(objectError.displacement_m)} m</strong>
                  <span>
                    Velocity {format(objectError.velocity_error_m_s)} m/s · rotation{' '}
                    {format(objectError.rotation_error_rad)} rad
                  </span>
                  <span>
                    Contact / predicted {objectError.predicted_contact ? 'yes' : 'no'} · actual{' '}
                    {objectError.actual_contact ? 'yes' : 'no'}
                  </span>
                </div>
              )}
              <details className="branch-editor-details" open={!!draft.length || !leftFuture}>
                <summary>Build an alternative</summary>
                <InterventionEditor
                  body={currentBody}
                  original={originalBody}
                  disabled={disabled}
                />
                {draft.length > 0 && (
                  <div className="branch-commit">
                    <label>
                      Branch name
                      <input
                        aria-label="Alternative branch name"
                        maxLength={60}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    {draft.map((change, index) => (
                      <span key={index}>{changeSummary(change)}</span>
                    ))}
                    <button
                      className="button primary"
                      disabled={disabled || !name.trim() || plan.branches.length >= 16}
                      onClick={() => void commit()}
                    >
                      <GitBranch size={14} /> Save alternative
                    </button>
                    <small>
                      Child of {branch?.name}. All interventions occur at the frozen source tick.
                    </small>
                  </div>
                )}
              </details>
            </>
          )}
          {branch?.changes.length ? (
            <div className="branch-saved-changes">
              <span className="eyebrow">THIS BRANCH ADDS</span>
              {branch.changes.map((change, i) => (
                <p key={i}>{changeSummary(change)}</p>
              ))}
              <small>
                Parent interventions are inherited. Create a child to change this immutable
                alternative.
              </small>
            </div>
          ) : null}
          {leftResult?.prediction && (
            <details className="branch-provenance">
              <summary>
                <Fingerprint size={12} /> Verified checkpoint & conditioning
              </summary>
              <p>{leftResult.prediction.model_version}</p>
              <code>{leftResult.prediction.model?.sha256}</code>
              <span>Dataset {leftResult.prediction.model?.dataset_id}</span>
              <code>{leftResult.prediction.model?.normalization_sha256}</code>
              <p>
                Terminal state override · original observations retained. Removed identities are
                projected out of model inputs.
              </p>
              {!!leftResult.prediction.conditioning?.added_ids.length && (
                <p className="amber">
                  New bodies use synthetic repeated anchor placeholders in the model window:{' '}
                  {leftResult.prediction.conditioning.added_ids.join(', ')}. These are conditioning
                  inputs, not observations.
                </p>
              )}
            </details>
          )}
          <div className="branch-integrity-note">
            <ShieldCheck size={14} />
            <p>
              Exploratory intervention forecasts. Models were trained on ordinary episodes;
              intervention accuracy is unverified. Confidence is not estimated.
            </p>
          </div>
        </aside>
      </div>
      {notice && (
        <div className="branch-notice" role="status">
          <ShieldCheck size={13} />
          {notice}
        </div>
      )}
    </div>
  );
}
