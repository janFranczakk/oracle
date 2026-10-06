import { useEffect, useState } from 'react';
import { RefreshCw, Fingerprint } from 'lucide-react';
import { familyApi, familyMetric, meanSpread } from './families';
import type { SeedStudy, StudySummary } from './families';
import { groupName } from './training';
import './comparison.css';

export function FamilyDashboard() {
  const [catalog, setCatalog] = useState<StudySummary[]>([]);
  const [identity, setIdentity] = useState('');
  const [report, setReport] = useState<SeedStudy | null>(null);
  const [wantedGroup, setGroup] = useState('test');
  const [wantedHorizon, setHorizon] = useState(50);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    familyApi
      .catalog()
      .then(({ studies }) => {
        if (stopped) return;
        setCatalog(studies);
        setIdentity((current) =>
          studies.some((s) => s.id === current) ? current : (studies[0]?.id ?? ''),
        );
        setError('');
      })
      .catch((e) => {
        if (!stopped)
          setError(e instanceof Error ? e.message : 'Seed studies could not be loaded.');
      });
    return () => {
      stopped = true;
    };
  }, [revision]);
  useEffect(() => {
    let stopped = false;
    if (identity)
      familyApi
        .detail(identity)
        .then((value) => {
          if (!stopped) {
            setReport(value);
            setError('');
          }
        })
        .catch((e) => {
          if (!stopped) setError(e instanceof Error ? e.message : 'This study is unavailable.');
        });
    return () => {
      stopped = true;
    };
  }, [identity, revision]);
  const active = report?.id === identity ? report : null;
  const groups = active ? [...new Set(active.families[0].metrics.map((r) => r.group))] : [];
  const group = groups.includes(wantedGroup) ? wantedGroup : (groups[0] ?? 'test');
  const horizons = active
    ? [
        ...new Set(
          active.families[0].metrics
            .filter((r) => r.group === group && r.scope === 'rollout')
            .map((r) => r.horizon),
        ),
      ]
    : [];
  const horizon = horizons.includes(wantedHorizon) ? wantedHorizon : (horizons.at(-1) ?? 1);
  return (
    <div className="comparison-dashboard">
      <header className="comparison-heading">
        <div>
          <span className="eyebrow cyan">RESEARCH / TRAINING SEED REPEATS</span>
          <h1>Families across seeds.</h1>
          <p>
            Measured variation on fixed data and shared anchors. Mean ± sample standard deviation.
          </p>
        </div>
        <button className="button" onClick={() => setRevision((r) => r + 1)}>
          <RefreshCw size={14} />
          Refresh seed studies
        </button>
      </header>
      {error && (
        <div className="comparison-message error" role="alert">
          {error}
        </div>
      )}
      <div className="comparison-toolbar">
        <label>
          COMPLETED STUDY
          <select
            aria-label="Seed study"
            value={identity}
            onChange={(e) => {
              setIdentity(e.target.value);
              setReport(null);
            }}
          >
            {!catalog.length && <option value="">No completed study</option>}
            {catalog.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.seeds.length} seeds
              </option>
            ))}
          </select>
        </label>
        {active && (
          <>
            <label>
              EVALUATION GROUP
              <select
                aria-label="Family evaluation group"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g === 'ood/macro' ? 'OOD · equal-suite macro' : groupName(g)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              HORIZON
              <select
                aria-label="Family evaluation horizon"
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
              >
                {horizons.map((h) => (
                  <option key={h} value={h}>
                    +{h} observations
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      {!active ? (
        <div className="comparison-empty">
          <Fingerprint size={24} />
          <h2>
            {identity ? 'Loading measured seed study…' : 'Repeat training. Keep the evidence.'}
          </h2>
          <p>
            Completed studies appear here after the bounded CLI experiment. Single checkpoint
            comparison remains a separate Research view.
          </p>
          <code>
            python -m oracle.multiseed --dataset datasets/your-dataset --output
            experiments/multiseed/my-study
          </code>
        </div>
      ) : (
        <>
          <div className="comparison-protocol">
            <div>
              <span className="eyebrow">FIXED EXPERIMENT PROTOCOL</span>
              <h2>
                {active.families.length} families · {active.config.seeds.length} seeds each
              </h2>
              <p>
                {active.provenance.dataset.id} · {active.config.training.epochs} epochs ·{' '}
                {active.config.training.model.history} observed history frames
              </p>
            </div>
          </div>
          <div className="comparison-table-scroll">
            <table aria-label="Measured multi-seed family comparison">
              <thead>
                <tr>
                  <th>FAMILY</th>
                  <th>1-STEP MSE · m²</th>
                  <th>ADE +{horizon} · m</th>
                  <th>FDE +{horizon} · m</th>
                  <th>FDE MEAN 95% CI</th>
                  <th>DEFINED SEEDS</th>
                </tr>
              </thead>
              <tbody>
                {active.families.map((f) => {
                  const fde = familyMetric(f, group, 'rollout', horizon, 'fde_m');
                  return (
                    <tr key={f.family}>
                      <th>
                        {f.family.toUpperCase()}
                        <small>seeds {f.seeds.join(', ')}</small>
                      </th>
                      <td>{meanSpread(familyMetric(f, group, 'one_step', 1, 'position_mse'))}</td>
                      <td>{meanSpread(familyMetric(f, group, 'rollout', horizon, 'ade_m'))}</td>
                      <td>{meanSpread(fde)}</td>
                      <td>
                        {fde?.mean_ci95
                          ? `[${fde.mean_ci95.map((v) => v.toFixed(3)).join(', ')}]`
                          : '—'}
                      </td>
                      <td>
                        {fde?.n ?? 0} / {f.seeds.length}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="comparison-table-scroll">
            <table aria-label="Family metric statistics">
              <thead>
                <tr>
                  <th>FAMILY / METRIC</th>
                  <th>MEAN ± STD</th>
                  <th>MEDIAN</th>
                  <th>MIN / MAX</th>
                  <th>DEFINED / MISSING</th>
                </tr>
              </thead>
              <tbody>
                {active.families.flatMap((f) =>
                  f.metrics
                    .filter(
                      (r) => r.group === group && (r.scope === 'one_step' || r.horizon === horizon),
                    )
                    .map((r) => (
                      <tr key={`${f.family}-${r.scope}-${r.metric}`}>
                        <th>
                          {f.family.toUpperCase()}
                          <small>
                            {r.scope} · {r.metric}
                          </small>
                        </th>
                        <td>{meanSpread(r.statistics)}</td>
                        <td>{r.statistics.median?.toFixed(4) ?? '—'}</td>
                        <td>
                          {r.statistics.min?.toFixed(4) ?? '—'} /{' '}
                          {r.statistics.max?.toFixed(4) ?? '—'}
                        </td>
                        <td>
                          {r.statistics.n} / {r.statistics.missing}
                        </td>
                      </tr>
                    )),
                )}
              </tbody>
            </table>
          </div>
          <p className="comparison-caption">{active.provenance.confidence_method}</p>
          <p className="comparison-caption">{active.interpretation}</p>
          <details className="family-provenance">
            <summary>Checkpoint provenance and shared schedules</summary>
            {active.families.flatMap((f) =>
              f.runs.map((r) => (
                <p key={r.id}>
                  {r.id} · validation-selected epoch {r.selected_epoch}
                  <br />
                  <code>{r.checkpoint_sha256}</code>
                </p>
              )),
            )}
            <p>
              Dataset SHA-256
              <br />
              <code>{active.provenance.dataset.content_sha256}</code>
            </p>
            {Object.entries(active.schedule_sha256).map(([g, sha]) => (
              <p key={g}>
                {g}
                <br />
                <code>{sha}</code>
              </p>
            ))}
          </details>
        </>
      )}
    </div>
  );
}
