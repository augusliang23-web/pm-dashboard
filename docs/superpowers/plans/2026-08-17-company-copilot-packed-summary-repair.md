# Company Copilot Packed Summary Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept complete company Copilot Weekly Summaries whose headings and labelled fields were compressed onto one line, store only canonical text, and prove that accepted summaries remain safe and stable in Overview PDFs.

**Architecture:** Add a pure packed-label expansion stage inside the browser Weekly Summary normalizer before its existing line-level normalization and contextual validation. Build a deterministic, fictional-data corpus with 20 membership contexts and five format families per context; pass every accepted browser result through the server-side PDF structural validator, then run representative accepted results through the existing measured PDF layout renderer.

**Tech Stack:** Browser ECMAScript modules, Node.js built-in `node:test`, existing Firebase browser save flow, Node.js PDF service, Puppeteer measured-layout tests.

## Global Constraints

- Do not export, paste, log, persist, or commit company Copilot output, project facts, customer data, or screenshots as test content.
- Use fictional names and generated neutral field values for all new fixtures.
- Repair only a complete, ordered, non-duplicated label sequence; never invent omitted facts or project identities.
- Keep `WEEKLY MOVEMENT` membership as current active plus comparison-week removed projects; keep `MANAGEMENT ASK` membership current active only.
- Continue to store only canonical multiline text in `week.summary`; do not change the Firestore schema.
- Keep the PDF service structural-only: browser save owns contextual project membership, PDF export remains the defensive HTTP 422 boundary.
- Root dashboard and `team-2` must use the same shared browser contract and present equivalent correction feedback.
- Run real PDF browser tests only through `npm test` from `pdf-service` so the existing shared Chrome lock serializes layouts.
- Preserve unrelated dirty files in the primary workspace. Work only in the isolated feature worktree.

---

### Task 1: Add fictional packed-format fixtures and failing contract tests

**Files:**
- Create: `tests/weekly-summary-packed-fixtures.mjs`
- Modify: `tests/weekly-summary-normalization.test.mjs`
- Modify: `tests/weekly-summary-contract.test.mjs`

**Interfaces:**
- Produces `packedSummaryContext`, `packedMovementNoAskSummary`, `packedHeadingAndAskSummary`, and `invalidPackedSummaryCases` from `tests/weekly-summary-packed-fixtures.mjs`.
- `packedSummaryContext` has `{ currentProjects, historicalProjects }`, with only fictional project names.
- `invalidPackedSummaryCases` is an array of `{ id, source, expectedError }` records for incomplete, duplicate, reversed, and unsafe packed labels.
- Consumes the public `normalizeWeeklySummaryForSave(source, context)` interface; no new browser API is exposed by this task.

- [ ] **Step 1: Define neutral, structurally complete packed examples**

Create `tests/weekly-summary-packed-fixtures.mjs` with the following context and fully labelled shapes:

```js
export const packedSummaryContext = {
  currentProjects: [
    { name: 'Scenario One / Alpha' },
    { name: 'Scenario One / Beta' }
  ],
  historicalProjects: [{ name: 'Scenario One / Released' }]
};

export const packedMovementNoAskSummary = [
  'WEEKLY MOVEMENT Portfolio Summary: Delivery remains stable.',
  '- Project: Scenario One / Alpha Movement: Validation completed. Blocker: None Next step: Confirm the release date.',
  '- Project: Scenario One / Released Movement: Archived after release. Blocker: None Next step: Retain the project record.',
  'MANAGEMENT ASK',
  'No immediate management decision required this week.'
].join('\n');

export const packedHeadingAndAskSummary = [
  'WEEKLY MOVEMENT Portfolio Summary: One decision needs support.',
  'Project: Scenario One / Beta Movement: Integration entered review. Blocker: Supplier timing remains open. Next step: Confirm recovery ownership.',
  'MANAGEMENT ASK - Project: Scenario One / Beta Decision / Support needed: Approve supplier escalation. Business impact: Protects the pilot date.'
].join('\n');
```

Use fictional values only. Add invalid sources that respectively omit `Next step:`, duplicate `Blocker:`, place `Blocker:` before `Movement:`, mix `Business impact:` into a movement entry, and use an unknown project.

- [ ] **Step 2: Write the failing packed-format tests**

Append tests to `tests/weekly-summary-normalization.test.mjs`:

