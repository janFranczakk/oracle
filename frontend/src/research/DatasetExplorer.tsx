import { Distribution } from './Distribution';
import { EpisodeObserver } from './EpisodeObserver';
import { useEffect, useMemo, useState } from 'react';
import { Check, Database, Fingerprint, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { collectionConfig, datasetApi, filterEpisodes, splits, suiteNames } from './dataset';
import type { CatalogItem, CollectionJob, DatasetDetail, EpisodePreview, Split } from './dataset';

const JOB_KEY = 'oracle.dataset-job.v1';
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Dataset request failed. Try refreshing the catalog.';

export function DatasetExplorer() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [datasetId, setDatasetId] = useState('');
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [preview, setPreview] = useState<EpisodePreview | null>(null);
  const [split, setSplit] = useState<Split>('train');
  const [suite, setSuite] = useState('all');
  const [episodeId, setEpisodeId] = useState('');
  const [seed, setSeed] = useState('42');
  const [size, setSize] = useState('standard');
  const [seconds, setSeconds] = useState('4');
  const [refresh, setRefresh] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lowerView, setLowerView] = useState('distributions');
  const [job, setJob] = useState<CollectionJob | null>(() => {
    const id = localStorage.getItem(JOB_KEY);
    return id ? { id, status: 'running', phase: 'reconnecting', completed: 0, total: 0 } : null;
  });

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    void datasetApi
      .catalog()
      .then(({ datasets }) => {
        if (cancelled) return;
        setCatalog(datasets);
        setDatasetId((previous) =>
          datasets.some((d) => d.id === previous) ? previous : datasets[0]?.id || '',
        );
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(message(e));
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    setDetail(null);
    setPreview(null);
    void datasetApi
      .detail(datasetId)
      .then((value) => {
        if (!cancelled) {
          setDetail(value);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(message(e));
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, refresh]);

  const entries = useMemo(
    () => filterEpisodes(detail?.manifest.episodes || [], split, suite),
    [detail, split, suite],
  );
  const activeEntry = entries.find((e) => e.id === episodeId) || entries[0];
  const activeId = activeEntry?.id;
  useEffect(() => {
    if (!activeId || !datasetId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    void datasetApi
      .episode(datasetId, activeId)
      .then((value) => {
        if (!cancelled) {
          setPreview(value);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(message(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, activeId]);

  const jobId = job?.status === 'running' ? job.id : '';
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await datasetApi.job(jobId);
        if (cancelled) return;
        setJob(value);
        if (value.status === 'running') timer = setTimeout(() => void poll(), 750);
        else {
          localStorage.removeItem(JOB_KEY);
          if (value.status === 'complete') {
            setDatasetId(value.dataset_id || '');
            setRefresh((n) => n + 1);
          } else setError(value.error || 'Collection failed. Inspect the local worker log.');
        }
      } catch (e) {
        if (!cancelled) {
          setError(message(e));
          setJob(null);
          localStorage.removeItem(JOB_KEY);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  const collect = async () => {
    setError(null);
    setStarting(true);
    try {
      const result = await datasetApi.collect(collectionConfig(seed, size, seconds));
      setJob(result);
      if (result.status === 'running') localStorage.setItem(JOB_KEY, result.id);
      else {
        setDatasetId(result.dataset_id || '');
        setRefresh((n) => n + 1);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setStarting(false);
    }
  };
  const running = starting || job?.status === 'running';
  const manifest = detail?.manifest;
  const allEntries = manifest?.episodes || [];
  const pairCount = allEntries.reduce((n, e) => n + e.pairs, 0);
  const percent = job?.total ? Math.round((job.completed / job.total) * 100) : 0;

  return (
    <div className="dataset-explorer">
      <div className="dataset-intro">
        <div>
          <span className="eyebrow cyan">RESEARCH / DATASET ENGINE</span>
          <h1>Evidence before intelligence.</h1>
          <p>Reproducible observations. Independent episodes. Deliberate distribution shifts.</p>
        </div>
        <span className="tag violet">STAGE 02 · GROUND TRUTH</span>
      </div>
      <div className="collection-bar">
        <label>
          EXPERIMENT SEED
          <input
            aria-label="Dataset seed"
            inputMode="numeric"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            disabled={running}
          />
        </label>
        <label>
          COLLECTION SIZE
          <select
            aria-label="Collection size"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            disabled={running}
          >
            <option value="compact">Compact · 18 episodes</option>
            <option value="standard">Standard · 64 episodes</option>
            <option value="extended">Extended · 216 episodes</option>
          </select>
        </label>
        <label>
          EPISODE DURATION
          <select
            aria-label="Episode duration"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            disabled={running}
          >
            <option value="2">2 seconds</option>
            <option value="4">4 seconds</option>
            <option value="8">8 seconds</option>
          </select>
        </label>
        <span className="collection-frequency">
          120 Hz PHYSICS
          <br />
          <strong>30 Hz OBSERVATIONS</strong>
        </span>
        <button className="button primary" onClick={() => void collect()} disabled={running}>
          {running ? <LoaderCircle className="spin" size={15} /> : <Database size={15} />}{' '}
          {running ? 'Collecting observations' : 'Collect dataset'}
        </button>
      </div>
      {error && (
        <div className="dataset-error" role="alert">
          {error}
          <button className="button small" onClick={() => setRefresh((n) => n + 1)}>
            Refresh catalog
          </button>
        </div>
      )}
      {job?.status === 'running' && (
        <div className="collection-progress">
          <div>
            <span>
              {job.phase === 'normalizing'
                ? 'Fitting train-only normalization'
                : 'Collecting ground-truth episodes'}
            </span>
            <strong>
              {job.completed} / {job.total || '…'}
            </strong>
          </div>
          <div
            role="progressbar"
            aria-label="Dataset collection progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <p>
            A separate Python process runs the shared solver. The laboratory remains interactive.
          </p>
        </div>
      )}
      {catalogLoading && !manifest ? (
        <div className="dataset-empty">
          <LoaderCircle className="spin" size={28} />
          <h2>Opening the observation catalog</h2>
          <p>Checking versioned manifests and normalization provenance.</p>
        </div>
      ) : !catalog.length ? (
        <div className="dataset-empty">
          <Database size={34} />
          <span className="eyebrow">NO DATASET COLLECTED YET</span>
          <h2>A model begins with observations.</h2>
          <p>
            Collect seeded episodes from the real physics engine. Each collection includes
            independent train, validation and test episodes, plus six OOD suites.
          </p>
          <div>
            <span>01 · Collect</span>
            <span>02 · Inspect</span>
            <span>03 · Train in Stage 3</span>
          </div>
        </div>
      ) : (
        <>
          <div className="dataset-catalog-bar">
            <label>
              ACTIVE COLLECTION
              <select
                aria-label="Active dataset"
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
              >
                {catalog.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} · seed {item.config.seed} · {item.episode_count} episodes
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button small"
              aria-label="Refresh dataset catalog"
              onClick={() => setRefresh((n) => n + 1)}
            >
              <RefreshCw size={13} />
            </button>
            <span>
              <Fingerprint size={14} />
              {manifest?.content_sha256.slice(0, 16) || 'CHECKING'}
              <i> SHA-256</i>
            </span>
          </div>
          {!detail ? (
            <div className="dataset-empty">
              <LoaderCircle className="spin" size={24} />
              <h2>Loading collection metadata</h2>
            </div>
          ) : (
            <>
              <div className="dataset-metrics">
                <div>
                  <span>EPISODES</span>
                  <strong>{allEntries.length.toLocaleString()}</strong>
                  <small>split by independent episode</small>
                </div>
                <div>
                  <span>TRANSITION PAIRS</span>
                  <strong>{pairCount.toLocaleString()}</strong>
                  <small>adjacent observed states</small>
                </div>
                <div>
                  <span>OOD SUITES</span>
                  <strong>06</strong>
                  <small>explicit initial-condition shifts</small>
                </div>
                <div>
                  <span>NORMALIZATION</span>
                  <strong className="cyan">
                    TRAIN ONLY <Check size={16} />
                  </strong>
                  <small>
                    {detail.normalization.observations.toLocaleString()} dynamic observations
                  </small>
                </div>
              </div>
              <div className="dataset-main">
                <aside className="episode-library">
                  <div className="dataset-panel-heading">
                    <span className="eyebrow">EPISODE LIBRARY</span>
                    <span>{entries.length}</span>
                  </div>
                  <div className="split-tabs">
                    {splits.map((s) => (
                      <button
                        key={s}
                        className={`split-${s} ${split === s ? 'selected' : ''}`}
                        aria-pressed={split === s}
                        onClick={() => setSplit(s)}
                      >
                        {s === 'validation' ? 'VAL' : s.toUpperCase()}
                        <span>{allEntries.filter((e) => e.split === s).length}</span>
                      </button>
                    ))}
                  </div>
                  {split === 'ood' && (
                    <select
                      className="suite-filter"
                      aria-label="OOD suite"
                      value={suite}
                      onChange={(e) => setSuite(e.target.value)}
                    >
                      <option value="all">All distribution shifts</option>
                      {Object.entries(suiteNames)
                        .filter(([key]) => key !== 'in_distribution')
                        .map(([key, name]) => (
                          <option value={key} key={key}>
                            {name}
                          </option>
                        ))}
                    </select>
                  )}
                  <div className="episode-list">
                    {entries.map((entry, index) => (
                      <button
                        key={entry.id}
                        className={activeId === entry.id ? 'selected' : ''}
                        aria-label={`Open ${entry.split} episode ${index + 1}`}
                        aria-pressed={activeId === entry.id}
                        onClick={() => setEpisodeId(entry.id)}
                      >
                        <div>
                          <span>EP {String(index + 1).padStart(3, '0')}</span>
                          <span>{entry.dynamic_objects} BODIES</span>
                        </div>
                        <strong>{suiteNames[entry.suite]}</strong>
                        <small>SEED {entry.seed}</small>
                      </button>
                    ))}
                  </div>
                  <div className="episode-library-foot">
                    <ShieldCheck size={14} />
                    <span>
                      Disjoint episode seeds
                      <br />
                      No frame-level split leakage
                    </span>
                  </div>
                </aside>
                {loading ? (
                  <div className="episode-loading">
                    <LoaderCircle className="spin" size={24} />
                    <p>Verifying and loading episode</p>
                  </div>
                ) : preview ? (
                  <EpisodeObserver key={preview.entry.id} preview={preview} />
                ) : (
                  <div className="episode-loading">
                    <Database size={24} />
                    <p>No episode available for this selection.</p>
                  </div>
                )}
              </div>
              <div className="dataset-analysis">
                <div className="dataset-analysis-heading">
                  <div>
                    <button
                      className={lowerView === 'distributions' ? 'selected' : ''}
                      onClick={() => setLowerView('distributions')}
                    >
                      Initial distributions
                    </button>
                    <button
                      className={lowerView === 'normalization' ? 'selected' : ''}
                      onClick={() => setLowerView('normalization')}
                    >
                      Normalization provenance
                    </button>
                  </div>
                  <span>
                    {splits.map((s) => (
                      <i key={s} className={`split-${s}`}>
                        {s === 'validation' ? 'VAL' : s.toUpperCase()}
                      </i>
                    ))}
                  </span>
                </div>
                {lowerView === 'distributions' ? (
                  <div className="distribution-grid">
                    <Distribution
                      entries={allEntries}
                      field="initial_masses"
                      max={10}
                      title="MASS"
                      unit="kg"
                    />
                    <Distribution
                      entries={allEntries}
                      field="initial_speeds"
                      max={16}
                      title="SPEED"
                      unit="m/s"
                    />
                  </div>
                ) : (
                  <div className="normalization-view">
                    <div>
                      <ShieldCheck size={22} />
                      <h3>Fit on training observations.</h3>
                      <p>
                        Population z-score over dynamic objects, with static context excluded from
                        fitting. The same parameters transform every split; OOD values remain
                        unclipped.
                      </p>
                      <span>
                        {Object.keys(detail.normalization.source_episodes).length} TRAIN EPISODES ·
                        13 CONTINUOUS FEATURES
                      </span>
                    </div>
                    <div className="normalization-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Feature</th>
                            <th>Mean</th>
                            <th>Scale</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.normalization.feature_names.map((name, i) => (
                            <tr key={name}>
                              <td>{name}</td>
                              <td>{detail.normalization.mean[i].toFixed(4)}</td>
                              <td>{detail.normalization.scale[i].toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              <p className="dataset-integrity-note">
                Ground-truth observations only. OOD labels describe held-out initial conditions;
                generalization scores require a trained model. Dataset files stay local and are
                excluded from Git.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
