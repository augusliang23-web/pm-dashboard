# PDF Reporting Week Identity Hotfix Design

## Goal

Keep Overview and Project PDF export available after a reporting-week mutation in the current browser session, and apply the same behavior to production v2.1 and local v2.2T.

## Root Cause

Firestore-loaded weeks carry a non-enumerable `__documentId`. `confirmWeekMutation()` creates a clean clone with object spread, so that metadata is intentionally omitted from the Firestore payload but is also missing from the returned in-memory week. The UI replaces its current week with that returned clone. PDF export then checks only `__documentId` and stops locally with “The selected reporting week is unavailable.”

## Design

Use two small protections:

1. After the Firestore write succeeds, `confirmWeekMutation()` reattaches the source `__documentId` to the returned clone as a non-enumerable property. It is attached after the write so the private client metadata is never sent to Firestore.
2. Both dashboard entry points resolve PDF `weekId` from `__documentId`, then fall back to the existing canonical conversion of `weekLabel` (`W29 2026` to `W29-2026`). This protects exports from other in-memory flows that may produce a week without metadata.

No PDF service, Firestore schema, security rule, or persisted week data changes are required.

## Verification

- A unit test proves the write payload excludes `__documentId`, while the returned week retains it as non-enumerable metadata.
- A source-contract test proves both v2.1 dashboard entry points contain the `weekLabel` fallback.
- Run the complete v2.1 test suite before deployment.
- After GitHub Pages deployment, test both Overview and Project PDF exports on the live production URL.
- Apply the same commit locally to v2.2T and run the focused regression tests; do not push or deploy v2.2T.