```js
test('expands a complete packed movement entry and inline portfolio heading', () => {
  const result = normalizeWeeklySummaryForSave(packedMovementNoAskSummary, packedSummaryContext);
  assert.equal(result.ok, true);
  assert.match(result.canonicalText, /^WEEKLY MOVEMENT\nPortfolio Summary: Delivery remains stable\./);
  assert.match(result.canonicalText, /- Project: Scenario One \/ Alpha\n  Movement: Validation completed\./);
  assert.match(result.canonicalText, /- Project: Scenario One \/ Released\n  Movement: Archived after release\./);
  assert.ok(result.corrections.some(item => item.message.includes('expanded a packed movement entry')));
});

test('expands a complete packed Management Ask entry', () => {
  const result = normalizeWeeklySummaryForSave(packedHeadingAndAskSummary, packedSummaryContext);
  assert.equal(result.ok, true);
  assert.match(result.canonicalText, /MANAGEMENT ASK\n- Project: Scenario One \/ Beta\n  Decision \/ Support needed:/);
  assert.ok(result.corrections.some(item => item.message.includes('expanded a packed management ask entry')));
});
```

Add a parameterized test that asserts every `invalidPackedSummaryCases` result has `ok === false`, `canonicalText === ''`, and an error containing its `expectedError`.

- [ ] **Step 3: Run the focused test before implementation**

Run:

```sh
node --test tests/weekly-summary-normalization.test.mjs tests/weekly-summary-contract.test.mjs
```

Expected: the two complete packed examples fail because the current line-only normalizer leaves `Movement:`, `Blocker:`, and `Next step:` inside the project line.

- [ ] **Step 4: Commit the failing fixture and test contract**

```sh
git add tests/weekly-summary-packed-fixtures.mjs tests/weekly-summary-normalization.test.mjs tests/weekly-summary-contract.test.mjs
git commit -m "test: cover packed Copilot summary inputs"
```

### Task 2: Implement fail-closed packed-label expansion in the shared browser contract

**Files:**
- Modify: `js/weekly-summary-contract.mjs`
- Test: `tests/weekly-summary-normalization.test.mjs`
- Test: `tests/weekly-summary-contract.test.mjs`

**Interfaces:**
- Consumes `normalizeWeeklySummaryForSave(source, { currentProjects, historicalProjects })`.
- Produces the existing result shape: `{ ok, canonicalText, errors, corrections, brief, summary }`.
- Adds only private helpers: `expandPackedSummaryLines`, `expandInlineHeading`, `expandPackedProjectEntry`, and `splitOrderedPackedFields`.
- Correction records retain `{ line, before, after, message }`; `line` always identifies the original physical source line.

- [ ] **Step 1: Add the failing-safe label matchers**

Define ordered field families near the existing label constants:

```js
const PACKED_MOVEMENT_FIELDS = [
  ['Movement', /\s+Movement\s*[:：]\s*/ig],
  ['Blocker', /\s+Blocker\s*[:：]\s*/ig],
  ['Next step', /\s+Next step\s*[:：]\s*/ig]
];
const PACKED_MANAGEMENT_FIELDS = [
  ['Decision / Support needed', /\s+Decision\s*\/\s*Support needed\s*[:：]\s*/ig],
  ['Business impact', /\s+Business impact\s*[:：]\s*/ig]
];
```

Implement `splitOrderedPackedFields(value, fields)` so it returns `null` unless every matcher has exactly one match, the match indices strictly increase, and every captured segment is non-empty. Reset each regular expression `lastIndex` before every scan. Return `{ projectName, values }`, where `projectName` is the source before the first label and each value is the source between adjacent labels.

- [ ] **Step 2: Expand only complete structures before line normalization**

Implement the following private helper behaviour:

```js
function expandInlineHeading(line, lineNumber, corrections) {
  const weekly = line.trim().match(/^WEEKLY MOVEMENT\s+Portfolio Summary\s*[:：]\s*(.+)$/i);
  if (weekly) {
    const after = ['WEEKLY MOVEMENT', `Portfolio Summary: ${weekly[1].trim()}`];
    corrections.push(correction(lineNumber, line, after.join('\n'),
      'Split WEEKLY MOVEMENT and Portfolio Summary into separate lines.'));
    return after;
  }
  const management = line.trim().match(/^MANAGEMENT ASK\s+(.*)$/i);
  if (management?.[1].trim()) {
    const after = ['MANAGEMENT ASK', management[1].trim()];
    corrections.push(correction(lineNumber, line, after.join('\n'),
      'Split MANAGEMENT ASK and its following entry into separate lines.'));
    return after;
  }
  return [line];
}

function expandPackedProjectEntry(line, lineNumber, corrections, fields, kind) {
  const project = line.trim().match(PROJECT_LINE_VARIANT);
  if (!project) return [line];
  const packed = splitOrderedPackedFields(project[1], fields);
  if (!packed) return [line];
  const after = [
    `- Project: ${packed.projectName}`,
    ...packed.values.map(([label, value]) => `  ${label}: ${value}`)
  ];
  corrections.push(correction(lineNumber, line, after.join('\n'),
    `expanded a packed ${kind} entry into labelled fields.`));
  return after;
}
```

