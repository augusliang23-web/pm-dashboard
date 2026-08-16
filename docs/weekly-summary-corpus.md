# Weekly Summary corpus

The corpus is a repeatable contract check for pasted AI output. It runs each
case through the browser save normalizer, checks the expected accept/reject
diagnostic, and sends accepted canonical text through the PDF summary parser.

Run it with:

```sh
node --test tests/weekly-summary-corpus.test.mjs
```

The registry currently contains 11 cases: six accepted and five rejected. It
includes one observed Gemini response (`observed-gemini-draft-and-released`),
plus synthetic formatting, multi-project, long-field, and rejection cases.

Each case records:

- `id`: stable lowercase case identifier.
- `source`: the exact text pasted into the editor.
- `sourceType`: `gemini`, `copilot`, or `synthetic`.
- `observed`: `true` only for a response captured from a real generator.
- `context`: current and historical project names used by validation.
- `expected`: `accept` or `reject`, with `expectedError` for rejected cases.

To add a real Copilot or Gemini sample, paste the output verbatim into the
registry, set `sourceType` and `observed: true`, and provide the project names
that existed when it was generated. Do not silently rewrite the fixture: the
purpose is to measure the same paste path users experience. If the sample
contains confidential names, replace them with the existing test-project names
while recording that it is an anonymized sample.

The corpus can provide 100% coverage of the cases defined here; it cannot
promise that arbitrary future AI output will always be accepted. Generator
coverage should therefore be tracked by adding observed samples from each
source and by retaining synthetic edge cases for known structural risks.
