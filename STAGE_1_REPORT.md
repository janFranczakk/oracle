# ORACLE — Stage 1 report

Verified **4 October 2026**, Europe/Warsaw. Stage 1 implements the ground-truth physics foundation and visual laboratory. This report makes no learned-model performance claims.

## Implemented

- Python / FastAPI backend with per-session worlds and WebSocket observation streaming.
- React / strict TypeScript / PixiJS / Zustand frontend with a complete instrumented visual identity.
- Seeded scene library: inclined plane, collision chamber and blank canvas.
- Circles, dynamic boxes, static ramps, walls and platforms; creation, selection, paused dragging, editing, duplication and removal.
- Play, pause, single solver tick, speed selection and timeline scrubbing to any recorded tick.
- Smooth pan / zoom / reset / focus / follow camera, observed velocity vectors, recorded trails and contact pulses.
- Browser snapshots, JSON export / import, validated portable experiments and replay-based restoration.
- Shared headless experiment runner, benchmark, Windows start / stop helper, pinned dependencies and Git ignore rules.
- Model / intervention / prediction interfaces and an explicit Stage 2–8 roadmap. No full ML implementation or fabricated prediction UI.

## Architecture

`world.py` provides SI-unit schemas; `scenes.py` owns seeded initial conditions; `physics.py` is the Pymunk adapter; `session.py` owns recording, replay and edits; `api.py` owns transport. Frontend rendering, coordinate geometry, observation state, inspector, timeline and research screen have separate modules.

The browser receives observations and interpolates transforms. It does not compute collisions or integrate a second physical world. Predictions have a separate future contract and must identify their learned model and uncertainty method.

Experiments save original object definitions, environment parameters, seed, engine / schema versions, null model version, timestamp, ordered edits and timeline position. Solver state is reconstructed by replay, including contact history. Editing the past truncates the later recording.

## Physics

Pymunk 7.2 / Chipmunk, one solver thread, 20 iterations, fixed `1/120 s` integration step. Playback speed changes how many fixed ticks run per wall-clock interval. Coordinates use metres, velocities metres/second, mass kilograms and backend angles radians. UI angular position is displayed in degrees.

Determinism is verified for identical scene definitions, engine version and platform, including collisions and edits. Replay of a snapshot after contact produces the same states and continuing rollout. No bitwise portability claim is made across engine versions or platforms.

## Frontend

The world dominates the desktop workspace width. Its toolbar and telemetry frame the simulation; a fixed inspector and discrete timeline keep editing and playback readable. Shape rendering, camera motion, selection outlines, intervention previews and collision pulses communicate state. Curves are tessellated at pixel-sized geometry scale and transformed back to metres to avoid visibly polygonal circles when zoomed.

Static shape geometry is cached. Dynamic transforms are interpolated between observations. Grid, vectors and recorded trails can be switched independently. Resetting the camera exits follow mode so it can return to the full scene.

Snapshots are stored in the browser with an eight-item cap. Bad imports produce readable errors; a failed backend import leaves the world unchanged. Selection, no-model and no-snapshot empty states are deliberate parts of the layout. Restore / scene preparation / save show operation status.

## Visual design

Central palette, spacing, radii, shadows, fonts and motion durations are defined in `styles.css`. Graphite / navy surfaces, cold cyan controls and muted violet model status form the visual language. Manrope and IBM Plex Mono are served as local font assets.

Visual checks:

| Viewport | Horizontal document overflow | World / inspector overlap | Result |
| --- | --- | --- | --- |
| 1440×900 | None: scroll width 1440 | None | Passed |
| 1920×1080 | None: scroll width 1920 | None | Passed |

At 1440×900, the world panel is 984 px wide and the inspector 302 px wide. The inspector scrolls internally instead of covering the world. The same hierarchy expands at 1920×1080. A stacked layout is provided for smaller screens; mobile interaction coverage is limited to the responsive implementation and was not exhaustively tested.

Evidence: [1440 Main Lab](docs/screenshots/main-lab-1440.jpg), [1920 Main Lab](docs/screenshots/main-lab-1920.jpg), [Research roadmap](docs/screenshots/research-1920.jpg).

## Testing

### Tests

| Check | Result |
| --- | --- |
| Backend pytest | **36 passed** |
| Frontend Vitest | **13 passed** |
| Ruff lint | Passed |
| Ruff formatting check | Passed |
| ESLint | Passed |
| Strict TypeScript compilation | Passed |
| Vite production build | Passed, no oversized-chunk warning after React split |
| Headless experiment command | Passed; 240 ticks exported |
| Backend health / frontend HTTP | Passed on ports 8011 / 5181 |
| Production preview | Loaded, connected via WebSocket, advanced and reset physics |
| Windows launcher | Start, stop, port release and restart verified |

Backend coverage includes seeded scenes, collision determinism, actual gravity / ground contact, serialization, seek / resume, same-tick edits, truncating future edits, isolated clones, adding / removing bodies, invalid edits, unsupported schemas / engine versions, failed imports, object limits, recording limits, large evolving coordinates / rotation and transform payloads.

