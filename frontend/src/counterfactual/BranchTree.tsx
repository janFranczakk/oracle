import { treeRows } from './branches';
import type { Plan, Results } from './types';

export function BranchTree({
  plan,
  selected,
  results,
  onSelect,
}: {
  plan: Plan | undefined;
  selected: string;
  results: Record<string, Results>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="branch-tree-list">
      {plan ? (
        treeRows(plan).map(({ branch: item, depth }) => (
          <button
            key={item.id}
            aria-label={`Select branch ${item.name}`}
            aria-pressed={selected === item.id}
            className={`branch-node ${selected === item.id ? 'selected' : ''}`}
            onClick={() => {
              onSelect(item.id);
            }}
            style={{ paddingLeft: 12 + Math.min(depth, 4) * 12 }}
          >
            <span className="branch-node-line" />
            <span>
              <strong>{item.name}</strong>
              <small>
                {item.parent_id
                  ? `${item.changes.length} intervention${item.changes.length > 1 ? 's' : ''}`
                  : 'Observed anchor'}
              </small>
              <i>
                {results[item.id]?.prediction ? 'PREDICTED' : '—'}
                {results[item.id]?.reality ? ' / EXECUTED' : ''}
              </i>
            </span>
          </button>
        ))
      ) : (
        <p className="branch-help">Capture a paused source to create immutable alternatives.</p>
      )}
    </div>
  );
}