`expandPackedSummaryLines` must first expand inline headings, track whether the current section is movement or management, then call `expandPackedProjectEntry` with only the matching field family. A line that cannot prove a full ordered field sequence is returned unchanged so canonical validation produces the existing red error.

- [ ] **Step 3: Insert expansion into the normalizer pipeline**

Change `normalizeWeeklySummaryForSave` to use this order:

```js
const raw = String(source ?? '');
const normalized = raw.replace(/\r\n?/g, '\n');
const corrections = [];
const expandedLines = expandPackedSummaryLines(normalized.split('\n'), corrections);
const canonicalCandidate = expandedLines
  .map((line, index) => normalizeLine(line, index + 1, corrections))
  .join('\n');
const validation = validateCanonicalWeeklySummary(canonicalCandidate, buildProjectContext(context));
```

Do not call the PDF module from the browser. Do not allow expansion to bypass `validateCanonicalWeeklySummary`, `resolveProject`, `readField`, Markdown rejection, or management-ask limits.

- [ ] **Step 4: Verify focused acceptance, idempotence, and safety rejection**

Run:

```sh
node --test tests/weekly-summary-normalization.test.mjs tests/weekly-summary-contract.test.mjs
```

Expected: complete packed fixtures pass, a second normalization has zero corrections, and incomplete/duplicated/reversed/unknown fixtures remain rejected.

- [ ] **Step 5: Commit the minimal browser-contract implementation**

```sh
git add js/weekly-summary-contract.mjs tests/weekly-summary-normalization.test.mjs tests/weekly-summary-contract.test.mjs
git commit -m "feat: expand complete packed Copilot summaries"
```

### Task 3: Present structural corrections safely and identically in both dashboards

**Files:**
- Modify: `index.html:9595-9611`
- Modify: `team-2/index.html:9488-9504`
- Modify: `tests/weekly-summary-correction-ui.test.mjs`
- Modify: `tests/weekly-summary-save-ui.test.mjs`

**Interfaces:**
- Consumes existing `showWeeklySummaryCorrections(corrections)` from both dashboard entry points.
- Uses each correction record's `message` as the primary user-visible explanation.
- Produces only DOM nodes and `textContent`; it must never interpolate an AI value with `innerHTML`.

- [ ] **Step 1: Write UI source tests for packed-format correction messages**

Extend `tests/weekly-summary-correction-ui.test.mjs` to require both dashboard helpers to reference `item.message`, retain `textContent`, and avoid `innerHTML`:

```js
assert.match(helper, /item\.message/);
assert.match(helper, /detail\.textContent\s*=\s*item\.message/);
assert.doesNotMatch(helper, /innerHTML/);
```

Extend `tests/weekly-summary-save-ui.test.mjs` to keep asserting that validation runs before `await setDoc` and `showWeeklySummaryCorrections(result.corrections)` runs only after the successful save path.

- [ ] **Step 2: Run UI tests before changing the helpers**

Run:

```sh
node --test tests/weekly-summary-correction-ui.test.mjs tests/weekly-summary-save-ui.test.mjs
```

Expected: the new `item.message` assertion fails because the current dialog only renders `before → after`.

- [ ] **Step 3: Render structural messages with a safe fallback**

In both `showWeeklySummaryCorrections` helpers, replace the detail assignment with:

```js
detail.textContent = item.message || `${item.before} → ${item.after}`;
```

Keep the line number prefix, `createElement`, `append`, `replaceChildren`, and `openAccessibleModal` unchanged. Do not alter `saveWeekSummary` sequencing, Firestore writes, role checks, or the correction modal's accessibility attributes.

- [ ] **Step 4: Run both UI and normalization tests**

