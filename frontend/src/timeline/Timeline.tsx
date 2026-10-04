import { useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SkipBack } from 'lucide-react';
import { tickFromFraction, useLab } from '../state/lab';
import type { Command } from '../types';

export function Timeline({ command }: { command: (cmd: Command) => Promise<void> }) {
  const world = useLab((s) => s.world),
    busy = useLab((s) => s.busy),
    online = useLab((s) => s.connection === 'online');
  const [scrub, setScrub] = useState<number | null>(null);
  const duration = world?.duration || 0,
    tick = scrub ?? world?.tick ?? 0;
  const disabled = !online || !!busy;
  const commit = () => {
    if (scrub !== null) {
      void command({ kind: 'seek', tick: scrub });
      setScrub(null);
    }
  };
  return (
    <section className="timeline" aria-label="Recorded simulation timeline">
      <div className="timeline-heading">
        <div>
          <span className="eyebrow">OBSERVATION TIMELINE</span>
          <span className="timeline-source">
            <i />
            Recorded reality
          </span>
        </div>
        <span className="timeline-time">
          <strong>{(tick / 120).toFixed(3)}</strong>
          <small>s</small>
          <span className="dim">/ {(duration / 120).toFixed(3)} s</span>
        </span>
      </div>
      <div className="timeline-track">
        <div className="track-grid">
          {Array.from({ length: 61 }, (_, i) => (
            <i key={i} className={i % 10 === 0 ? 'major' : ''} />
          ))}
        </div>
        <div
          className="recording-band"
          style={{ width: `${duration ? Math.max(0, (tick / duration) * 100) : 0}%` }}
        />
        <div className="playhead" style={{ left: `${duration ? (tick / duration) * 100 : 0}%` }}>
          <span>t{tick.toString().padStart(4, '0')}</span>
        </div>
        <input
          aria-label="Timeline playhead"
          type="range"
          min={0}
          max={duration || 1}
          step={1}
          value={tick}
          disabled={disabled || !duration}
          onChange={(e) =>
            setScrub(tickFromFraction(Number(e.target.value) / (duration || 1), duration))
          }
          onPointerUp={commit}
          onPointerCancel={commit}
          onKeyUp={commit}
        />
      </div>
      <div className="timeline-labels">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i}>
            {(((duration / 120) * i) / 6).toFixed(1)}
            <small>s</small>
          </span>
        ))}
      </div>
      <div className="transport">
        <div className="transport-left">
          <button
            aria-label="Reset recording"
            title="Reset to original scene"
            disabled={disabled}
            onClick={() => void command({ kind: 'reset' })}
          >
            <RotateCcw size={15} />
          </button>
          <span className="transport-separator" />
          <span className="frame-count">
            FRAME <strong>{tick.toString().padStart(4, '0')}</strong>
          </span>
        </div>
        <div className="transport-main">
          <button
            aria-label="Go to beginning"
            title="Go to beginning"
            disabled={disabled || !duration}
            onClick={() => void command({ kind: 'seek', tick: 0 })}
          >
            <SkipBack size={16} />
          </button>
          <button
            aria-label="Previous frame"
            title="Previous frame"
            disabled={disabled || !tick}
            onClick={() => void command({ kind: 'seek', tick: tick - 1 })}
          >
            <ChevronLeft size={19} />
          </button>
          <button
            className="play-button"
            aria-label={world?.playing ? 'Pause simulation' : 'Play simulation'}
            title="Play / pause · Space"
            disabled={disabled}
            onClick={() => void command({ kind: world?.playing ? 'pause' : 'play' })}
          >
            {world?.playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </button>
          <button
            aria-label="Step simulation"
            title="Step one tick · ."
            disabled={disabled}
            onClick={() => void command({ kind: 'step' })}
          >
            <ChevronRight size={19} />
          </button>
        </div>
        <div className="transport-right">
          <span>SPEED</span>
          <select
            aria-label="Simulation speed"
            value={world?.speed || 1}
            disabled={disabled}
            onChange={(e) => void command({ kind: 'speed', speed: Number(e.target.value) })}
          >
            {[0.25, 0.5, 1, 2, 4].map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </div>
      </div>
      {!duration && (
        <p className="timeline-empty">Start the simulation to record your first observation.</p>
      )}
    </section>
  );
}
