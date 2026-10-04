# Stage 1 requirements

Stage 1 delivers ground-truth observation and editing. A physics rollout is **not** an AI prediction.

| Requirement | Implementation / evidence |
| --- | --- |
| Python backend, React + strict TypeScript frontend | `backend/oracle/api.py`, `frontend/src/App.tsx` |
| Established 2D engine; no browser physics | Pymunk 7.2 / Chipmunk; PixiJS renders streamed transforms |
| Circles, rectangles, ramps, walls, platforms | Validated object schema, curated scenes, Add object menu |
| Fixed step, reproducible seeds | 120 Hz, local seeded RNG, single-threaded solver; determinism tests |
| Play, pause, step, rewind, speed | HTTP commands, 20 Hz WebSocket stream, discrete seek |
| Pan, zoom, reset, focus, follow | Smooth camera; tested coordinate conversions |
| Select, drag, inspect, edit, duplicate, remove | Pixi picking, scene preview, paused edits |
| Save / restore | Browser snapshots and versioned JSON; original scene + edit journal replay |
| Refined visual design | Central tokens; Manrope / IBM Plex Mono; bounded palette |
| Desktop layout | Visual checks at 1440×900 and 1920×1080; no horizontal overflow |
| Empty, loading and error states | Selection, model, snapshot library, backend disconnect, bad imports |
| Headless entry point | `python -m oracle.experiment` |
| Architecture for later stages | Separate `DynamicsModel` / `Prediction` contracts and documented module roadmap |
| Quality checks | pytest, Ruff, Vitest, ESLint, strict TypeScript, production build |

ML, dataset generation, prediction ghosts, comparison views, confidence scores and training charts belong to later stages. They are never simulated in the Stage 1 interface.