Run:

```sh
node --test tests/weekly-summary-normalization.test.mjs tests/weekly-summary-correction-ui.test.mjs tests/weekly-summary-save-ui.test.mjs
```

Expected: both entry points describe packed corrections without HTML interpolation; invalid text still returns before a Firestore write.

- [ ] **Step 5: Commit user-visible correction feedback**

```sh
git add index.html team-2/index.html tests/weekly-summary-correction-ui.test.mjs tests/weekly-summary-save-ui.test.mjs
git commit -m "feat: explain packed summary corrections"
```

### Task 4: Replace the small corpus with the 100-case synthetic quality gate

**Files:**
- Modify: `tests/weekly-summary-corpus.mjs`
- Modify: `tests/weekly-summary-corpus.test.mjs`
- Modify: `docs/weekly-summary-corpus.md`
- Test: `tests/weekly-summary-normalization.test.mjs`

**Interfaces:**
- `weeklySummaryCorpus` contains exactly 100 records: 80 `accept` and 20 `reject`.
- Every record has `{ id, source, sourceType: 'synthetic', observed: false, context, expected, family, expectedCanonical?, expectedError?, minimumCorrections? }`.
- `buildSyntheticWeekContexts()` returns exactly 20 contexts with fictional names and zero company data.
- `buildDeterministicPackedMutations()` returns exactly 1,000 valid, deterministic format variants derived from the 20 contexts.

- [ ] **Step 1: Write count, privacy, and cross-boundary failure assertions**

Replace the loose `length >= 8` assertion in `tests/weekly-summary-corpus.test.mjs` with the release gate:

```js
assert.equal(weeklySummaryCorpus.length, 100);
assert.equal(weeklySummaryCorpus.filter(item => item.expected === 'accept').length, 80);
assert.equal(weeklySummaryCorpus.filter(item => item.expected === 'reject').length, 20);
assert.deepEqual(new Set(weeklySummaryCorpus.map(item => item.family)), new Set([
  'canonical', 'presentation-variant', 'packed-movement', 'packed-heading-and-ask', 'safety-negative'
]));
assert.ok(weeklySummaryCorpus.every(item => item.sourceType === 'synthetic' && item.observed === false));
```

For accepted cases, require `result.canonicalText === testCase.expectedCanonical`, `result.corrections.length >= testCase.minimumCorrections`, PDF contract success, and zero corrections on the second pass. For rejected cases, require `canonicalText === ''` and a matching diagnostic.

Add a single test loop over `buildDeterministicPackedMutations()` that requires exactly 1,000 generated cases and successful browser normalization, PDF validation, and idempotence for every one.

- [ ] **Step 2: Run the corpus test to establish the failing gate**

Run:

```sh
node --test tests/weekly-summary-corpus.test.mjs
```

Expected: FAIL because the current registry has 11 cases and does not expose the required five families or deterministic mutations.

- [ ] **Step 3: Implement the fictional context and format-family builders**

In `tests/weekly-summary-corpus.mjs`, create these deterministic builders:

```js
export function buildSyntheticWeekContexts() {
  return Array.from({ length: 20 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    const currentProjects = Array.from({ length: (index % 6) + 1 }, (_, projectIndex) => ({
      name: `Week ${number} / Project ${projectIndex + 1}${projectIndex === 0 && index % 4 === 0 ? ' · R&D' : ''}`
    }));
    const historicalProjects = index % 2 === 0
      ? [{ name: `Week ${number} / Released Project` }]
      : [];
    return { id: `week-${number}`, currentProjects, historicalProjects, askCount: index % 5 };
  });
}
```

For each context, create one canonical source, one marker/CRLF/full-width-colon source, one packed movement source, one inline-heading plus packed-management source, and one safety-negative source. Generate `expectedCanonical` independently from the source formatter, using the canonical labels and the official names from the context. Rotate the safety-negative subtype by context index so the 20 negatives cover missing, duplicate, reversed, empty, mixed-family, unknown-project, historical-management, Markdown, table, and excessive-ask errors twice each.

Use only neutral field text such as `Movement 01 completed.`, `Blocker: None`, and `Business impact protects the scenario date.`. Delete the observed Gemini source from this 100-case registry; retain its coverage as a focused normalization fixture if needed, so the named corpus remains entirely synthetic and exactly 100 cases.

- [ ] **Step 4: Update corpus documentation for no-content-export operation**

