# SALbot Audit Status

**Audit baseline:** `diese-tech/lab-salbot@dbe67fd346e0003a6c11b58fc1720d2cf09ba766`

**Remediation main:** `56a3d067ba6abfbe80e059a6390ae60e7bfd97c3`

**Last reviewed:** 2026-07-18
**Scope:** SALbot production engineering, its database contract, and its deployment boundary.

This file is the repository-specific status source for current SALbot findings. The [July 14 platform audit](audit-production-readiness-2026-07-14.md) is a frozen historical snapshot and is not the current implementation ledger.

## Audit-baseline verification

These historical results explain why remediation was opened; they are not claims
about current `main`.

| Check | Result at the audit baseline |
|---|---|
| Frozen pnpm install | Passed |
| Active package tests | 34 passed: shared 5, database 10, bot 19 |
| Active package lint, typecheck, and build | Passed |
| Full dependency audit | 1 critical, 8 high, 13 moderate, 5 low |
| Committed bot deployment contract | Missing |
| Backup/PITR restore evidence | Not verified; launch gate remains open |

The package-level verification was the reliable Windows check while the root Turbo
command was affected by local process/file-lock behavior.

## Remediation evidence on `main`

- [PR #46](https://github.com/diese-tech/lab-salbot/pull/46) removed inactive
  `apps/web` and ForgeLens runtime scaffolds while retaining future-design docs.
- [PR #47](https://github.com/diese-tech/lab-salbot/pull/47) cleared all
  production advisories and all high/critical findings in the full audit.
- [PR #50](https://github.com/diese-tech/lab-salbot/pull/50) committed the pinned,
  multi-stage non-root image and Railway start/restart/zero-overlap/drain contract.
- [PR #49](https://github.com/diese-tech/lab-salbot/pull/49) moved active
  packages and CI to Node 24/pnpm 9, removed `--passWithNoTests`, and made build,
  test, lint, typecheck, audits, secret scan, whitespace, and the production image
  required jobs. [CI run 29560034588](https://github.com/diese-tech/lab-salbot/actions/runs/29560034588)
  passed all nine jobs, including the image build and live non-root/workspace-import
  smoke. The recorded audits are 0 production vulnerabilities and 0 high/critical
  full-graph findings.

These results still do not prove Railway staging singleton behavior, `/healthz`,
clean teardown, outbox behavior,
or a live Discord flow.

- [PR #55](https://github.com/diese-tech/lab-salbot/pull/55) resolves captain
  permissions and match eligibility through the current season, vendors the
  generated `db-v1.2.0` types, and adds a hard immutable-contract drift gate.

## Remediation register

| Finding | Current status | Tracking |
|---|---|---|
| `SAL-SCOPE-01` | Repository scope cleanup landed in #46. | [#38](https://github.com/diese-tech/lab-salbot/issues/38) |
| `SAL-SEC-01` | Dependency remediation landed in #47 and hard audit gates landed in #49. | [#39](https://github.com/diese-tech/lab-salbot/issues/39) |
| `SAL-RUNTIME-01` | Node 24, frozen pnpm, application/container gates, and the immutable database-contract drift gate are implemented. | [#40](https://github.com/diese-tech/lab-salbot/issues/40), [PR #55](https://github.com/diese-tech/lab-salbot/pull/55) |
| `SAL-DB-01` | SALbot vendors the generated types and verifies immutable `db-v1.2.0` at commit `195a0792a396354d7809d7dcbb85a9cdfd4d8030`. | [#41](https://github.com/diese-tech/lab-salbot/issues/41), [PR #55](https://github.com/diese-tech/lab-salbot/pull/55) |
| `SAL-OPS-02` | Open: move Discord projections to the durable, lease-based operation outbox. | [#42](https://github.com/diese-tech/lab-salbot/issues/42) |
| `SAL-DEPLOY-01` | Container/Railway contract and CI image proof landed in #50/#49; Railway staging acceptance remains open. | [#43](https://github.com/diese-tech/lab-salbot/issues/43) |
| `SAL-GOV-01` | This repository-specific status, ownership, security, licensing, and update policy is supplied by #48; remote protection is already verified. | [#44](https://github.com/diese-tech/lab-salbot/issues/44) |
| `SAL-DEPLOY-01` | Open: add truthful readiness health, database/outbox checks, and clean SIGTERM acceptance. | [#45](https://github.com/diese-tech/lab-salbot/issues/45) |

## Shared platform gates

- `SAL-OPS-01`: the representative scratch restore and data-preservation comparison passed; recurring home-lab backup evidence remains tracked in [`sal-site#156`](https://github.com/diese-tech/sal-site/issues/156).
- `SAL-DB-01`: [`diese-tech/sal-database`](https://github.com/diese-tech/sal-database) is the sole owner of active Supabase migrations, generated types, releases, drift detection, and production pushes. SALbot pins `db-v1.2.0` through `db-contract.lock.json`.
- `SAL-OPS-02`: the transactional database RPC and outbox foundation is tracked in [`sal-site#178`](https://github.com/diese-tech/sal-site/issues/178), with the SALbot worker tracked in [#42](https://github.com/diese-tech/lab-salbot/issues/42).

This repository's `database/migrations/` directory is retained only as pre-contract history. Do not add an active production migration here or push this directory to the shared production project.

## Closure evidence

A finding closes only when its issue links the merged PR and records the relevant verification evidence. Production-sensitive findings also require deployment evidence. Database and approval findings remain open until the recovery drill, contract parity, real PostgreSQL concurrency tests, and one live reschedule/result flow are recorded in the private remediation ledger.