Frontend coverage includes coordinate round trips at both required resolutions, y-axis conversion, rotated picking geometry, timeline bounds, transform merging, selection removal, trail invalidation, preview clearing, camera reset exiting follow and the distinction between the research page and observed world state.

One dependency deprecation warning remains: the installed Starlette TestClient warns about httpx. It does not fail the tests. Dataset, model tensor, training, metrics and checkpoint tests are future-stage work because their implementations are intentionally absent.

Git is initialized on `main` with ignore rules for environments, datasets, checkpoints and build outputs. Commits were not created because this machine has no configured `user.name` / `user.email`; the source remains ready for review and commit after author configuration.

### Manual verification

Using the actual in-app browser, not a static mockup:

- Started physics, observed changing positions / velocity / energy, paused and stepped one tick.
- Set playback speed to 2× and loaded collision scene seed 77.
- Rewound an observed recording to tick 240; edited position to `(7.5, 8)` with a scene preview and applied it.
- Saved the edited state; reset the world; restored tick 240 through the snapshot library.
- Added and inspected a static ramp; duplicated a sphere and removed its copy.
- Dragged a sphere in the production build; observed its position change to approximately `(7.91, 10.41)`.
- Checked focus / follow, reset exiting follow, button zoom (100% → 115%), wheel zoom (115% → 151%) and empty-space pan.
- Verified refined Main Lab and Research layouts at both target sizes, internal inspector scrolling and no panel overlap.
- Checked production browser logs: no error / warning entries during the production smoke run.
- Verified the disconnected-engine UI during backend restarts and healthy reconnection on reload.

**Automation boundary:** the export button was invoked, but the in-app browser's download-event wait timed out. A native browser download was not confirmed by that automation. JSON content and import / replay are validated through the API and headless runner; browser snapshot save / restore was confirmed visually. File chooser upload was not exercised end to end by browser automation.

## Performance

Measured on this Windows 11 / Python 3.12.14 environment, seed 42, 10 objects, 2400 recorded ticks:

| Measurement | Observed value |
| --- | --- |
| Simulation including history | 0.2654 s |
| Mean solver tick including history | 0.1106 ms |
| Replay seek to tick 2000 | 154.82 ms |
| Full JSON payload at sampled state | 3452 bytes |
| Dynamic transform JSON payload | 950 bytes |
| Physics / observation stream | 120 Hz / 20 Hz |

These are a single local benchmark, not latency or scaling guarantees. Run `scripts/benchmark.py` to remeasure. Renderer FPS is independent of the solver. Browser history samples are bounded; full server recordings have finite duration. Import replay runs outside the API event loop; long seeks still replay synchronously and may briefly delay other local sessions.

The final main JS chunk is approximately 340 kB before gzip (107 kB gzip); the React chunk is about 222 kB (69 kB gzip). Optional rendering backends remain split. No external font request is required.

## Known limitations

- Local, single-process deployment; no persistent server database, accounts or remote collaboration.
- Up to 64 objects, 512 edits, 14,400 ticks and 16 retained sessions; idle disconnected sessions expire after 30 minutes. Recordings retain full per-tick object state, so memory grows with object count and duration.
- Snapshot portability depends on supported schema / Pymunk versions. Cross-platform bitwise equality is not certified.
- Thin surfaces and extreme velocities can tunnel; overlapping initial scenes can create strong impulses. This is not a continuous-collision or high-speed numerical benchmark suite.
- Browser snapshots can be removed by storage reset. Export important experiments; native browser download / file chooser QA remains a follow-up noted above.
- No learned predictions, probabilistic futures, model confidence, branch trees, split / difference views, training dashboard or latent-space analysis in Stage 1.
- Generalization, collision prediction accuracy, ADE / FDE and planning require real training and evaluation in later stages.

## Roadmap

2. Dataset engine: randomized scenes, reproducible episodes, episode-level splits, train-only normalization, explicit OOD suites and a data explorer.
3. Object-centric world model: PyTorch object encoder, MLP / GRU baselines, training and validation, checkpoint metadata and autoregressive rollout.
4. Prediction lab: learned future trajectories, error versus horizon and predicted / actual comparisons.
5. Counterfactual lab: immutable source snapshots, interventions, branches, multiple futures and reality execution.
6. Advanced models: temporal Transformer, relational attention and calibrated uncertainty estimates.
7. Research platform: fair model comparison, OOD experiments, batch runs and reports.
8. Planning: candidate interventions evaluated through learned rollouts and checked in ground truth.

## Next Stage

Implement Stage 2 on the shared headless physics path. Start with dataset schemas and reproducibility / split-isolation tests, then scene sampling and episode generation. Keep train, validation, test and OOD episode seeds disjoint, fit normalization on train only, record the exact engine / environment configuration and inspect generated scenes before training any model.
