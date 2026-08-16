# Weekly Summary Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Turn the existing Weekly Summary fixtures into a measurable corpus that verifies AI-output normalization, semantic rejection, and PDF compatibility in one repeatable command.

**Architecture:** Keep fixtures as plain JavaScript data with explicit project context and expected outcomes. A root test runner will pass accepted and rejected cases through the browser save normalizer, then pass accepted canonical text through the PDF service contract parser. Existing PDF layout tests remain the visual/stress layer; the new corpus runner is the cross-boundary contract layer.

**Tech Stack:** Node.js built-in test runner, ESM fixtures, existing browser contract module, existing PDF summary contract module, npm scripts.

## Global Constraints

- Never invent project facts or turn an unknown project into an accepted fixture.
- Accepted cases must be canonicalizable, PDF-parseable, and idempotent after normalization.
- Rejected cases must fail with a specific expected diagnostic category.
- Preserve existing unrelated dirty files and do not change production or UAT deployment configuration.
- Real Copilot/Gemini samples can be added as fixture data without changing the runner.

---

### Task 1: Define the measurable corpus registry

**Files:**
- Create: `tests/weekly-summary-corpus.mjs`
- Test: `tests/weekly-summary-corpus.test.mjs`

**Interfaces:**
- Produces `weeklySummaryCorpus`, an array of `{ id, source, context, expected: 'accept' | 'reject', expectedError?: string, expectedCorrections?: number }`.
- Reuses existing fixtures from `tests/weekly-summary-contract-fixtures.mjs`.

- [x] **Step 1: Write the failing corpus test**

  Add tests that assert the registry contains accepted Gemini-format, six-project long, stress, and rejected missing-field/unknown-project/too-many-asks cases, with unique IDs and literal expected outcomes.

- [x] **Step 2: Run the test to verify it fails**

  Run: `node --test tests/weekly-summary-corpus.test.mjs`

  Expected: FAIL because `tests/weekly-summary-corpus.mjs` does not exist.

- [x] **Step 3: Add the registry**

  Build the registry from existing fixtures, with explicit current project lists matching each accepted fixture and expected error fragments for rejected fixtures.

- [x] **Step 4: Run the test to verify it passes**

  Run: `node --test tests/weekly-summary-corpus.test.mjs`

- [x] **Step 5: Commit**

  Run: `git add tests/weekly-summary-corpus.mjs tests/weekly-summary-corpus.test.mjs && git commit -m "test: define weekly summary corpus"`

### Task 2: Run every corpus case through save and PDF contracts

**Files:**
- Modify: `tests/weekly-summary-corpus.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes `weeklySummaryCorpus` from Task 1.
- Uses `normalizeWeeklySummaryForSave` for browser behavior and `validateWeeklySummaryForPdf` for PDF compatibility.
- Produces a test summary with accepted, rejected, auto-corrected, and PDF-compatible counts.

- [x] **Step 1: Write the failing behavior assertions**

  For accepted cases, assert `ok`, non-empty canonical text, PDF validation success, and second-pass normalization with zero corrections. For rejected cases, assert `ok === false` and an error containing `expectedError`.

- [x] **Step 2: Run to verify the new assertions fail for unregistered complexity**

  Run: `node --test tests/weekly-summary-corpus.test.mjs`

  Expected: FAIL for any fixture whose project context or expected contract is not yet wired correctly.

- [x] **Step 3: Implement the corpus execution loop**

  Keep the loop data-driven; do not special-case fixture IDs in production code. Add an npm script `test:weekly-summary-corpus` that runs this file.

- [x] **Step 4: Run the corpus and focused regression tests**

  Run: `npm run test:weekly-summary-corpus` and `node --test tests/weekly-summary-contract.test.mjs tests/weekly-summary-normalization.test.mjs tests/weekly-summary-prompt.test.mjs tests/weekly-summary-save-ui.test.mjs tests/weekly-summary-correction-ui.test.mjs`.

- [x] **Step 5: Commit**

  Run: `git add tests/weekly-summary-corpus.test.mjs package.json && git commit -m "test: verify weekly summary corpus across save and PDF"`

### Task 3: Document coverage and real-AI sample intake

**Files:**
- Modify: `README.md`
- Modify: `tests/weekly-summary-corpus.mjs`

**Interfaces:**
- Documents the corpus command, case categories, and how to add anonymized Copilot/Gemini outputs.
- Keeps real AI samples as data-only additions with no runner changes.

- [ ] **Step 1: Add a fixture intake test**

  Assert each corpus case has a stable ID, explicit expected outcome, project context, and no empty source.

- [ ] **Step 2: Document coverage interpretation**

  Explain that contract coverage can target 100% of defined cases, while real-generator coverage is measured by observed samples and never promises arbitrary AI output success.

- [ ] **Step 3: Run all corpus and PDF contract checks**

  Run: `npm run test:weekly-summary-corpus` and `node --test pdf-service/test/executive-summary-brief.test.mjs pdf-service/test/report-data.test.mjs`.

- [ ] **Step 4: Commit**

  Run: `git add README.md tests/weekly-summary-corpus.mjs && git commit -m "docs: explain weekly summary coverage"`
