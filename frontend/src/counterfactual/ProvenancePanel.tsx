import { Fingerprint } from 'lucide-react';
import type { Future } from './types';

export function ProvenancePanel({ prediction }: { prediction: Future | undefined }) {
  if (!prediction) return null;
  return (
    <details className="branch-provenance">
      <summary>
        <Fingerprint size={12} /> Verified checkpoint & conditioning
      </summary>
      <p>{prediction.model_version}</p>
      <code>{prediction.model?.sha256}</code>
      <span>Dataset {prediction.model?.dataset_id}</span>
      <code>{prediction.model?.normalization_sha256}</code>
      <p>
        Terminal state override · original observations retained. Removed identities are projected
        out of model inputs.
      </p>
      {!!prediction.conditioning?.added_ids.length && (
        <p className="amber">
          New bodies use synthetic repeated anchor placeholders in the model window:{' '}
          {prediction.conditioning.added_ids.join(', ')}. These are conditioning inputs, not
          observations.
        </p>
      )}
    </details>
  );
}
