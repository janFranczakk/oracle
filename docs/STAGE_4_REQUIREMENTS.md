# Stage 4 — Prediction Lab

- Select a completed, compatible local MLP / GRU checkpoint. Verify its weights and provenance before inference; preserve the optional ML dependency boundary.
- Predict from real, equally spaced observations in the paused Lab. Reject insufficient history, histories crossing edits, clock / gravity mismatches and stale anchors. Offer an explicit ground-truth recording step to obtain the required observations.
- Run bounded inference outside the API process. Keep learned frames separate from an independently replayed Pymunk reference. Hold conditions at the anchor; ignore journal edits after it. Neither rollout changes the live world, recording or playhead.
- Render violet ghost bodies with increasing transparency over the horizon, learned trajectory lines, a separately identified cyan reference and displacement connectors. Keep camera, selection, observed trails and physics transport working.
- Scrub the forecast on its own clock. Compare object positions, velocity, periodic rotation, contact onsets, ADE / FDE and error versus horizon using measured outputs. Identify the model, checkpoint hash, dataset, anchor and clocks in an exportable report.
- Clear stale predictions on session replacement, edits, seek or advancing the world. Provide useful preparation, loading, empty and failure states. Uncertainty stays explicitly unestimated; Stage 5 interventions / branches and Stage 6 uncertainty remain out of scope.
- Add meaningful backend and frontend regression coverage; pass repository CI checks; verify the complete browser flow at 1440×900 and 1920×1080; record results and limitations in `STAGE_4_REPORT.md`.
