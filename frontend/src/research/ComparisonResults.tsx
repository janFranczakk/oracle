import { useState } from 'react';
import { Download, Fingerprint } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { comparisonChart, comparisonCsv, oodMean } from './comparison';
import type { ComparisonReport } from './comparison';
import { groupName, measured } from './training';

const colors = ['#93e3eb', '#a79ad7', '#dfb978', '#9eb5db'];
function download(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function ComparisonResults({ report }: { report: ComparisonReport }) {
  const [wantedGroup, setGroup] = useState('test');
  const [wantedHorizon, setHorizon] = useState(50);
  const group = report.models[0].groups[wantedGroup]
    ? wantedGroup
    : Object.keys(report.models[0].groups)[0];
  const result = report.models[0].groups[group];
  const horizon = result.rollout.learned.some((r) => r.horizon === wantedHorizon)
    ? wantedHorizon
    : result.rollout.learned.at(-1)!.horizon;
  return (
    <>
      <div className="comparison-protocol">
        <div>
          <span className="eyebrow">SHARED SAMPLE PROTOCOL</span>
          <h2>
            {report.models.length} checkpoints · {Object.keys(report.schedule_sha256).length} groups
          </h2>
          <p>
            Common history {report.common_history} observations · {result.windows} matched one-step
            targets · {result.anchors.length} rollout anchors
          </p>
        </div>
        <span className="comparison-complete">
          COMPLETE / {report.elapsed_seconds.toFixed(2)} s
        </span>
      </div>
      <div className="comparison-toolbar">
        <label>
          OBSERVED GROUP
          <select
            aria-label="Comparison evaluation group"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            {Object.keys(report.models[0].groups).map((key) => (
              <option key={key} value={key}>
                {groupName(key)}
              </option>
            ))}
          </select>
        </label>
        <div className="comparison-exports">
          <button
            className="button"
            onClick={() =>
              download(
                `oracle-${report.id}.json`,
                JSON.stringify(report, null, 2),
                'application/json',
              )
            }
          >
            <Download size={13} />
            Export comparison JSON
          </button>
          <button
            className="button"
            onClick={() =>
              download(`oracle-${report.id}.csv`, comparisonCsv(report), 'text/csv;charset=utf-8')
            }
          >
            <Download size={13} />
            Export comparison CSV
          </button>
        </div>
      </div>
      <div className="comparison-table-scroll">
        <table aria-label="Measured checkpoint comparison">
          <thead>
            <tr>
              <th>CHECKPOINT</th>
              <th>PARAMS</th>
              <th>1-STEP MSE · m²</th>
              <th>FDE +10 · m</th>
              <th>FDE +50 · m</th>
              <th>FORWARD · ms</th>
              <th>OOD FDE +{horizon} · m</th>
            </tr>
          </thead>
          <tbody>
            {report.models.map((model, i) => {
              const scores = model.groups[group];
              return (
                <tr key={model.id}>
                  <th>
                    <i style={{ background: colors[i] }} />
                    <strong>{model.architecture.family.toUpperCase()}</strong>
                    <span>{model.label || model.id}</span>
                  </th>
                  <td>{model.parameters.toLocaleString()}</td>
                  <td>{measured(scores.one_step.learned.position_mse)}</td>
                  <td>{measured(scores.rollout.learned.find((r) => r.horizon === 10)?.fde_m)}</td>
                  <td>{measured(scores.rollout.learned.find((r) => r.horizon === 50)?.fde_m)}</td>
                  <td>
                    {model.latency.median_ms.toFixed(3)}
                    <small>p95 {model.latency.p95_ms.toFixed(3)}</small>
                  </td>
                  <td>{measured(oodMean(model, horizon))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="comparison-caption">
        OOD is the unweighted mean across selected OOD suites. Forward timing is a warmed
        single-scene CPU call on {groupName(report.models[0].latency.group)}; loading and dataset
        I/O are excluded. Missing horizons stay unavailable.
      </p>
      <div className="comparison-chart-panel">
        <div className="comparison-panel-heading">
          <span className="eyebrow">FREE ROLLOUT / ADE · m</span>
          <div className="comparison-legend">
            {report.models.map((m, i) => (
              <span key={m.id}>
                <i style={{ background: colors[i] }} />
                {m.architecture.family.toUpperCase()}
              </span>
            ))}
            <span>
              <i />
              Constant velocity
            </span>
          </div>
        </div>
        <div className="comparison-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={comparisonChart(report, group)}
              margin={{ top: 8, right: 22, left: 0, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke="var(--line-soft)" />
              <XAxis
                dataKey="horizon"
                type="number"
                domain={['dataMin', 'dataMax']}
                tick={{ fill: 'var(--dim)', fontSize: 9, fontFamily: 'var(--mono)' }}
              />
              <YAxis tick={{ fill: 'var(--dim)', fontSize: 9, fontFamily: 'var(--mono)' }} />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  fontSize: 10,
                }}
              />
              {report.models.map((m, i) => (
                <Line
                  key={m.id}
                  dataKey={`model${i}`}
                  name={m.label || m.id}
                  stroke={colors[i]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  isAnimationActive={false}
                />
              ))}
              <Line
                dataKey="reference"
                name="Constant velocity"
                stroke="var(--dim)"
                strokeDasharray="4 5"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="comparison-horizons">
          {result.rollout.learned.map((row) => (
            <button
              key={row.horizon}
              className={horizon === row.horizon ? 'selected' : ''}
              onClick={() => setHorizon(row.horizon)}
            >
              +{row.horizon}
            </button>
          ))}
        </div>
        <div className="comparison-detail-metrics">
          {report.models.map((m, i) => {
            const row = m.groups[group].rollout.learned.find((r) => r.horizon === horizon);
            return (
              <div key={m.id}>
                <span style={{ color: colors[i] }}>
                  {m.architecture.family.toUpperCase()} / +{horizon}
                </span>
                <strong>
                  {measured(row?.fde_m)}
                  <small>m FDE</small>
                </strong>
                <p>
                  ADE {measured(row?.ade_m)} m · {row?.objects_scored ?? 0} objects scored
                </p>
              </div>
            );
          })}
        </div>
      </div>
      {result.omitted_horizons.length > 0 && (
        <p className="comparison-caption">
          Episode length omitted horizons: {result.omitted_horizons.join(', ')}.
        </p>
      )}
      <details className="comparison-provenance">
        <summary>
          <Fingerprint size={13} />
          Dataset, timing protocol & checkpoint provenance
        </summary>
        <p>
          {report.dataset.id} · {report.runtime.platform} · Python {report.runtime.python} · PyTorch{' '}
          {report.runtime.torch} · CPU / {report.runtime.threads} threads
        </p>
        <p>
          Dataset SHA-256 <code>{report.dataset.content_sha256}</code>
        </p>
        <p>
          Sample schedule SHA-256 <code>{report.schedule_sha256[group]}</code>
        </p>
        {report.models.map((m) => (
          <p key={m.id}>
            {m.id} · selected epoch {m.selected_epoch} · training seed {m.training_seed} · history{' '}
            {m.architecture.history}
            <code>{m.checkpoint_sha256}</code>
          </p>
        ))}
        <p>
          Timing: 3 warm-ups, 10 calls, median and nearest-rank p95; batch 1,{' '}
          {report.models[0].latency.objects} objects at sample {report.models[0].latency.anchor}.
          Timing varies with machine load. Checkpoint comparisons do not establish architecture
          superiority or statistical significance.
        </p>
      </details>
    </>
  );
}
