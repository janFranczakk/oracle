import {
  ArrowRight,
  BookOpen,
  Download,
  Layers,
  Orbit,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Experiment, Scene } from '../types';
import { useDialogFocus } from './useDialogFocus';

export type Snapshot = { id: string; name: string; data: Experiment };
type Props = {
  modal: 'scene' | 'snapshots' | 'about' | null;
  busy: boolean;
  disabled: boolean;
  preset: Scene;
  setPreset: (value: Scene) => void;
  seed: string;
  setSeed: (value: string) => void;
  sceneTitles: Record<Scene, string>;
  snapshots: Snapshot[];
  onClose: () => void;
  onLoadScene: () => Promise<void>;
  onRestore: (data: Experiment) => Promise<void>;
  onExport: (snapshot: Snapshot) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
};
export function ExperimentDialog({
  modal,
  busy,
  disabled,
  preset,
  setPreset,
  seed,
  setSeed,
  sceneTitles,
  snapshots,
  onClose,
  onLoadScene,
  onRestore,
  onExport,
  onDelete,
  onImport,
}: Props) {
  useDialogFocus(modal, onClose);
  if (!modal) return null;
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={
          modal === 'scene'
            ? 'Scene library'
            : modal === 'snapshots'
              ? 'Snapshot library'
              : 'About ORACLE'
        }
      >
        <div className="modal-heading">
          <span className="eyebrow cyan">
            {modal === 'scene'
              ? 'NEW EXPERIMENT'
              : modal === 'snapshots'
                ? 'SAVED OBSERVATIONS'
                : 'ORACLE / 01'}
          </span>
          <button aria-label="Close dialog" disabled={!!busy} onClick={() => onClose()}>
            <X size={18} />
          </button>
        </div>
        {modal === 'scene' ? (
          <>
            <h2>Choose your initial conditions.</h2>
            <p>
              Each scene is reproducible from its seed. Creating a world replaces the current
              recording; save a snapshot to keep it.
            </p>
            <div className="scene-options">
              {(['incline', 'collision', 'empty'] as Scene[]).map((value, i) => (
                <button
                  className={preset === value ? 'selected' : ''}
                  key={value}
                  onClick={() => setPreset(value)}
                >
                  <div className={`scene-thumb thumb-${value}`}>
                    {value === 'incline' ? (
                      <>
                        <i />
                        <b />
                        <em />
                      </>
                    ) : value === 'collision' ? (
                      <>
                        <i />
                        <b />
                        <em />
                      </>
                    ) : (
                      <Plus size={25} />
                    )}
                  </div>
                  <strong>{sceneTitles[value]}</strong>
                  <span>
                    {
                      [
                        'Ramps, free fall & contact',
                        'Six bodies, one environment',
                        'A ground plane & boundaries',
                      ][i]
                    }
                  </span>
                </button>
              ))}
            </div>
            <label className="seed-field">
              <span>EXPERIMENT SEED</span>
              <input
                aria-label="Experiment seed"
                inputMode="numeric"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
              <span>Same seed. Same initial conditions.</span>
            </label>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => onClose()}>
                Cancel
              </button>
              <button
                className="button primary"
                disabled={disabled}
                onClick={() => void onLoadScene()}
              >
                Create world
                <ArrowRight size={15} />
              </button>
            </div>
          </>
        ) : modal === 'snapshots' ? (
          <>
            <h2>Your observed worlds.</h2>
            <p>
              Up to eight snapshots are stored in this browser. Export an experiment for a portable,
              reproducible copy.
            </p>
            <div className="snapshot-list">
              {snapshots.length ? (
                snapshots.map((s) => (
                  <article className="snapshot" key={s.id}>
                    <div className="snapshot-icon">
                      <Layers size={22} />
                    </div>
                    <div>
                      <strong>{s.name}</strong>
                      <span>
                        SEED {s.data.origin.seed} · {(s.data.playhead / 120).toFixed(3)} s ·{' '}
                        {new Date(s.data.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      className="restore-button"
                      disabled={disabled}
                      onClick={() => void onRestore(s.data)}
                    >
                      Restore
                    </button>
                    <button
                      aria-label={`Export ${s.name}`}
                      title="Export JSON"
                      onClick={() => onExport(s)}
                    >
                      <Download size={15} />
                    </button>
                    <button
                      aria-label={`Delete ${s.name}`}
                      title="Delete local snapshot"
                      onClick={() => {
                        onDelete(s.id);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))
              ) : (
                <div className="snapshot-empty">
                  <Layers size={35} />
                  <h3>No observations saved yet.</h3>
                  <p>Pause at an interesting moment and select Save state.</p>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="button secondary" disabled={disabled} onClick={() => onImport()}>
                <Upload size={15} />
                Import experiment
              </button>
              <button className="button primary" onClick={() => onClose()}>
                Back to lab
                <ArrowRight size={15} />
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>What actually happens.</h2>
            <p>
              ORACLE is an interactive laboratory for learned world models and counterfactual
              reasoning. Stages 1–3 provide a controlled physics world, reproducible datasets and
              real MLP / GRU training. Research measures learned rollouts against held-out
              observations.
            </p>
            <div className="about-principle">
              <Orbit size={24} />
              <div>
                <strong>Ground truth · Pymunk</strong>
                <p>
                  Every motion and collision is computed in Python. The browser renders
                  observations.
                </p>
              </div>
            </div>
            <div className="about-principle">
              <BookOpen size={24} />
              <div>
                <strong>Learned dynamics · Research</strong>
                <p>
                  Train object-centric models and inspect their measured errors in Research. Predict
                  from real observations in the Lab, inspect violet ghosts and compare them with a
                  separate Pymunk replay.
                </p>
              </div>
            </div>
            <div className="shortcuts">
              <span>
                <kbd>Space</kbd>Play / pause
              </span>
              <span>
                <kbd>.</kbd>One tick
              </span>
              <span>
                <kbd>R</kbd>Reset camera
              </span>
              <span>
                <kbd>Del</kbd>Remove selected
              </span>
              <span>
                <kbd>Scroll</kbd>Zoom
              </span>
              <span>
                <kbd>Drag</kbd>Move object / pan
              </span>
            </div>
            <p className="about-meta">
              SI units · positive Y up · 120 Hz fixed-step physics · 20 Hz observation stream
            </p>
          </>
        )}
      </section>
    </div>
  );
}
