import { histogram, splits } from './dataset';
import type { EpisodeEntry } from './dataset';

export function Distribution({
  entries,
  field,
  max,
  title,
  unit,
}: {
  entries: EpisodeEntry[];
  field: 'initial_masses' | 'initial_speeds';
  max: number;
  title: string;
  unit: string;
}) {
  const bins = splits.map((split) =>
    histogram(
      entries.filter((e) => e.split === split).flatMap((e) => e[field]),
      16,
      0,
      max,
    ),
  );
  const peak = Math.max(1, ...bins.flat());
  return (
    <div className="dataset-distribution">
      <div>
        <span className="eyebrow">{title}</span>
        <span>INITIAL CONDITIONS · {unit}</span>
      </div>
      <svg viewBox="0 0 480 88" role="img" aria-label={`${title} distribution by dataset split`}>
        {[0, 1, 2].map((line) => (
          <line
            key={line}
            x1="0"
            x2="480"
            y1={line * 28 + 4}
            y2={line * 28 + 4}
            className="hist-grid"
          />
        ))}
        {bins.map((counts, group) =>
          counts.map((count, index) => (
            <rect
              key={`${group}-${index}`}
              className={`split-${splits[group]}`}
              x={index * 30 + group * 6 + 2}
              y={72 - (count / peak) * 62}
              width="5"
              height={(count / peak) * 62}
              rx="1"
            >
              <title>
                {splits[group]}: {count} bodies in {((index * max) / 16).toFixed(1)}–
                {(((index + 1) * max) / 16).toFixed(1)} {unit}
              </title>
            </rect>
          )),
        )}
        <text x="0" y="87">
          0
        </text>
        <text x="236" y="87">
          {max / 2}
        </text>
        <text x="470" y="87">
          {max}
        </text>
      </svg>
    </div>
  );
}
