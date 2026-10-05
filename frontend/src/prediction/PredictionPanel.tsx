import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, Download, RefreshCw, Sparkles, X } from 'lucide-react';
import { request } from '../api/client';
import { useLab } from '../state/lab';
import type { Command } from '../types';
import { compatibleEnvironment, requiredTicks } from './forecast';
import type { ModelCatalog, Prediction } from './types';
import './prediction.css';

const PredictionChart = lazy(() => import('./PredictionChart'));
const number = (value: number, digits = 3) => value.toFixed(digits);

export function PredictionPanel({ command }: { command: (cmd: Command) => Promise<void> }) {
  const world = useLab((s) => s.world),
    sessionId = useLab((s) => s.sessionId),
    busy = useLab((s) => s.busy);
  const prediction = useLab((s) => s.prediction),
    step = useLab((s) => s.forecastStep),
    selectedId = useLab((s) => s.selectedId);
  const online = useLab((s) => s.connection === 'online');
  const modelId = useLab((s) => s.predictionModelId),
    horizon = useLab((s) => s.predictionHorizon);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const mounted = useRef(true),
    active = useRef(false);
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const value = await request<ModelCatalog>('/prediction/models');
      if (!mounted.current) return;
      setCatalog(value);
      const current = useLab.getState().predictionModelId;
      useLab.getState().set({
        predictionModelId: value.models.some((m) => m.id === current)
          ? current
          : (value.models.find((m) => m.id === 'stage3-gru') || value.models[0])?.id || '',
      });
      const previous = useLab.getState().prediction;
      if (
        previous &&
        !value.models.some((m) => m.id === previous.model.id && m.sha256 === previous.model.sha256)
      )
        useLab.getState().set({ prediction: null });
    } catch (err) {
      if (mounted.current)
        setError(err instanceof Error ? err.message : 'Models could not be loaded.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, []);
  const model = catalog?.models.find((value) => value.id === modelId);
  const needed = world && model ? requiredTicks(world, model) : 0;
  const compatible = world && model ? compatibleEnvironment(world, model) : false;
  const disabled =
    !!busy || !online || !world || world.playing || !model || !catalog?.torch_available;
  const withinLimit = !!world && !!model && world.tick + horizon * model.sample_stride <= 14400;
  const record = async () => {
    if (disabled || !needed || active.current) return;
    active.current = true;
    try {
      for (let remaining = needed; remaining > 0; remaining -= 600)
        await command({ kind: 'step', steps: Math.min(600, remaining) });
    } finally {
      active.current = false;
    }
  };
  const predict = async () => {
    if (disabled || needed || !compatible || !withinLimit || !sessionId || active.current) return;
    active.current = true;
    setError(null);
    useLab.getState().set({ busy: 'Predicting learned future', prediction: null });
    try {
      const result = await request<Prediction>(`/sessions/${sessionId}/predict`, {
        model_id: modelId,
        generation: world.generation,
        anchor_tick: world.tick,
        revision: world.revision,
        horizon,
      });
      if (!useLab.getState().acceptPrediction(result) && mounted.current)
        setError('The world changed. Pause and predict again.');
    } catch (err) {
      if (mounted.current)
        setError(err instanceof Error ? err.message : 'Prediction could not be completed.');
    } finally {
      active.current = false;
      useLab.getState().set({ busy: null });
    }
  };
  const download = () => {
    if (!prediction) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(prediction, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `oracle-${prediction.model.id}-t${prediction.anchor.tick}-prediction.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const row = prediction && step > 0 ? prediction.metrics.horizons[step - 1] : null;
  const selected = row?.objects.find((body) => body.id === selectedId);
  const summary = prediction?.metrics.summary;
  return (
    <aside className="prediction-panel" aria-label="Prediction Lab controls">
      <div className="prediction-heading">
        <Sparkles size={15} />
        <span>PREDICTION LAB</span>
        <button
          aria-label="Refresh trained models"
          title="Refresh trained models"
          disabled={!!busy || loading}
          onClick={() => void load()}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {!prediction ? (
        <div className="prediction-intro">
          <span className="eyebrow">OBSERVE → PREDICT → MEASURE</span>
          <h2>A glimpse ahead.</h2>
          <p>Learned dynamics, measured against an independent physical future.</p>
        </div>
      ) : (
        <div className="forecast-active-model">
          <span className="eyebrow">CHECKPOINT VERIFIED</span>
          <strong>{prediction.model_version}</strong>
          <span>
            t{prediction.anchor.tick} → t{prediction.frames.at(-1)?.tick} ·{' '}
            {prediction.model.sample_stride} solver ticks / observation
          </span>
        </div>
      )}
      <details className="forecast-settings" open={!prediction}>
        <summary>
          Forecast settings{' '}
          <span>
            {model?.architecture.family.toUpperCase() || 'MODEL'} · {horizon} steps
          </span>
        </summary>
        <div className="forecast-config">
          <label>
            WORLD MODEL
            <select
              aria-label="Prediction model"
              value={modelId}
              disabled={!!busy || loading}
              onChange={(e) => {
                useLab.getState().set({ predictionModelId: e.target.value });
                setError(null);
                useLab.getState().set({ prediction: null });
              }}
            >
              {!catalog?.models.length && (
                <option value="">
                  {loading ? 'Loading local models…' : 'No completed models'}
                </option>
              )}
              {catalog?.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.architecture.family.toUpperCase()} · {m.id} · epoch {m.epoch}
                </option>
              ))}
            </select>
          </label>
          {model && (
            <div className="forecast-model-meta">
              <span>{model.architecture.history} observations</span>
              <span>{number(1 / model.sample_dt, 0)} Hz inference</span>
              <span>CPU</span>
            </div>
          )}
          <label>
            FUTURE HORIZON
            <select
              aria-label="Prediction horizon"
              value={horizon}
              disabled={!!busy}
              onChange={(e) =>
                useLab
                  .getState()
                  .set({ predictionHorizon: Number(e.target.value), prediction: null })
              }
            >
              {[1, 5, 10, 20, 50, 100, 120].map((n) => (
                <option key={n} value={n}>
                  {n} steps{model ? ` · ${number(n * model.sample_dt, 2)} s` : ''}
                </option>
              ))}
            </select>
          </label>
          {!catalog?.torch_available && catalog && (
            <p className="forecast-message">
              Install the ML dependencies described in README to run predictions.
            </p>
          )}
          {!loading && !model && (
            <div className="forecast-empty">
              <span>◈</span>
              <strong>Train your first world model.</strong>
              <p>Completed MLP and GRU checkpoints become available here.</p>
              <button onClick={() => useLab.getState().set({ page: 'research' })}>
                Open Research <ArrowRight size={12} />
              </button>
            </div>
          )}
          {model && world && (
            <>
              {world.playing ? (
                <p className="forecast-message">Pause the world to anchor a forecast.</p>
              ) : !compatible ? (
                <p className="forecast-message">
                  Model gravity differs from this world. Choose a compatible checkpoint.
                </p>
              ) : needed ? (
                <div className="forecast-preparation">
                  <p>
                    Record {needed} more physics ticks to capture real observations after the last
                    edit.
                  </p>
                  <button
                    disabled={disabled || world.tick + needed > 14400}
                    onClick={() => void record()}
                  >
                    Record observations <ArrowRight size={12} />
                  </button>
                </div>
              ) : (
                <p className="forecast-ready">
                  <i />
                  History ready · anchored at t{world.tick}
                </p>
              )}
              {!withinLimit && (
                <p className="forecast-message">
                  Shorten the horizon to stay within the experiment limit.
                </p>
              )}
              <button
                className="forecast-run"
                disabled={disabled || !!needed || !compatible || !withinLimit}
                onClick={() => void predict()}
              >
                <Sparkles size={14} />
                {busy === 'Predicting learned future' ? 'Computing future…' : 'Predict future'}
                <ArrowRight size={14} />
              </button>
            </>
          )}
          {error && (
            <p className="forecast-message error" role="alert">
              {error}
            </p>
          )}
          {!!catalog?.unavailable.length && (
            <p className="forecast-excluded">
              {catalog.unavailable.length} incompatible / unfinished checkpoint(s) excluded.
            </p>
          )}
        </div>
      </details>
      {prediction && summary ? (
        <div className="forecast-results">
          <div className="section-label">
            <span>MEASURED DIVERGENCE</span>
            <button
              aria-label="Clear forecast"
              onClick={() => useLab.getState().set({ prediction: null })}
            >
              <X size={13} />
            </button>
          </div>
          <div className="forecast-scorecards">
            <div>
              <small>MEAN PATH ERROR · ADE</small>
              <strong>
                {number(summary.ade_m)} <span>m</span>
              </strong>
            </div>
            <div>
              <small>ENDPOINT ERROR · FDE</small>
              <strong>
                {number(summary.fde_m)} <span>m</span>
              </strong>
            </div>
          </div>
          <div className="forecast-chart-heading">
            <span>DISPLACEMENT / m</span>
            <span>
              STEP {step} / {prediction.horizon}
            </span>
          </div>
          <Suspense fallback={<div className="forecast-chart">Loading measured errors…</div>}>
            <PredictionChart prediction={prediction} selectedId={selectedId} step={step} />
          </Suspense>
          <div className="forecast-chart-key">
            <span>
              <i />
              All objects
            </span>
            <span>
              <i />
              Selected object
            </span>
          </div>
          <label className="forecast-object-label">
            INSPECT OBJECT
            <select
              aria-label="Forecast object"
              value={
                prediction.metrics.objects.some((o) => o.id === selectedId) ? selectedId || '' : ''
              }
              onChange={(e) => useLab.getState().select(e.target.value || null)}
            >
              <option value="">All dynamic objects</option>
              {prediction.metrics.objects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.id}
                </option>
              ))}
            </select>
          </label>
          <div className="forecast-cursor-metrics">
            <span>
              Position gap
              <strong>{number(selected?.displacement_m ?? row?.displacement_m ?? 0)} m</strong>
            </span>
            <span>
              {selected ? 'Velocity gap' : 'Velocity MSE'}
              <strong>
                {number(selected?.velocity_error_m_s ?? row?.velocity_mse ?? 0)}{' '}
                {selected ? 'm/s' : '(m/s)²'}
              </strong>
            </span>
            <span>
              {selected ? 'Rotation gap' : 'Rotation MAE'}
              <strong>
                {number(selected?.rotation_error_rad ?? row?.rotation_mae_rad ?? 0)} rad
              </strong>
            </span>
            <span>
              {selected ? 'Contact onset · ML / actual' : 'Contact accuracy · full horizon'}
              <strong>
                {selected
                  ? `${selected.predicted_contact ? 'Yes' : 'No'} / ${selected.actual_contact ? 'Yes' : 'No'}`
                  : `${number(summary.contact_accuracy * 100, 1)}%`}
              </strong>
            </span>
          </div>
          <details className="forecast-provenance">
            <summary>Checkpoint & measurement details</summary>
            <dl>
              <dt>Model</dt>
              <dd>{prediction.model_version}</dd>
              <dt>Verified SHA-256</dt>
              <dd>{prediction.model.sha256}</dd>
              <dt>Training dataset</dt>
              <dd>{prediction.model.dataset_id}</dd>
              <dt>Position MSE</dt>
              <dd>{number(summary.position_mse)} m²</dd>
              <dt>Velocity MSE</dt>
              <dd>{number(summary.velocity_mse)} (m/s)²</dd>
              <dt>Contact balanced accuracy</dt>
              <dd>
                {summary.contact_balanced_accuracy === null
                  ? 'Undefined (single class)'
                  : `${number(summary.contact_balanced_accuracy * 100, 1)}%`}
              </dd>
              <dt>Contact TP / TN / FP / FN</dt>
              <dd>{Object.values(summary.contact_counts).join(' / ')}</dd>
            </dl>
          </details>
          <button className="forecast-export" onClick={download}>
            <Download size={13} />
            Export forecast & comparison
          </button>
        </div>
      ) : (
        model && (
          <div className="forecast-awaiting">
            <span className="forecast-orbit">◈</span>
            <h3>Two futures. One starting point.</h3>
            <p>
              Violet ghosts come from learned weights. Cyan traces come from a separate Pymunk
              replay.
            </p>
          </div>
        )
      )}
      <div className="forecast-footnote">
        <span>
          CONFIDENCE <strong>Not estimated</strong>
        </span>
        <p>
          The Lab is an exploratory scene. Training-distribution membership is not certified. Long
          forecasts can drift.
        </p>
        {prediction && (
          <p>
            Reference holds anchor conditions; later recorded edits are ignored. Live playhead
            remains at t{prediction.anchor.tick}.
          </p>
        )}
      </div>
    </aside>
  );
}