Replace the 11-case and verbatim-sample instructions in `docs/weekly-summary-corpus.md` with:

- the exact 80 accepted / 20 rejected gate;
- the five format families;
- the 1,000 deterministic supplementary mutations;
- the fact that fixtures use fictional content only;
- how a company screenshot is converted into a new anonymous structural shape rather than copied verbatim; and
- the distinction between 100% defined-contract coverage and non-guaranteed future AI prose.

- [ ] **Step 5: Run the complete fast quality gate**

Run:

```sh
node --test \
  tests/weekly-summary-contract.test.mjs \
  tests/weekly-summary-normalization.test.mjs \
  tests/weekly-summary-corpus.test.mjs \
  tests/weekly-summary-prompt.test.mjs \
  tests/weekly-summary-correction-ui.test.mjs \
  tests/weekly-summary-save-ui.test.mjs
```

Expected: 100 fixed cases, 1,000 deterministic mutations, existing prompt rules, and both dashboard UI source contracts pass without a network call.

- [ ] **Step 6: Commit the deterministic test gate**

```sh
git add tests/weekly-summary-corpus.mjs tests/weekly-summary-corpus.test.mjs tests/weekly-summary-normalization.test.mjs docs/weekly-summary-corpus.md
git commit -m "test: add 100-case packed summary corpus"
```

### Task 5: Prove PDF contract parity and representative rendered-PDF stability

**Files:**
- Modify: `pdf-service/test/executive-summary-brief.test.mjs`
- Modify: `pdf-service/test/report-data.test.mjs`
- Modify: `pdf-service/test/pdf-layout.test.mjs`
- Modify: `pdf-service/test/report-fixtures.mjs`
- Test: `tests/weekly-summary-corpus.test.mjs`

**Interfaces:**
- Consumes accepted canonical corpus outputs from `normalizeWeeklySummaryForSave` and the existing `validateExecutiveSummaryForPdf`/`validateWeeklySummaryForPdf` APIs.
- Produces no new runtime endpoint, stored field, or service configuration.
- Adds `packedRepairExecutiveSummaryFixture()` to report fixtures; it returns only canonical fictional text obtained by normalizing a packed fictional source during fixture construction.

- [ ] **Step 1: Add a failing PDF-parity test for the repaired packed fixture**

In `pdf-service/test/executive-summary-brief.test.mjs`, import the fictional packed fixture/context and browser normalizer. Add:

```js
test('accepts canonical text produced from a packed company Copilot shape', () => {
  const repaired = normalizeWeeklySummaryForSave(packedHeadingAndAskSummary, packedSummaryContext);
  assert.equal(repaired.ok, true);
  assert.equal(validateExecutiveSummaryForPdf(repaired.canonicalText).ok, true);
});
```

In `pdf-service/test/report-data.test.mjs`, add an authorized Overview request whose stored `summary` is `repaired.canonicalText`; assert it returns the `executive-summary` section. Add the same request with a missing packed field that remains unnormalized and assert `ReportDataError` status `422`.

- [ ] **Step 2: Run the PDF contract tests after browser repair**

Run:

```sh
node --test pdf-service/test/executive-summary-brief.test.mjs pdf-service/test/report-data.test.mjs
```

Expected: the repaired canonical text passes the PDF contract after Task 2's browser repair; the malformed packed source remains structurally rejected.

- [ ] **Step 3: Add a canonical packed-repair report fixture**

Add `packedRepairExecutiveSummaryFixture()` in `pdf-service/test/report-fixtures.mjs`. It must return the literal canonical fictional summary produced by the Task 1 examples, not a packed input. This keeps the PDF renderer contract canonical and verifies that browser repair produces PDF-safe stored text.

- [ ] **Step 4: Add measured layout coverage for compact and stress repaired summaries**

In `pdf-service/test/pdf-layout.test.mjs`, add two tests using `completeOverviewReportFixture()` with `sections = ['executive-summary']`:

```js
test('renders a repaired packed-summary result with its labels and project names intact', { timeout: 60000 }, async () => {
  const fixture = completeOverviewReportFixture();
  fixture.sections = ['executive-summary'];
  fixture.week.executiveSummary = packedRepairExecutiveSummaryFixture();
  const html = renderOverviewReportHtml(fixture);
  assert.match(html, /Scenario One \/ Alpha/);
  assert.match(html, /Decision \/ Support needed/);
  const pdf = await renderPdfBuffer(html);
  assert.ok(pdf.length > 1000);
  assert.ok(physicalPageCount(pdf) >= 1);
});
```

