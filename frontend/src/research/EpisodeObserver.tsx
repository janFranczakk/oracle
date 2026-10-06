import { useState } from 'react';
import { ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';
import type { EpisodePreview } from './dataset';

export function EpisodeObserver({ preview }: { preview: EpisodePreview }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(
    preview.frames[0].objects.find((b) => !b.static)?.id || '',
  );
  const frame = preview.frames[index];
  const body = frame.objects.find((b) => b.id === selected);
  return (
    <div className="episode-observer">
      <div className="episode-view">
        <div className="dataset-panel-heading">
          <span className="eyebrow">EPISODE OBSERVER</span>
          <span className="tag">RECORDED REALITY · READ ONLY</span>
        </div>
        <div className="episode-canvas">
          <svg viewBox="0 0 24 14" role="group" aria-label="Recorded episode world">
            <defs>
              <pattern id="episode-grid" width="1" height="1" patternUnits="userSpaceOnUse">
                <path d="M 1 0 L 0 0 0 1" fill="none" className="episode-grid-line" />
              </pattern>
            </defs>
            <rect width="24" height="14" fill="url(#episode-grid)" />
            {frame.objects.map((b) => (
              <g
                key={b.id}
                transform={`translate(${b.position.x}, ${14 - b.position.y}) rotate(${(-b.rotation * 180) / Math.PI})`}
                className={`${b.static ? 'episode-static' : 'episode-dynamic'} ${selected === b.id ? 'episode-selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${b.label}`}
                onClick={() => setSelected(b.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelected(b.id);
                  }
                }}
              >
                {b.shape === 'circle' ? (
                  <circle r={b.radius} vectorEffect="non-scaling-stroke" />
                ) : (
                  <rect
                    x={-b.width / 2}
                    y={-b.height / 2}
                    width={b.width}
                    height={b.height}
                    rx="0.03"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {!b.static && (
                  <line
                    x2={
                      (Math.cos(b.rotation) * b.velocity.x + Math.sin(b.rotation) * b.velocity.y) *
                      0.13
                    }
                    y2={
                      (Math.sin(b.rotation) * b.velocity.x - Math.cos(b.rotation) * b.velocity.y) *
                      0.13
                    }
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {frame.collisions.includes(b.id) && !b.static && (
                  <circle
                    r={(b.shape === 'circle' ? b.radius : Math.hypot(b.width, b.height) / 2) + 0.18}
                    className="episode-contact"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            ))}
          </svg>
          <span className="episode-world-label">24 × 14 m · PYMUNK GROUND TRUTH</span>
        </div>
        <div className="episode-timeline">
          <div>
            <span className="eyebrow">OBSERVED TIMELINE</span>
            <span>
              {(frame.tick / 120).toFixed(3)} <i>s</i> /{' '}
              {(preview.frames.at(-1)!.tick / 120).toFixed(1)} <i>s</i>
            </span>
          </div>
          <input
            aria-label="Episode playhead"
            type="range"
            min="0"
            max={preview.frames.length - 1}
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
          />
          <div>
            <span>
              t {String(frame.tick).padStart(4, '0')} · {preview.frames.length} DISPLAY SAMPLES
            </span>
            <span>
              <button
                aria-label="Previous observation"
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
              >
                <ArrowLeft size={14} />
              </button>
              <button
                aria-label="Next observation"
                disabled={index === preview.frames.length - 1}
                onClick={() => setIndex(index + 1)}
              >
                <ArrowRight size={14} />
              </button>
            </span>
          </div>
        </div>
      </div>
      <aside className="episode-inspector">
        <span className="eyebrow">OBSERVATION DETAILS</span>
        <h3>{body?.label || 'Select a specimen'}</h3>
        <span className="tag">
          {body?.shape.toUpperCase()} · {body?.static ? 'STATIC' : 'DYNAMIC'}
        </span>
        {body && (
          <dl>
            <dt>Mass</dt>
            <dd>
              {body.mass.toFixed(3)} <i>kg</i>
            </dd>
            <dt>Speed</dt>
            <dd>
              {Math.hypot(body.velocity.x, body.velocity.y).toFixed(3)} <i>m/s</i>
            </dd>
            <dt>Position</dt>
            <dd>
              {body.position.x.toFixed(2)} / {body.position.y.toFixed(2)} <i>m</i>
            </dd>
            <dt>Rotation</dt>
            <dd>
              {((body.rotation * 180) / Math.PI).toFixed(1)} <i>°</i>
            </dd>
            <dt>Friction</dt>
            <dd>{body.friction.toFixed(3)}</dd>
            <dt>Restitution</dt>
            <dd>{body.restitution.toFixed(3)}</dd>
            <dt>Contact onset</dt>
            <dd className={frame.collisions.includes(body.id) ? 'amber' : ''}>
              {frame.collisions.includes(body.id) ? 'In sampled interval' : 'None in interval'}
            </dd>
          </dl>
        )}
        <div className="episode-provenance">
          <ShieldCheck size={16} />
          <div>
            <strong>Payload verified</strong>
            <p>SHA-256 checked before preview.</p>
          </div>
        </div>
        <details className="episode-ranges">
          <summary className="eyebrow">INITIAL DISTRIBUTION</summary>
          <dl>
            <dt>Mass</dt>
            <dd>{preview.ranges.mass.join('–')} kg</dd>
            <dt>Speed</dt>
            <dd>{preview.ranges.speed.join('–')} m/s</dd>
            <dt>Orientation</dt>
            <dd>{preview.ranges.angle_degrees.join('–')} °</dd>
            <dt>Dynamic bodies</dt>
            <dd>{preview.ranges.object_count.join('–')}</dd>
          </dl>
          <p className="episode-caveat">
            Ranges describe initial conditions. Velocities and orientations evolve under the real
            solver.
          </p>
        </details>
      </aside>
    </div>
  );
}
