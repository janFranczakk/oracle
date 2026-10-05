import { ChevronLeft, ChevronRight, Eye, GitCompareArrows, Sparkles } from 'lucide-react';
import { useLab } from '../state/lab';

export function ForecastTimeline() {
  const prediction = useLab((s) => s.prediction),
    step = useLab((s) => s.forecastStep);
  const ghosts = useLab((s) => s.ghosts),
    reference = useLab((s) => s.reference),
    errors = useLab((s) => s.errorVectors);
  if (!prediction) return null;
  const set = useLab.getState().set;
  const at = (next: number) =>
    set({ forecastStep: Math.max(0, Math.min(prediction.horizon, next)) });
  return (
    <section className="forecast-timeline" aria-label="Learned forecast timeline">
      <div className="forecast-timeline-heading">
        <span>
          <Sparkles size={12} /> FORECAST <small>independent preview</small>
        </span>
        <strong>
          +{(step * prediction.model.sample_dt).toFixed(3)} s <small>/ step {step}</small>
        </strong>
      </div>
      <div className="forecast-track-row">
        <button aria-label="Previous forecast step" disabled={!step} onClick={() => at(step - 1)}>
          <ChevronLeft size={15} />
        </button>
        <input
          aria-label="Forecast step"
          type="range"
          min={0}
          max={prediction.horizon}
          value={step}
          onChange={(e) => at(Number(e.target.value))}
        />
        <button
          aria-label="Next forecast step"
          disabled={step === prediction.horizon}
          onClick={() => at(step + 1)}
        >
          <ChevronRight size={15} />
        </button>
        <div className="forecast-layers">
          <button
            aria-label="Toggle learned ghosts"
            aria-pressed={ghosts}
            className={ghosts ? 'enabled' : ''}
            onClick={() => set({ ghosts: !ghosts })}
          >
            <Sparkles size={13} /> Ghosts
          </button>
          <button
            aria-label="Toggle Pymunk reference"
            aria-pressed={reference}
            className={reference ? 'enabled truth' : ''}
            onClick={() => set({ reference: !reference })}
          >
            <Eye size={13} /> Actual
          </button>
          <button
            aria-label="Toggle displacement connectors"
            aria-pressed={errors}
            className={errors ? 'enabled error' : ''}
            onClick={() => set({ errorVectors: !errors })}
          >
            <GitCompareArrows size={13} /> Error
          </button>
        </div>
      </div>
    </section>
  );
}