In the same test, create a Puppeteer page from `html`, run `paginateMeasuredFlows`, and assert `document.body.innerText` contains `Scenario One / Alpha`, `Validation completed.`, and `Approve supplier escalation.` before rendering the PDF. This verifies the measured renderer received every expected field while the PDF buffer/page-count assertions verify successful output.

Add a second test that uses the existing six-project, four-ask `stressExecutiveSummaryFixture()` together with the measured paginator. Assert every `.report-page` has A4 landscape height within one pixel, every page header begins below 20 px, every footer remains at least 20 px above the page bottom, every page has non-empty `[data-pdf-flow-items]` text, and the generated PDF page count equals the measured page count. This extends the existing stress assertion instead of introducing a second renderer.

- [ ] **Step 5: Run the serialized PDF suite**

Run:

```sh
cd pdf-service
npm ci
npm test
```

Expected: all PDF contract, report-data, measured paginator, and layout tests pass with no blank Executive Summary page, clipped footer, missing project text in rendered HTML, or render failure.

- [ ] **Step 6: Commit PDF stability coverage**

```sh
git add \
  pdf-service/test/executive-summary-brief.test.mjs \
  pdf-service/test/report-data.test.mjs \
  pdf-service/test/pdf-layout.test.mjs \
  pdf-service/test/report-fixtures.mjs \
  tests/weekly-summary-corpus.test.mjs
git commit -m "test: verify packed summaries in PDF output"
```

### Task 6: Perform full regression verification and document the company-safe release check

**Files:**
- Modify: `docs/weekly-summary-corpus.md`
- Modify: `docs/superpowers/specs/2026-08-17-company-copilot-packed-summary-repair-design.md`
- Test: `tests/weekly-summary-contract.test.mjs`
- Test: `tests/weekly-summary-normalization.test.mjs`
- Test: `tests/weekly-summary-corpus.test.mjs`
- Test: `tests/weekly-summary-prompt.test.mjs`
- Test: `tests/weekly-summary-save-ui.test.mjs`
- Test: `tests/weekly-summary-correction-ui.test.mjs`
- Test: `pdf-service` complete `npm test`

**Interfaces:**
- Produces a documented release gate: 100 named synthetic cases, 1,000 deterministic mutations, browser/PDF contract parity, and representative measured PDF render coverage.
- Produces no telemetry, AI integration, raw company fixture, deployment, or schema change.

- [ ] **Step 1: Add the company-safe black-box release instruction**

Append this exact operational rule to `docs/weekly-summary-corpus.md`:

```markdown
After a deployed build passes the automated gate, one company-side paste is optional confirmation, not a 20-run test requirement. Keep the generated text in the company environment. Record only one of: saved without correction, saved with packed-format correction, or blocked with a structural error. A screenshot may be used to describe a new structure, but its wording must be replaced with fictional labels and facts before it becomes a fixture.
```

Update the design status to `Implemented and verified` only after every command in Step 2 passes. Otherwise leave the design status as approved/pending and report the exact failed command.

- [ ] **Step 2: Run all final checks from the worktree**

Run:

```sh
git diff --check
node --test \
  tests/weekly-summary-contract.test.mjs \
  tests/weekly-summary-normalization.test.mjs \
  tests/weekly-summary-corpus.test.mjs \
  tests/weekly-summary-prompt.test.mjs \
  tests/weekly-summary-correction-ui.test.mjs \
  tests/weekly-summary-save-ui.test.mjs
cd pdf-service && npm test
```

Expected: all commands exit `0`; 100 fixed cases and 1,000 mutations pass; PDF layouts retain measured page boundaries; no source file has whitespace errors.

- [ ] **Step 3: Inspect the exact change set before handoff**

Run:

```sh
git status --short
git log --oneline --decorate -6
git diff 48bade5..HEAD -- js/weekly-summary-contract.mjs index.html team-2/index.html tests pdf-service docs
```

Expected: only the packed-summary normalizer, its tests, PDF tests, and documentation are present. Stop and report any unrelated file before staging it.

- [ ] **Step 4: Commit final documentation only after checks pass**

```sh
git add docs/weekly-summary-corpus.md docs/superpowers/specs/2026-08-17-company-copilot-packed-summary-repair-design.md
git commit -m "docs: record packed summary verification gate"
```
