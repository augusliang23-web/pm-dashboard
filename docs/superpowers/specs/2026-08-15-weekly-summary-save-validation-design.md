# Weekly Summary Save Validation Design

**Date:** 2026-08-15
**Status:** Approved design; pending user review before implementation planning

## Objective

Make the Weekly Summary a validated report input rather than best-effort AI text. A user must not be able to save a summary that cannot be rendered as the structured Executive Summary in the Overview PDF.

The validation point is **Save Summary**, not PDF download. Invalid text must remain visible and editable in the Week Management dialog, while the previously saved summary remains untouched.

## User workflow

1. The user opens Week Management and copies the built-in Copilot prompt.
2. The prompt requires the standard plain-text structure and includes one complete, minimal example.
3. The user pastes Copilot or Gemini output into the Weekly Summary field and chooses **Save Summary**.
4. The dashboard validates the pasted source text before normalization, closing the dialog, or writing Firestore.
5. If valid, the dashboard stores the canonical structured text and confirms the save.
6. If invalid, the dialog stays open. The text is not changed and the previous Firestore value is not overwritten. An inline error panel identifies every repair needed.

PDF export repeats the same validation only as a defensive guard. A normal author will discover and resolve the problem at save time.

## Canonical input contract

The accepted format is plain text only. Blank lines are allowed for readability. The required headings and labels are case-insensitive, but their wording must otherwise match.

```text
WEEKLY MOVEMENT
Portfolio Summary: <one concise portfolio-level summary>

- Project: <exact active project name>
  Movement: <one or two concise sentences>
  Blocker: <one concise sentence, or None>
  Next step: <one concise sentence>

MANAGEMENT ASK
- Project: <exact active project name>
  Decision / Support needed: <one concise sentence>
  Business impact: <one concise sentence>
```

### Required conditions

- Exactly one `WEEKLY MOVEMENT` heading, followed by exactly one non-empty `Portfolio Summary:`.
- At least one movement project. Each project must contain, in order: `Project:`, `Movement:`, `Blocker:`, and `Next step:`.
- Exactly one `MANAGEMENT ASK` heading after all movement entries.
- Every project name must exactly match an active project in the selected reporting week. This makes the result deterministic for Overview and PDF project association.
- Management Ask may contain zero to four entries. Each entry contains, in order: `Project:`, `Decision / Support needed:`, and `Business impact:`.
- When there is no management request, the entire Management Ask body must be exactly `No immediate management decision required this week.`
- Markdown headings, bold text, tables, code fences, and unlabelled prose are rejected rather than silently converted.
- Required values must be non-empty. `None` is allowed only for `Blocker`.

The validator does not require four to six movement projects: that is prompt guidance, not a reason to prevent a short but truthful weekly report from being saved.

## Prompt changes

The generated Copilot prompt remains plain-text-only and adds a clearly separated **Required output example** immediately after the format rules. The example uses neutral placeholder project names and includes both one movement item and one management ask.

It also states: `Your response will be rejected by the dashboard unless it follows this format exactly. Do not add an introduction, closing note, Markdown heading, table, or explanatory text.`

The prompt must not instruct users to manually maintain another prompt or call a new AI service.

## Validation and storage architecture

Create one pure client-side `parseWeeklySummaryForSave(source, activeProjects)` function that:

1. Normalizes line endings only.
2. Parses the canonical labels into a structured result and an ordered error list.
3. Resolves each project name against active projects.
4. Returns either canonical text plus parsed data, or source-located validation errors.

`saveWeekSummary` invokes this parser before closing the overlay or starting the loader. On success it stores the canonical source in the existing `week.summary` field. No Firestore schema migration is required.

The existing permissive paste/blur cleaner must not rewrite an invalid response before validation. It may be removed or reduced to harmless line-ending normalization so the user can see exactly what must be fixed.

The PDF service parser uses the same canonical grammar and treats an invalid stored value as a report error. This is a protective consistency check for pre-existing or externally written data; it is not the primary authoring experience.

## Error experience

The Weekly Summary field gains an inline validation panel beneath the textarea.

- It appears after an unsuccessful Save attempt and receives focus for assistive technology.
- It begins with `Summary was not saved. Fix the following items:`.
- Each error cites the affected line or entry and the exact expected label, for example:
  - `Line 7: expected "Next step:" after "Blocker:" for project "PMS".`
  - `Line 12: "Master controller" is not an active project name. Use "Master Controller".`
  - `MANAGEMENT ASK: add a request entry or the exact no-decision sentence.`
- Invalid save leaves the overlay open, makes no Firestore write, and does not display a success toast.
- A subsequent valid Save clears the panel, stores the summary, and retains the current success toast.

## Testing and acceptance criteria

Automated tests cover:

- The prompt includes the exact canonical labels, rejection notice, and a complete example.
- A valid movement-only summary with the exact no-decision sentence saves successfully.
- A valid summary with management asks saves successfully.
- Missing heading, portfolio summary, required movement field, management-ask field, or invalid field order blocks save.
- Empty required values, duplicate headings, Markdown/table/code-fence input, unlabelled prose, unknown project names, and more than four management asks block save with specific errors.
- Invalid input does not call the Firestore write function and does not mutate the textarea source.
- Valid input is stored in canonical form and produces the structured PDF presentation.
- The PDF service rejects an invalid persisted summary with a clear report error rather than silently producing an empty Executive Summary.

## Out of scope

- Calling Copilot, Gemini, or any other AI API from the dashboard.
- Automatic repair or AI rewriting of an invalid summary.
- Migrating historical summaries to the canonical format.
- Changing the Overview PDF visual design.
