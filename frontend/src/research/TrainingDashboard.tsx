import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  BrainCircuit,
  Check,
  Cpu,
  Fingerprint,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { datasetApi } from './dataset';
import type { CatalogItem } from './dataset';
import { groupName, measured, rolloutChart, trainingApi, trainingConfig } from './training';
import type { Family, Run, RunDetail } from './training';
import './training.css';
import '../prediction/diagnostics.css';

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Training artifacts could not be loaded. Try refreshing.';
const tooltipStyle = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  fontSize: 10,
};
const ticks = { fill: 'var(--dim)', fontSize: 9, fontFamily: 'var(--mono)' };

function Metric({
  label,
  value,
  unit,
  reference,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  reference?: number;
}) {
  return (
    <div className="training-metric">
      <span>{label}</span>
      <strong>
        {measured(value)}
        <small>{unit}</small>
      </strong>
      <p>
        {reference == null ? 'Awaiting measured evaluation' : `CV reference ${measured(reference)}`}
      </p>
    </div>
  );
}

export function TrainingDashboard() {
  const [datasets, setDatasets] = useState<CatalogItem[]>([]),
    [datasetId, setDatasetId] = useState('');
  const [runs, setRuns] = useState<Run[]>([]),
    [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<RunDetail | null>(null),
    [available, setAvailable] = useState(false);
  const [family, setFamily] = useState<Family>('mlp'),
    [epochs, setEpochs] = useState('35'),
    [seed, setSeed] = useState('7'),
    [history, setHistory] = useState('4');
  const [error, setError] = useState<string | null>(null),
    [starting, setStarting] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [groupKey, setGroupKey] = useState('test'),
    [horizon, setHorizon] = useState(10);
  useEffect(() => {
    let cancelled = false;
    void datasetApi
      .catalog()
      .then(({ datasets: items }) => {
        if (cancelled) return;
        setDatasets(items);
        setDatasetId(
          (current) =>
            current || items.find((d) => d.episode_count === 64)?.id || items[0]?.id || '',
        );
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const catalog = await trainingApi.catalog();
        if (cancelled) return;
        setRuns(catalog.runs);
        setAvailable(catalog.torch_available);
        const id = selected || catalog.runs[0]?.id;
        if (!selected && id) setSelected(id);
        if (id) {
          const loaded = await trainingApi.detail(id);
          if (!cancelled) setDetail(loaded);
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selected, refresh]);
  const run =
    detail?.summary.id === selected ? detail.summary : runs.find((r) => r.id === selected);
  const current = detail?.summary.id === selected ? detail : null;
  const active = runs.some((r) => r.status === 'running');
  const group = current?.evaluation?.groups[groupKey];
  const score = group?.one_step.learned,
    reference = group?.one_step.constant_velocity;
  const rollout =
    group?.rollout.learned.find((r) => r.horizon === horizon) || group?.rollout.learned[0];
  const rolloutReference = group?.rollout.constant_velocity.find(
    (r) => r.horizon === rollout?.horizon,
  );
  const records = current?.metrics?.epochs || [];
  const dataset = datasets.find((d) => d.id === datasetId);
  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const created = await trainingApi.start(
        datasetId,
        trainingConfig(family, epochs, seed, history),
      );
      setRuns((items) => [created, ...items]);
      setSelected(created.id);
      setDetail(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };
  const exportEvaluation = () => {
    if (!current?.evaluation) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { ...current.evaluation, uncertainty: current.uncertainty ?? null },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `oracle-${selected}-evaluation.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="training-dashboard">
      <div className="dataset-intro">
        <div>
          <span className="eyebrow cyan">RESEARCH / LEARNED DYNAMICS</span>
          <h1>From observation to understanding.</h1>
          <p>Train an object-centric world model. Measure what it learns — and where it fails.</p>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            setError(null);
            setRefresh((n) => n + 1);
          }}
        >
          <RefreshCw size={14} />
          Refresh artifacts
        </button>
      </div>
      {error && (
        <div className="training-error" role="alert">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      <div className="training-workspace">
        <aside className="training-library">
          <div className="training-panel-title">
            <span className="eyebrow">EXPERIMENT LOG</span>
            <span>{runs.length.toString().padStart(2, '0')}</span>
          </div>
          <div className="training-run-list">
            {runs.length ? (
              runs.map((item) => (
                <button
                  key={item.id}
                  className={`training-run ${selected === item.id ? 'selected' : ''}`}
                  onClick={() => setSelected(item.id)}
                >
                  <div>
                    <BrainCircuit size={15} />
                    <strong>{item.family.toUpperCase()}</strong>
                    <span className={`run-state ${item.status}`}>
                      {item.status === 'running' ? (
                        <LoaderCircle className="spin" size={11} />
                      ) : item.status === 'complete' ? (
                        <Check size={11} />
                      ) : (
                        '!'
                      )}
                    </span>
                  </div>
                  <span>{item.id}</span>
                  <p>
                    {item.epoch}/{item.epochs} epochs <i>·</i> Seed {item.seed}
                  </p>
                </button>
              ))
            ) : (
              <div className="training-empty small">
                <BrainCircuit size={25} />
                <p>Your first learned model starts here.</p>
              </div>
            )}
          </div>
          <div className="training-architecture">
            <span className="eyebrow">MODEL ANATOMY</span>
            <div>
              <span>01</span>Object states<small>22 features / object</small>
            </div>
            <ArrowRight size={12} />
            <div>
              <span>02</span>Shared encoder<small>Masked scene context</small>
            </div>
            <ArrowRight size={12} />
            <div>
              <span>03</span>
              {run?.family === 'transformer'
                ? 'Object / temporal Transformer'
                : run?.family === 'gru'
                  ? 'Temporal GRU'
                  : 'Temporal MLP'}
              <small>Motion residual + contact</small>
            </div>
            <p>Weights learn the transition. Static geometry stays fixed.</p>
          </div>
        </aside>
        <section className="training-results" aria-label="Training results">
          <div className="training-run-heading">
            <div>
              <span className="eyebrow">{run ? run.id : 'NO RUN SELECTED'}</span>
              <h2>
                {run
                  ? `${run.family.toUpperCase()} · Object dynamics`
                  : 'A model earns its metrics.'}
              </h2>
            </div>
            <span className={`run-status ${run?.status || ''}`}>
              {run?.status === 'running' && <LoaderCircle size={12} className="spin" />}
              {run?.status || 'READY TO TRAIN'}
            </span>
          </div>
          {run?.status === 'running' && (
            <div className="training-progress" role="status">
              <div>
                <span>
                  {run.phase === 'evaluating'
                    ? `Evaluating ${run.evaluation_completed || 0}/${run.evaluation_total || 8} held-out groups`
                    : `${run.phase} · Epoch ${run.epoch}/${run.epochs}`}
                </span>
                <span>{run.device.toUpperCase()}</span>
              </div>
              <progress value={run.epoch} max={run.epochs} />
            </div>
          )}
          {run?.error && (
            <div className="training-error" role="alert">
              {run.error}
            </div>
          )}
          <div className="training-chart-panel">
            <div className="training-panel-title">
              <div>
                <span className="eyebrow">OPTIMIZATION TRACE</span>
                <p>Normalized motion MSE + weighted contact loss</p>
              </div>
              <div className="chart-legend">
                <span className="cyan-key">Train</span>
                <span className="violet-key">Validation</span>
              </div>
            </div>
            {records.length ? (
              <div className="loss-chart" aria-label="Actual train and validation loss by epoch">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={records} margin={{ left: 2, right: 18, top: 18, bottom: 0 }}>
                    <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                    <XAxis
                      dataKey="epoch"
                      tick={ticks}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={ticks}
                      tickFormatter={(v: number) => v.toFixed(3)}
                      tickLine={false}
                      axisLine={false}
                      width={50}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(label) => `Epoch ${label}`}
                      formatter={(value) => measured(Number(value))}
                    />
                    {run?.best_epoch ? (
                      <ReferenceLine x={run.best_epoch} stroke="var(--dim)" strokeDasharray="3 5" />
                    ) : null}
                    <Line
                      dataKey="train_loss"
                      name="Train"
                      stroke="var(--cyan)"
                      dot={records.length === 1}
                      strokeWidth={1.7}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="validation_loss"
                      name="Validation"
                      stroke="var(--violet)"
                      dot={records.length === 1}
                      strokeWidth={1.7}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="training-empty">
                <BrainCircuit size={30} />
                <h3>{run ? 'Collecting the first epoch.' : 'No measured loss yet.'}</h3>
                <p>Loss curves appear only after real optimization.</p>
              </div>
            )}
            <div className="training-chart-footer">
              <span>{records.length} EPOCHS LOGGED</span>
              <span>BEST VALIDATION / {run?.best_epoch ? `EPOCH ${run.best_epoch}` : '—'}</span>
              <span>{run?.parameters?.toLocaleString() || '—'} PARAMETERS</span>
            </div>
          </div>
          <div className="evaluation-panel">
            <div className="training-panel-title">
              <div>
                <span className="eyebrow">HELD-OUT EVALUATION</span>
                <p>Best validation checkpoint · dynamic objects only</p>
              </div>
              <select
                aria-label="Evaluation group"
                value={groupKey}
                onChange={(e) => setGroupKey(e.target.value)}
                disabled={!current?.evaluation}
              >
                {Object.keys(current?.evaluation?.groups || { test: null }).map((key) => (
                  <option key={key} value={key}>
                    {groupName(key)}
                  </option>
                ))}
              </select>
            </div>
            <div className="training-metrics">
              <Metric
                label="1-STEP POSITION"
                value={score?.position_mse}
                unit="m²"
                reference={reference?.position_mse}
              />
              <Metric
                label="1-STEP VELOCITY"
                value={score?.velocity_mse}
                unit="(m/s)²"
                reference={reference?.velocity_mse}
              />
              <Metric
                label="ROTATION MAE"
                value={score?.rotation_mae_rad}
                unit="rad"
                reference={reference?.rotation_mae_rad}
              />
            </div>
            <div className="rollout-heading">
              <span className="eyebrow">FREE ROLLOUT / DISPLACEMENT</span>
              <div className="chart-legend">
                <span className="cyan-key">Learned</span>
                <span className="muted-key">Constant velocity</span>
              </div>
            </div>
            {group ? (
              <>
                <div className="rollout-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={rolloutChart(group)}
                      margin={{ left: 2, right: 18, top: 8, bottom: 0 }}
                    >
                      <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                      <XAxis
                        dataKey="horizon"
                        type="number"
                        domain={[0, 'dataMax']}
                        ticks={group.rollout.learned.map((r) => r.horizon)}
                        tick={ticks}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={ticks}
                        tickFormatter={(v: number) => measured(v)}
                        tickLine={false}
                        axisLine={false}
                        width={50}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(label) => `${label} observed steps`}
                        formatter={(value) => `${measured(Number(value))} m`}
                      />
                      <Line
                        dataKey="learned"
                        name="Learned FDE"
                        stroke="var(--cyan)"
                        strokeWidth={1.7}
                        dot={{ r: 2 }}
                        isAnimationActive={false}
                      />
                      <Line
                        dataKey="baseline"
                        name="CV FDE"
                        stroke="var(--dim)"
                        strokeDasharray="4 4"
                        dot={{ r: 2 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="horizon-controls">
                  <span>HORIZON</span>
                  {group.rollout.learned.map((r) => (
                    <button
                      key={r.horizon}
                      className={rollout?.horizon === r.horizon ? 'selected' : ''}
                      onClick={() => setHorizon(r.horizon)}
                    >
                      {r.horizon}
                    </button>
                  ))}
                  <span>{rollout?.seconds.toFixed(3)} s</span>
                </div>
                <div className="rollout-scores">
                  <span>
                    ADE <strong>{measured(rollout?.ade_m)} m</strong>
                  </span>
                  <span>
                    FDE <strong>{measured(rollout?.fde_m)} m</strong>
                  </span>
                  <span>
                    CV FDE <strong>{measured(rolloutReference?.fde_m)} m</strong>
                  </span>
                  <span>
                    CONTACT BAL. ACC.{' '}
                    <strong>
                      {rollout?.contact_balanced_accuracy == null
                        ? '—'
                        : `${(rollout.contact_balanced_accuracy * 100).toFixed(1)}%`}
                    </strong>
                  </span>
                </div>
                {current?.uncertainty?.groups[groupKey] && (
                  <section
                    className="uncertainty-evaluation"
                    aria-label="Held-out interval quality"
                  >
                    <span className="eyebrow">MC DROPOUT / OBSERVED INTERVAL QUALITY</span>
                    <p>
                      {current.uncertainty.samples} paths per anchor · Seed{' '}
                      {current.uncertainty.seed} · 5–95% marginal quantiles · No calibration fitted.
                    </p>
                    <table>
                      <thead>
                        <tr>
                          <th>STEPS</th>
                          <th>X / Y COVERAGE</th>
                          <th>BOTH</th>
                          <th>X / Y WIDTH · m</th>
                        </tr>
                      </thead>
                      <tbody>
                        {current.uncertainty.groups[groupKey].horizons.map((row) => (
                          <tr key={row.horizon}>
                            <td>+{row.horizon}</td>
                            <td>
                              {(row.coverage_x * 100).toFixed(1)} /{' '}
                              {(row.coverage_y * 100).toFixed(1)}%
                            </td>
                            <td>{(row.coverage_xy * 100).toFixed(1)}%</td>
                            <td>
                              {row.width_x_m.toFixed(3)} / {row.width_y_m.toFixed(3)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p>
                      Nominal 90% is per coordinate. Narrow intervals can miss the actual future.
                      Joint coverage is measured separately. This is model spread, not a safety
                      score.
                    </p>
                  </section>
                )}
                <p className="evaluation-footnote">
                  {group.episodes} episodes · {group.anchors.length} rollout anchors ·{' '}
                  {(1 / group.sample_dt).toFixed(0)} Hz observations. Contact is an onset within the
                  sampled interval. Balanced accuracy is at the chosen horizon; — means one class is
                  absent.
                  {group.omitted_horizons.length > 0 &&
                    ` Horizons ${group.omitted_horizons.join(', ')} exceed this recording.`}
                </p>
              </>
            ) : (
              <div className="training-empty evaluation">
                <ShieldCheck size={25} />
                <p>Evaluation follows training. Test and OOD never select the checkpoint.</p>
              </div>
            )}
          </div>
        </section>
        <aside className="training-controls">
          <div className="training-panel-title">
            <span className="eyebrow">NEW EXPERIMENT</span>
            <Cpu size={14} />
          </div>
          <div className="training-family" aria-label="Model architecture">
            <button className={family === 'mlp' ? 'selected' : ''} onClick={() => setFamily('mlp')}>
              MLP<small>Feedforward baseline</small>
            </button>
            <button className={family === 'gru' ? 'selected' : ''} onClick={() => setFamily('gru')}>
              GRU<small>Temporal memory</small>
            </button>
            <button
              className={family === 'transformer' ? 'selected' : ''}
              onClick={() => setFamily('transformer')}
            >
              Transformer<small>Object + time attention</small>
            </button>
          </div>
          <label className="training-field">
            DATASET
            <select
              aria-label="Training dataset"
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
            >
              {datasets.length ? (
                datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.episode_count} episodes · Seed {d.config.seed} · {d.config.steps / 120} s
                  </option>
                ))
              ) : (
                <option value="">Collect a dataset first</option>
              )}
            </select>
          </label>
          <p className="training-dataset-note">
            {dataset
              ? `${dataset.config.train} train / ${dataset.config.validation} validation / ${dataset.config.test} test / ${dataset.config.ood_per_suite * 6} OOD`
              : 'Dataset engine supplies verified observations.'}
          </p>
          <div className="training-field-grid">
            <label className="training-field">
              EPOCHS
              <input
                aria-label="Training epochs"
                inputMode="numeric"
                value={epochs}
                onChange={(e) => setEpochs(e.target.value)}
              />
            </label>
            <label className="training-field">
              SEED
              <input
                aria-label="Training seed"
                inputMode="numeric"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
            </label>
          </div>
          <label className="training-field">
            OBSERVED HISTORY
            <select
              aria-label="History frames"
              value={history}
              onChange={(e) => setHistory(e.target.value)}
            >
              {[1, 2, 4, 8].map((h) => (
                <option key={h} value={h}>
                  {h} frames
                </option>
              ))}
            </select>
          </label>
          <div className="training-recipe">
            {family === 'transformer' && (
              <>
                <span>
                  ATTENTION<strong>4 heads · 2 layers</strong>
                </span>
                <span>
                  DROPOUT<strong>0.10 · MC sampling</strong>
                </span>
              </>
            )}
            <span>
              ADAMW<strong>lr 0.001</strong>
            </span>
            <span>
              BATCH<strong>64 windows</strong>
            </span>
            <span>
              LATENT<strong>64 dimensions</strong>
            </span>
            <span>
              DEVICE<strong>CPU · 2 threads</strong>
            </span>
          </div>
          <button
            className="button primary training-start"
            disabled={!available || !datasetId || starting || active}
            onClick={() => void start()}
          >
            {starting || active ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
            {active ? 'Training in progress' : starting ? 'Starting worker' : 'Train world model'}
          </button>
          <p className="training-limit">
            {!available
              ? 'Install the ML dependencies to enable training.'
              : 'One local worker. Best checkpoint selected by validation loss.'}
          </p>
          <div className="checkpoint-card">
            <div className="training-panel-title">
              <span className="eyebrow">CHECKPOINT PROVENANCE</span>
              <Fingerprint size={15} />
            </div>
            {current?.checkpoint ? (
              <>
                <span className="checkpoint-verified">
                  <ShieldCheck size={12} />
                  WEIGHTS HASH RECORDED
                </span>
                <dl>
                  <dt>Selected epoch</dt>
                  <dd>{current.checkpoint.epoch}</dd>
                  <dt>History</dt>
                  <dd>{current.config.config.model.history} observed frames</dd>
                  <dt>PyTorch</dt>
                  <dd>{current.checkpoint.runtime.torch}</dd>
                  <dt>Dataset</dt>
                  <dd>{current.checkpoint.dataset.id}</dd>
                </dl>
                <span className="eyebrow">WEIGHTS SHA256</span>
                <code>{current.checkpoint.sha256}</code>
                <span className="eyebrow">TRAIN NORMALIZER SHA256</span>
                <code>{current.checkpoint.dataset.normalization_sha256}</code>
                <button
                  className="button secondary"
                  disabled={!current.evaluation}
                  onClick={exportEvaluation}
                >
                  <ArrowDownToLine size={13} />
                  Export evaluation
                </button>
              </>
            ) : (
              <p>
                A verified checkpoint records weights, optimizer, architecture, normalization and
                dataset identity.
              </p>
            )}
          </div>
        </aside>
      </div>
      <div className="training-integrity">
        <ShieldCheck size={13} />
        <span>Real learned weights. Separate ground truth. No confidence estimate.</span>
        <span>Ghost trajectories enter in the Prediction Lab.</span>
      </div>
    </div>
  );
}
