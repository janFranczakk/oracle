# Repository workflow

GitHub is ORACLE's shared source of truth. `main` contains the reviewed integration state; feature work is developed on separate branches and reviewed through Pull Requests. The first import records the already verified Stages 1–2 without pretending to reconstruct their historical implementation commits.

## Start a task

Read `AGENTS.md`, README, the relevant architecture / dataset documentation, stage requirements, tests and CI. Inspect status and existing local work before switching branches.

```powershell
git status --short --branch
git remote -v
git fetch origin --prune
git log --oneline --decorate -10
```

With a clean working tree, update the integration branch without rewriting history and create a branch for the task:

```powershell
git switch main
git pull --ff-only
git switch -c feature/descriptive-name
```

If local work or divergence exists, preserve it and resolve its ownership first. Never discard another change or force-push as a shortcut. Keep a task limited to its relevant files and record unrelated findings for separate work.

## Validate and deliver

The CI workflow runs pytest, dependency consistency and Ruff on Linux and Windows. Frontend CI uses Node 24 and pnpm 11.25.0 with the committed lockfile, then runs Vitest, ESLint, Prettier and the strict TypeScript / Vite build. Actions are pinned to verified release commits and use read-only repository permissions. CI performs validation only; it does not deploy the app or publish datasets.

Use the matching README commands locally. For visual changes, inspect the actual browser flow and affected desktop sizes; include screenshots. Update the relevant documentation and stage report with observed results and limitations.

```powershell
git diff --check
git diff
git add <explicit-task-files>
git diff --cached --check
git diff --cached
git commit -m "feat: describe the resulting behavior"
git push -u origin feature/descriptive-name
```

Review all new files as well as diffs. Never commit credentials, virtual environments, dependencies, generated datasets, checkpoints, local logs or build output. Avoid unrelated formatting churn. Group implementation, regression tests and documentation into coherent reviewable commits.

Open a Pull Request into `main` using `.github/pull_request_template.md`. Report local checks and hosted CI separately. Merge only within the authorized scope and after the required checks pass. The task summary names the branch, PR, important modules, validation and remaining risks.

## Repository settings

The intended default branch is `main`. Require passing `Backend (ubuntu-latest)`, `Backend (windows-latest)` and `Frontend` checks when branch protection / rulesets are supported by the repository's account plan. Enforced settings must be confirmed in GitHub; documenting a policy does not enable protection. Keep the repository private unless its owner requests publication.

Commit identity is configured locally for this repository from the authenticated owner or explicitly supplied author details. A GitHub-provided noreply address can preserve email privacy. No global Git identity or account settings need to change.
