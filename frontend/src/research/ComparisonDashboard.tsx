import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, FlaskConical, LoaderCircle, Pin, Play, RefreshCw } from 'lucide-react';
import { datasetApi } from './dataset';
import type { CatalogItem } from './dataset';
import { groupName } from './training';
import { comparisonConfig, compatibleCheckpoint, researchApi, researchGroups } from './comparison';
import type { BatchDetail, BatchSummary, Checkpoint, Notes } from './comparison';
import { ComparisonResults } from './ComparisonResults';
import './comparison.css';

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : 'Research artifacts could not be loaded.';
export function ComparisonDashboard() {
  const [catalog, setCatalog] = useState<Checkpoint[]>([]);
  const [datasets, setDatasets] = useState<CatalogItem[]>([]);
  const [datasetId, setDatasetId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [groups, setGroups] = useState(researchGroups);
  const [horizons, setHorizons] = useState('1, 5, 10, 20, 50');
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchId, setBatchId] = useState('');
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [inspect, setInspect] = useState('');
  const [label, setLabel] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [unavailableCount, setUnavailableCount] = useState(0);
  const initialized = useRef(false);
  const checkpointPanel = useRef<HTMLElement>(null);
  const load = useCallback(async () => {
    const [checkpoints, data, jobs] = await Promise.all([
      researchApi.checkpoints(),
      datasetApi.catalog(),
      researchApi.batches(),
    ]);
    setCatalog(checkpoints.models);
    setDatasets(data.datasets);
    setBatches(jobs.batches);
    setAvailable(checkpoints.torch_available);
    const initialDataset =
      data.datasets.find(
        (d) =>
          checkpoints.models.filter((m) => compatibleCheckpoint(m, d) && !m.archived).length >= 2,
      ) ?? data.datasets[0];
    if (!initialized.current) {
      initialized.current = true;
      setDatasetId(initialDataset?.id || '');
      setSelected(
        checkpoints.models
          .filter((m) => compatibleCheckpoint(m, initialDataset) && !m.archived)
          .slice(0, 3)
          .map((m) => m.id),
      );
    } else {
      setSelected((current) =>
        current.filter((id) => checkpoints.models.some((m) => m.id === id && !m.archived)),
      );
    }
    setBatchId((current) => current || jobs.batches[0]?.id || '');
    setUnavailableCount(checkpoints.unavailable.length);
  }, []);
  useEffect(() => {
    let mounted = true;
    load().catch((e) => {
      if (mounted) setError(errorMessage(e));
    });
    return () => {
      mounted = false;
    };
  }, [load]);
  useEffect(() => {
    if (inspect) checkpointPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [inspect]);
  useEffect(() => {
    if (!batchId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const value = await researchApi.detail(batchId);
        if (stopped) return;
        setDetail(value);
        setBatches((current) =>
          current.some((b) => b.id === value.summary.id)
            ? current.map((b) => (b.id === value.summary.id ? value.summary : b))
            : [value.summary, ...current],
        );
        if (value.summary.status === 'running') timer = setTimeout(poll, 1200);
      } catch (e) {
        if (!stopped) setError(errorMessage(e));
      }
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [batchId]);
  const dataset = datasets.find((d) => d.id === datasetId);
  const checkpoint = catalog.find((m) => m.id === inspect);
  const running =
    detail?.summary.status === 'running' || batches.some((b) => b.status === 'running');
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const timer = setInterval(() => {
      void researchApi
        .batches()
        .then((value) => {
          if (!stopped) setBatches(value.batches);
        })
        .catch((e) => {
          if (!stopped) setError(errorMessage(e));
        });
    }, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [running]);
  const changeNotes = async (model: Checkpoint, update: Partial<Notes>) => {
    setBusy(true);
    setError(null);
    try {
      const value = await researchApi.notes(model.id, {
        label: model.label,
        pinned: model.pinned,
        archived: model.archived,
        ...update,
      });
      setCatalog((current) => current.map((m) => (m.id === model.id ? { ...m, ...value } : m)));
      if (value.archived) setSelected((current) => current.filter((id) => id !== model.id));
      setNotice(
        value.archived
          ? 'Checkpoint archived from comparison selection. Restore it below when needed.'
          : 'Checkpoint notes saved.',
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const value = await researchApi.start(
        comparisonConfig(datasetId, selected, horizons, groups),
      );
      setDetail({ summary: value, report: null });
      setBatches((current) => [value, ...current]);
      setBatchId(value.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="comparison-dashboard">
      <header className="comparison-heading">
        <div>
          <span className="eyebrow cyan">RESEARCH / MATCHED EXPERIMENTS</span>
          <h1>Same evidence. Different models.</h1>
          <p>
            Compare fixed checkpoints on shared observations. Keep the conditions, change the
            hypothesis.
          </p>
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            setError(null);
            void load().catch((e) => setError(errorMessage(e)));
          }}
        >
          <RefreshCw size={14} />
          Refresh research
        </button>
      </header>
      {error && (
        <div className="comparison-message error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="comparison-message" role="status">
          {notice}
        </div>
      )}
      <div className="comparison-workspace">
        <aside className="comparison-controls" aria-label="Research batch configuration">
          <div className="comparison-panel-heading">
            <span className="eyebrow">CHECKPOINT ROSTER</span>
            <span>{selected.length} / 4</span>
          </div>
          <label className="comparison-field">
            SHARED DATASET
            <select
              aria-label="Comparison dataset"
              value={datasetId}
              onChange={(e) => {
                setDatasetId(e.target.value);
                setSelected([]);
              }}
            >
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.episode_count} episodes · Seed {d.config.seed}
                </option>
              ))}
            </select>
          </label>
          <p className="comparison-caption">
            Each checkpoint must share this dataset and its train-only normalizer.
          </p>
          {unavailableCount > 0 && (
            <p className="comparison-caption">
              {unavailableCount} checkpoint {unavailableCount === 1 ? 'entry is' : 'entries are'}{' '}
              unavailable.
            </p>
          )}
          <div className="checkpoint-roster">
            {[...catalog]
              .sort((a, b) => Number(b.pinned) - Number(a.pinned))
              .filter((m) => showArchive || !m.archived)
              .map((model) => {
                const compatible = compatibleCheckpoint(model, dataset);
                return (
                  <div
                    className={`comparison-checkpoint ${selected.includes(model.id) ? 'selected' : ''} ${model.archived ? 'archived' : ''}`}
                    key={model.id}
                  >
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Compare ${model.id}`}
                        checked={selected.includes(model.id)}
                        disabled={
                          busy ||
                          model.archived ||
                          !compatible ||
                          (!selected.includes(model.id) && selected.length >= 4)
                        }
                        onChange={(e) =>
                          setSelected((current) =>
                            e.target.checked
                              ? [...current, model.id]
                              : current.filter((id) => id !== model.id),
                          )
                        }
                      />
                      <strong>{model.architecture.family.toUpperCase()}</strong>
                      <span>{model.architecture.history}f</span>
                    </label>
                    <button
                      className="checkpoint-inspect"
                      aria-label={`Inspect ${model.id}`}
                      onClick={() => {
                        setInspect(model.id);
                        setLabel(model.label);
                      }}
                    >
                      {model.label || model.id}
                      <small>
                        {model.parameters.toLocaleString()} parameters · Seed {model.training_seed}
                      </small>
                    </button>
                    <div className="checkpoint-actions">
                      <span>
                        {model.archived
                          ? 'ARCHIVED'
                          : compatible
                            ? `EPOCH ${model.epoch}`
                            : 'DIFFERENT DATASET'}
                      </span>
                      <button
                        aria-label={`${model.pinned ? 'Unpin' : 'Pin'} ${model.id}`}
                        disabled={busy}
                        className={model.pinned ? 'active' : ''}
                        onClick={() => void changeNotes(model, { pinned: !model.pinned })}
                      >
                        <Pin size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            {!catalog.length && (
              <p className="comparison-caption">
                Complete training runs in World model to compare their checkpoints.
              </p>
            )}
          </div>
          <label className="comparison-archive-toggle">
            <input
              type="checkbox"
              checked={showArchive}
              onChange={(e) => setShowArchive(e.target.checked)}
            />
            Show archived checkpoints
          </label>
          <label className="comparison-field">
            OBSERVATION HORIZONS
            <input
              aria-label="Comparison horizons"
              value={horizons}
              onChange={(e) => setHorizons(e.target.value)}
            />
          </label>
          <fieldset className="comparison-groups">
            <legend>TEST / OOD MATRIX</legend>
            {researchGroups.map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={groups.includes(key)}
                  onChange={(e) =>
                    setGroups((current) =>
                      e.target.checked
                        ? researchGroups.filter((g) => g === key || current.includes(g))
                        : current.filter((g) => g !== key),
                    )
                  }
                />
                {groupName(key)}
              </label>
            ))}
          </fieldset>
          <button
            className="button primary comparison-start"
            disabled={busy || running || !available || selected.length < 2 || !groups.length}
            onClick={() => void start()}
          >
            {running ? <LoaderCircle size={15} /> : <Play size={15} />}Run matched batch
          </button>
          <p className="comparison-caption">
            {selected.length * groups.length} model / group evaluations · CPU, 2 threads ·
            Deterministic forecasts.
          </p>
          {!available && (
            <p className="comparison-caption">Install the ML dependencies documented in README.</p>
          )}
        </aside>
        <section className="comparison-results" aria-label="Matched model comparison">
          {detail?.summary.status === 'running' && (
            <div className="batch-progress">
              <LoaderCircle size={16} />
              <div>
                <strong>
                  {detail.summary.phase === 'starting'
                    ? 'Preparing shared evidence…'
                    : `Evaluating ${detail.summary.model_id ?? 'checkpoints'}`}
                </strong>
                <p>
                  {detail.summary.group
                    ? groupName(detail.summary.group)
                    : 'Verifying checkpoint and dataset provenance'}
                </p>
                <progress value={detail.summary.completed} max={detail.summary.total} />
              </div>
              <span>
                {detail.summary.completed} / {detail.summary.total}
              </span>
            </div>
          )}
          {detail?.summary.status === 'failed' && (
            <div className="comparison-message error" role="alert">
              {detail.summary.error}
            </div>
          )}
          {detail?.report ? (
            <ComparisonResults report={detail.report} />
          ) : (
            !running &&
            !detail?.summary.error && (
              <div className="comparison-empty">
                <FlaskConical size={28} />
                <span className="eyebrow">A CONTROLLED COMPARISON</span>
                <h2>Hold the evidence constant.</h2>
                <p>
                  Select checkpoints trained on the same dataset. A batch evaluates shared targets
                  and anchors across test and OOD conditions.
                </p>
                <div>
                  <span>01 / SELECT WEIGHTS</span>
                  <span>02 / MATCH SAMPLES</span>
                  <span>03 / MEASURE</span>
                </div>
              </div>
            )
          )}
          <section className="comparison-batches">
            <div className="comparison-panel-heading">
              <span className="eyebrow">PERSISTENT BATCH LOG</span>
              <span>{batches.length} runs</span>
            </div>
            <div className="comparison-batch-list">
              {batches.map((b) => (
                <button
                  key={b.id}
                  className={b.id === batchId ? 'selected' : ''}
                  onClick={() => {
                    if (b.id !== batchId) {
                      setDetail(null);
                      setBatchId(b.id);
                    }
                  }}
                >
                  <strong>{b.id}</strong>
                  <span>
                    {b.status.toUpperCase()} · {b.completed}/{b.total}
                  </span>
                </button>
              ))}
              {!batches.length && (
                <p className="comparison-caption">
                  Your first completed report will remain available here.
                </p>
              )}
            </div>
          </section>
          {checkpoint && (
            <section
              ref={checkpointPanel}
              className="comparison-checkpoint-detail"
              aria-label="Checkpoint management"
            >
              <div className="comparison-panel-heading">
                <span className="eyebrow">CHECKPOINT / {checkpoint.id}</span>
                <span>{(checkpoint.bytes / 1024 / 1024).toFixed(2)} MiB</span>
              </div>
              <p>
                {checkpoint.architecture.family.toUpperCase()} · epoch {checkpoint.epoch} · seed{' '}
                {checkpoint.training_seed} · {checkpoint.parameters.toLocaleString()} parameters
              </p>
              <code>{checkpoint.sha256}</code>
              <div>
                <label>
                  DISPLAY LABEL
                  <input
                    aria-label="Checkpoint display label"
                    maxLength={64}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </label>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void changeNotes(checkpoint, { label })}
                >
                  Save checkpoint label
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void changeNotes(checkpoint, { archived: !checkpoint.archived })}
                >
                  <Archive size={13} />
                  {checkpoint.archived ? 'Restore checkpoint' : 'Archive from comparisons'}
                </button>
              </div>
            </section>
          )}
        </section>
      </div>
    </div>
  );
}
