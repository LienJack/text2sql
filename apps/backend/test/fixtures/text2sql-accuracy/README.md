# Text2SQL accuracy fixture contract

This directory contains reviewable, sanitized contracts only. It must not contain
production rows, database connection strings, signing private keys, or raw signed
Outcome envelopes.

- `guideline-baseline.json` freezes the selected upstream research artifacts by
  digest and maps drift to affected requirements.
- `sanitized-reference-slice.json` executes baseline and candidate SQL against two
  deterministic SQLite fixtures. The second fixture exposes the silent
  `SUM(DISTINCT amount)` mutation from AE1.
- `thresholds.json` is a pre-approved reference profile for contract tests, not a
  production threshold approval.

Real fixtures live below `TEXT2SQL_ACCURACY_FIXTURE_ROOT`. Release runners emit
Ed25519-signed Outcome envelopes into a controlled evidence directory. The
collector exposes only receipt identities, pass/fail state, reason codes, and
aggregates; it never emits fixture rows, SQL setup data, keys, or external paths.
