# Stage 3 — Learned world model

Implement real object-centric PyTorch MLP and GRU models, reproducible local training, validation-selected checkpoints, one-step metrics and autoregressive rollout evaluation. Preserve the simulator, dataset schemas and Lab interaction.

- Verified episode sequences stay within one split and episode; masks handle variable object counts. Static geometry is context, never a training target.
- Each object has a shared encoder. Masked scene pooling supplies context; temporal MLP / GRU modules share weights across objects. Learned outputs predict motion changes and contact onsets without invoking physics.
- Store configuration, weights, optimizer, epoch, dataset identity, feature schema, exact train normalizer, sample clock and runtime in checkpoints. Reject incompatible or corrupt inputs. Support exact deterministic CPU resume within the verified runtime.
- Select the best model only from validation. Report position / velocity MSE, periodic rotation error, contact classification, ADE / FDE and errors by horizon and held-out split / OOD suite. Compare a clearly named constant-velocity baseline on the same samples.
- Expose actual training progress, logged losses, checkpoint metadata and evaluation in Research. Training runs outside the API event loop. No fabricated confidence, ghost trajectories or Lab predictions; these belong to later stages.
- Validate meaningful model / data / training / rollout / checkpoint tests, existing regressions, lint, strict TypeScript, build and hosted CI. Verify the UI at both desktop sizes and document actual training evidence and limitations in STAGE_3_REPORT.md.
