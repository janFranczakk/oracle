import type { Attention, Distribution, IntervalScore, SamplingSettings } from './diagnostics';
import './diagnostics.css';

export function SamplingControls({
  enabled,
  settings,
  onChange,
  disabled = false,
}: {
  enabled: boolean;
  settings: SamplingSettings;
  onChange: (value: SamplingSettings) => void;
  disabled?: boolean;
}) {
  return (
    <div className="sampling-controls">
      <label>
        STOCHASTIC PATHS
        <select
          aria-label="Dropout paths"
          disabled={disabled || !enabled}
          value={enabled ? settings.samples : 0}
          onChange={(e) => onChange({ ...settings, samples: Number(e.target.value) })}
        >
          <option value={0}>Point forecast only</option>
          {[8, 16, 32].map((n) => (
            <option key={n} value={n}>
              {n} dropout paths
            </option>
          ))}
        </select>
      </label>
      {enabled && settings.samples > 0 && (
        <label>
          SEED
          <input
            aria-label="Sampling seed"
            inputMode="numeric"
            value={settings.seed}
            disabled={disabled}
            onChange={(e) => onChange({ ...settings, seed: e.target.value })}
          />
        </label>
      )}
      <p>
        {enabled
          ? 'Empirical 5–95% position intervals. Calibration is not guaranteed.'
          : 'Dropout intervals require a Transformer trained with dropout.'}
      </p>
    </div>
  );
}

export function IntervalMeasurement({ score }: { score: IntervalScore }) {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  return (
    <div className="interval-measurement">
      <span>
        Observed x / y coverage
        <strong>
          {percent(score.coverage_x)} / {percent(score.coverage_y)}
        </strong>
      </span>
      <span>
        Both coordinates covered<strong>{percent(score.coverage_xy)}</strong>
      </span>
      <span>
        Mean x / y width
        <strong>
          {score.width_x_m.toFixed(3)} / {score.width_y_m.toFixed(3)} m
        </strong>
      </span>
      <span>
        Spread / error correlation
        <strong>{score.spread_error_correlation?.toFixed(3) ?? 'Undefined'}</strong>
      </span>
      <p>
        Full forecast · {score.objects_scored} dynamic object observations. Nominal coverage is 90%
        per coordinate; simultaneous coverage has no 90% guarantee.
      </p>
    </div>
  );
}

export function ModelDiagnostics({
  uncertainty,
  attention,
  step,
  selected,
  measurement,
}: {
  uncertainty: Distribution | null;
  attention?: Attention | null;
  step: number;
  selected: string | null;
  measurement?: IntervalScore | null;
}) {
  const interval =
    step > 0 ? uncertainty?.steps[step - 1]?.objects.find((o) => o.id === selected) : null;
  if (!uncertainty && !attention) return null;
  return (
    <div className="model-diagnostics">
      {uncertainty && (
        <section className="distribution-panel" aria-label="Forecast uncertainty">
          <header>
            <span className="eyebrow">DISTRIBUTION / MC DROPOUT</span>
            <span>UNCALIBRATED</span>
          </header>
          <p>
            {uncertainty.samples} autoregressive paths · Seed {uncertainty.seed} · Dropout{' '}
            {uncertainty.dropout}
          </p>
          <p>
            Shaded rectangles show 5–95% marginal x/y quantiles. Solid paths show the dropout-off
            forecast; the stochastic mean may differ.
          </p>
          {interval ? (
            <div className="interval-selected">
              <span>
                {selected} · +{step} steps
              </span>
              <strong>
                σx {interval.std[0].toFixed(3)} / σy {interval.std[1].toFixed(3)} m
              </strong>
            </div>
          ) : (
            <p>Select a body and a future step to inspect its spread.</p>
          )}
          {(measurement || uncertainty.measurement) && (
            <IntervalMeasurement score={(measurement || uncertainty.measurement)!} />
          )}
          {!measurement && !uncertainty.measurement && (
            <p>Run the matching physical future to measure coverage.</p>
          )}
        </section>
      )}
      {attention && (
        <details className="attention-panel">
          <summary>Object attention · observed t{attention.tick}</summary>
          <p>Rows query columns; heads are averaged. These weights are not causal explanations.</p>
          <div className="attention-scroll">
            <table aria-label="Anchor object attention weights">
              <thead>
                <tr>
                  <th>QUERY ↓ / KEY →</th>
                  {attention.object_ids.map((id) => (
                    <th key={id} title={id}>
                      {id.slice(0, 8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attention.object_ids.map((id, i) => (
                  <tr key={id} className={selected === id ? 'selected' : ''}>
                    <th title={id}>{id.slice(0, 12)}</th>
                    {attention.weights[i].map((weight, j) => (
                      <td
                        key={attention.object_ids[j]}
                        title={`${id} → ${attention.object_ids[j]}: ${weight.toFixed(6)}`}
                        style={{
                          backgroundColor: `rgba(154, 130, 228, ${Math.min(0.8, weight * 2.5)})`,
                        }}
                      >
                        {(weight * 100).toFixed(0)}%
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
