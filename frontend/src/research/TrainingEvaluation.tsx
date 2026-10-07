import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { groupName, measured, rolloutChart } from './training';
import type { RunDetail } from './training';
import { ticks, tooltipStyle } from './trainingCharts';

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

export function TrainingEvaluation({ current }: { current: RunDetail | null }) {
  const [groupKey, setGroupKey] = useState('test');
  const [horizon, setHorizon] = useState(10);
  const group = current?.evaluation?.groups[groupKey];
  const score = group?.one_step.learned,
    reference = group?.one_step.constant_velocity;
  const rollout =
    group?.rollout.learned.find((r) => r.horizon === horizon) || group?.rollout.learned[0];
  const rolloutReference = group?.rollout.constant_velocity.find(
    (r) => r.horizon === rollout?.horizon,
  );
  return (
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
            <section className="uncertainty-evaluation" aria-label="Held-out interval quality">
              <span className="eyebrow">MC DROPOUT / OBSERVED INTERVAL QUALITY</span>
              <p>
                {current.uncertainty.samples} paths per anchor · Seed {current.uncertainty.seed} ·
                5–95% marginal quantiles · Uncalibrated; no calibration fitted.
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
                        {(row.coverage_x * 100).toFixed(1)} / {(row.coverage_y * 100).toFixed(1)}%
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
                Nominal 90% is per coordinate. Narrow intervals can miss the actual future. Joint
                coverage is measured separately. This is model spread, not a safety score.
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
  );
}
