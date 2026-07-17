# SALbot Audit Status

**Audit baseline:** `diese-tech/lab-salbot@dbe67fd346e0003a6c11b58fc1720d2cf09ba766`

**Remediation main:** `56a3d067ba6abfbe80e059a6390ae60e7bfd97c3`

**Last reviewed:** 2026-07-17
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
clean teardown, database recovery, the future database contract, outbox behavior,
or a live Discord flow.

## Remediation register

| Finding | Current status | Tracking |
|---|---|---|
| `SAL-SCOPE-01` | Repository scope cleanup landed in #46. | [#38](https://github.com/diese-tech/lab-salbot/issues/38) |
| `SAL-SEC-01` | Dependency remediation landed in #47 and hard audit gates landed in #49. | [#39](https://github.com/diese-tech/lab-salbot/issues/39) |
| `SAL-RUNTIME-01` | Node 24, frozen pnpm, and all application/container gates are on `main`; database-contract drift remains recovery-gated. | [#40](https://github.com/diese-tech/lab-salbot/issues/40) |
| `SAL-DB-01` | Open: vendor generated database types and verify an immutable database contract lock after `db-v1.0.0`. | [#41](https://github.com/diese-tech/lab-salbot/issues/41) |
| `SAL-OPS-02` | Open: move Discord projections to the durable, lease-based operation outbox. | [#42](https://github.com/diese-tech/lab-salbot/issues/42) |
| `SAL-DEPLOY-01` | Container/Railway contract and CI image proof landed in #50/#49; Railway staging acceptance remains open. | [#43](https://github.com/diese-tech/lab-salbot/issues/43) |
| `SAL-GOV-01` | This repository-specific status, ownership, security, licensing, and update policy is supplied by #48; remote protection is already verified. | [#44](https://github.com/diese-tech/lab-salbot/issues/44) |
| `SAL-DEPLOY-01` | Open: add truthful readiness health, database/outbox checks, and clean SIGTERM acceptance. | [#45](https://github.com/diese-tech/lab-salbot/issues/45) |

## Shared platform gates

- `SAL-OPS-01`: the backup/PITR restore drill is tracked in [`sal-site#156`](https://github.com/diese-tech/sal-site/issues/156). Database consolidation and production schema work stop until the restore is complete and consistent.
- `SAL-DB-01`: [`diese-tech/sal-database`](https://github.com/diese-tech/sal-database) is the designated sole owner of active Supabase migrations, generated types, schema releases, drift detection, and production database pushes. Initial repository adoption is tracked in [`sal-site#172`](https://github.com/diese-tech/sal-site/issues/172); SALbot consumer adoption is tracked in [#41](https://github.com/diese-tech/lab-salbot/issues/41).
- `SAL-OPS-02`: the transactional database RPC and outbox foundation is tracked in [`sal-site#178`](https://github.com/diese-tech/sal-site/issues/178), with the SALbot worker tracked in [#42](https://github.com/diese-tech/lab-salbot/issues/42).

Until the initial database contract release is verified, this repository's `database/migrations/` directory is retained only as pre-contract history. Do not add an active production migration here or push this directory to the shared production project.

## Closure evidence

A finding closes only when its issue links the merged PR and records the relevant verification evidence. Production-sensitive findings also require deployment evidence. Database and approval findings remain open until the recovery drill, contract parity, real PostgreSQL concurrency tests, and one live reschedule/result flow are recorded in the private remediation ledger.
