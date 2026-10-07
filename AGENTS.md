# ORACLE contributor instructions

## Before changing code

- Treat the GitHub repository and its reviewed commits as the shared source of truth.
- Inspect the current branch, remotes, status, relevant history, README, architecture documentation, tests and `.github/workflows` before starting a task.
- Fetch remote changes before repository work when network access is available. Preserve local work; never discard changes or force-push to resolve a divergence.
- Use a descriptive `feature/`, `fix/`, `refactor/`, `ui/` or `chore/` branch for substantial changes. Keep `main` as the reviewed integration branch. Initial import is a one-time repository bootstrap.
- Understand the current implementation before extending it. Change only files needed by the task; record unrelated bugs or architectural debt as separate follow-up work.

## Architecture and research integrity

- Python owns physics, datasets, training, predictions and experiment state. React owns interaction and visualization.
- Pymunk is the sole ground-truth physics engine. Keep fixed solver steps separate from observation sampling, rendering, inference and training clocks.
- Frontend interpolation and replay may use observed transforms; never implement independent browser physics.
- Learned predictions must come from trained model weights and identify their source. Never present simulator output as AI prediction or fabricate training metrics, confidence or interpretation.
- Preserve object identities, SI units, versioned schemas, deterministic seeds and replay semantics. Determinism claims are limited to the verified runtime and platform.
- Fit normalization on training episodes only. Keep validation, test and OOD separate; retain dataset and normalizer provenance in future checkpoints.
- Keep collection and future training outside the API event loop. Preserve existing bounds, atomic publication and Windows sharing-violation handling.
- Use `docs/ARCHITECTURE.md`, `docs/DATASETS.md` and the stage reports when evaluating compatibility. Document material schema or interface changes.

## Code quality

- Follow existing Python type hints, Pydantic models, enums, small modules and strict TypeScript conventions. Add interfaces or dependencies only when the implementation needs them.
- Add meaningful tests for new core behavior and regression fixes. Avoid tests that merely repeat implementation details.
- Keep generated datasets, checkpoints, environments, build output and credentials out of Git. Update lockfiles when dependencies change.
- Do not remove working features to simplify new work without an explicit, documented justification.

## UI and UX

- Extend the existing design tokens, typography and instrumentation style. Preserve hierarchy, spacing, camera behavior, motion and readable states.
- For frontend changes, verify the affected flow in a browser and check 1440×900 and 1920×1080 where desktop layout is affected. Check panel overlap and horizontal overflow.
- Use actual observations and logged metrics. Provide useful empty, loading and failure states; do not expose stack traces in the product.
- Save relevant screenshots as review evidence. Exhaustive mobile or performance claims require actual verification.

## Validation and Definition of Done

From the repository root, with the backend and locked CPU ML dependencies installed in the active Python environment (see README):

```text
python -m pytest backend/tests
python -m ruff check backend scripts/benchmark.py
python -m ruff format --check backend scripts/benchmark.py
```

From `frontend/`:

```text
pnpm install --frozen-lockfile
pnpm test
pnpm run lint
pnpm exec prettier --check src
pnpm exec tsc --project tsconfig.e2e.json
pnpm run build
pnpm run test:e2e
```

The build includes strict TypeScript checking. Install Playwright Chromium and prepare the protected `.run/e2e` real smoke fixture before E2E; see `docs/DEMO_AND_E2E.md`. Include `pip check` in backend gates. Windows virtual-environment commands are in README. Run checks appropriate to each substantial change and the complete relevant CI gate before delivery. Report failures and fix their causes; do not weaken checks to conceal failures.

Full intervention/repeated-seed studies are bounded local CLI research, not API/CI workloads. Preserve protected outputs, exact hashes, validation-only selection, explicit skips/missing values and negative results. Seed mean confidence intervals differ from uncalibrated MC-dropout quantiles. The final release pass closes Stages 1–8 with `RELEASE_1_0_REPORT.md`; do not invent another stage for release validation.

A task is done when its scope is implemented, relevant automated and manual checks pass, compatibility and limitations are documented, and the final diff contains no accidental changes, secrets or generated files. Every completed stage needs its requirements, implementation, tests, manual verification and `STAGE_X_REPORT.md`.

## Commits and review

- Group changes into logical commits with messages such as `feat:`, `fix:`, `refactor:`, `test:`, `ui:`, `docs:` or `chore:`. Do not invent historical commits for work already imported.
- Review staged and complete branch diffs before pushing. Use ordinary pushes; preserve shared history.
- Submit substantial changes through a Pull Request. Treat configured CI requirements as part of completion; distinguish local validation from actual hosted CI results.
- Summarize behavior, important modules, validation, remaining risks, branch name and proposed PR title. Use the PR template and attach visual evidence where relevant.
- Do not merge or publish beyond the user's authorized scope. Continue with routine authorized work without repeated permission requests.
