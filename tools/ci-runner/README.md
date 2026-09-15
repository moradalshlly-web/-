# Disposable CI runners

This pool runs Linux Node test jobs on Railway. Docker jobs, database services,
migrations and publishing remain on GitHub-hosted runners.

## Deployment

Use a dedicated Railway environment with no application secrets or databases.
Deploy this directory with `--path-as-root` and the appropriate Dockerfile:

| Service | Dockerfile | Replicas | Restart policy | Limits |
| --- | --- | --- | --- | --- |
| Each runner slot | `runner.Dockerfile` | 1 | `NEVER` | 2 vCPU, 8 GB |
| Controller | `controller.Dockerfile` | exactly 1 | `ALWAYS` | 1 vCPU, 1 GB |

No service needs a public domain, persistent volume or sleeping mode. Build each
runner slot once before starting the controller. Without an assignment, the
runner image exits successfully. The controller redeploys the built image when
work is queued. Do not attach slots to automatic Git deploys: rebuilding a busy
slot would interrupt its job. Drain the pool before updating its image.

The controller requires these environment variables:

| Variable | Value |
| --- | --- |
| `CI_REPOSITORY` | Private `owner/repository` |
| `CI_RUNNER_SERVICES` | Comma-separated runner service IDs, maximum twenty |
| `CI_GITHUB_TOKEN` | Fine-grained token for only that repository, Administration read/write and Actions read |
| `CI_RAILWAY_TOKEN` | Railway project token scoped to only the CI environment |

Railway supplies `RAILWAY_PROJECT_ID` and `RAILWAY_ENVIRONMENT_ID` automatically.
Store administrative tokens on the controller service only, never as shared
environment variables. Rotate expiring credentials before their expiry. The
controller logs API failures without response bodies or credential values.

## Job isolation and lifecycle

The controller checks queued GitHub jobs every 30 seconds and provisions only
jobs whose source repository matches `CI_REPOSITORY`. Slots receive a GitHub
single-use JIT configuration for labels `self-hosted,linux,x64,nodaro-ci`.
GitHub removes each runner after its first job. Every subsequent job gets a new
Railway deployment and filesystem; slots must never restart the same container.
The runner exits after five minutes without an assignment or one hour overall.
Vitest uses two workers because the host CPU count can exceed the container's
CPU allocation.

The image includes `zstd` to read the same npm download-cache format as hosted
runners. Hosted preparation maintains that cache; disposable test runners
restore it without uploading another copy. A missing cache falls back to a
normal clean dependency download and installation.

Busy slots are protected by both runner state and in-progress job state. An API
failure stops that scheduling cycle. Capacity is bounded by the configured slot
list. Keep exactly one controller replica to prevent competing schedulers.

For a rollout, retain GitHub-hosted routing until an identical-commit benchmark
and an intentional failed-job probe pass. Set repository variable
`CI_RAILWAY_PILOT_BRANCH` to a same-repository PR branch for a limited pilot.
After validating capacity and unattended scheduling, set `CI_RAILWAY_ENABLED`
to `true` to route the two test suites for trusted PRs and pushes to `main`.
Public mirrors and fork PRs always stay hosted. Both settings default to off.

To return to hosted runners, clear both `CI_RAILWAY_ENABLED` and
`CI_RAILWAY_PILOT_BRANCH`, cancel queued pool runs, and rerun them. Allow busy jobs to finish before removing
their runner deployments. A controller outage must leave checks pending or
failed; never turn a missing test into a successful check.

Validate scheduling and preparation locally with:

```sh
node --test tools/__tests__/ci-runner-*.test.mjs tools/__tests__/ci-build-artifact.test.mjs tools/__tests__/ci-preparation-gates.test.mjs
```
