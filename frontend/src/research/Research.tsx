import {
  ArrowUpRight,
  Boxes,
  BrainCircuit,
  Check,
  FlaskConical,
  GitBranch,
  Orbit,
  ScanLine,
  Waypoints,
} from 'lucide-react';
import { useState } from 'react';
import { DatasetExplorer } from './DatasetExplorer';
import { TrainingDashboard } from './TrainingDashboard';
import './datasets.css';
const stages = [
  ['01', 'Physics foundation', 'Deterministic simulation, state editing and replay.', Orbit],
  ['02', 'Dataset engine', 'Seeded episodes, normalization and OOD splits.', Boxes],
  ['03', 'Learned world model', 'Object embeddings, MLP and GRU baselines.', BrainCircuit],
  ['04', 'Prediction lab', 'Model rollouts, ghost futures and error measurement.', ScanLine],
  ['05', 'Counterfactual lab', 'Interventions, branches and comparative futures.', GitBranch],
  ['06', 'Advanced models', 'Attention, temporal transformers and uncertainty.', Waypoints],
  ['07', 'Research platform', 'Model comparison, batch experiments and reports.', FlaskConical],
  ['08', 'Planning', 'Candidate actions evaluated through learned rollouts.', ArrowUpRight],
] as const;
export function Research() {
  const [view, setView] = useState('training');
  return (
    <div className="research-page">
      <nav className="research-subnav" aria-label="Research sections">
        <button
          className={view === 'training' ? 'selected' : ''}
          onClick={() => setView('training')}
        >
          <BrainCircuit size={14} />
          World model<span className="tag">LIVE</span>
        </button>
        <button
          className={view === 'datasets' ? 'selected' : ''}
          onClick={() => setView('datasets')}
        >
          <Boxes size={14} />
          Dataset engine<span className="tag">LIVE</span>
        </button>
        <button className={view === 'roadmap' ? 'selected' : ''} onClick={() => setView('roadmap')}>
          <Waypoints size={14} />
          Research roadmap
        </button>
      </nav>
      {view === 'training' ? (
        <TrainingDashboard />
      ) : view === 'datasets' ? (
        <DatasetExplorer />
      ) : (
        <>
          <div className="research-intro">
            <span className="eyebrow cyan">RESEARCH / ROADMAP</span>
            <h1>
              Observation comes first.
              <br />
              <span>Understanding is earned.</span>
            </h1>
            <p>
              A controlled environment for testing learned dynamics. Physics and dataset foundations
              are ready; MLP and GRU training now measure learned dynamics on held-out episodes.
            </p>
            <div className="research-integrity">
              <span className="live-dot" />
              GROUND TRUTH AVAILABLE<span>·</span>LEARNED DYNAMICS AVAILABLE
            </div>
          </div>
          <div className="roadmap-grid">
            {stages.map(([number, title, desc, Icon], i) => (
              <div className={`roadmap-card ${i < 3 ? 'ready' : ''}`} key={number}>
                <div>
                  <Icon size={20} />
                  <span>{number}</span>
                </div>
                <h3>{title}</h3>
                <p>{desc}</p>
                <span className="roadmap-status">
                  {i < 3 ? (
                    <>
                      <Check size={12} />
                      IMPLEMENTED
                    </>
                  ) : i === 3 ? (
                    'NEXT STAGE'
                  ) : (
                    'PLANNED'
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="research-bottom">
            <span className="eyebrow">RESEARCH INTEGRITY</span>
            <p>
              Physics-engine observations and learned-model predictions have separate pipelines. No
              synthetic scores, fabricated confidence or physics-powered “AI” predictions.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
