import { dashboardSource, dashboardSourceAsync } from './helpers/dashboard-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await dashboardSourceAsync('uat');

test('root dashboard requests the structured Weekly Summary contract', () => {
  assert.match(source, /Portfolio Summary:/);
  assert.match(source, /- Project: <exact project name>/);
  assert.match(source, /Movement: <one or two concise sentences>/);
  assert.match(source, /Blocker: <one concise sentence, or None>/);
  assert.match(source, /Next step: <one concise sentence>/);
  assert.match(source, /Decision \/ Support needed: <one concise sentence>/);
  assert.match(source, /Business impact: <one concise sentence>/);
  assert.match(source, /one project movement entry per meaningful movement supplied/i);
  assert.match(source, /Up to four management asks/);
  assert.match(source, /CURRENT ACTIVE PROJECTS/);
  assert.match(source, /REMOVED SINCE LAST WEEK/);
  assert.match(source, /removed.*movement.*not.*management/i);
  assert.match(source, /Required output example/);
  assert.match(source, /Your response will be rejected by the dashboard unless it follows this format exactly/);
  assert.match(source, /No immediate management decision required this week\./);
});

test('the prompt remains plain text and prohibits invented facts and tables', () => {
  assert.match(source, /Return plain text only/);
  assert.match(source, /Do not invent facts/);
  assert.match(source, /Do not use Markdown heading symbols, bold text, tables, or code fences/);
});
