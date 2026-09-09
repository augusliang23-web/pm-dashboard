import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const dashboard = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');

test('canonical Production dashboard routes every business write through protected Callables', () => {
  assert.match(dashboard, /createProjectDashboardApi\(\{ functions, httpsCallable \}\)/);
  for (const operation of [
    'saveProject',
    'deleteProject',
    'setAttention',
    'saveWeekFields',
    'createWeek',
    'setWeekRelease',
    'saveGanttTemplateSettings',
  ]) {
    assert.match(dashboard, new RegExp(`projectDashboardApi\\.${operation}\\(`), operation);
  }

  assert.doesNotMatch(dashboard, /(?:setDoc|updateDoc)\(doc\(db,\s*["']weeks["']/);
  assert.doesNotMatch(dashboard, /runTransaction\(db,[\s\S]{0,1800}?(?:collection|doc)\(db,\s*["']weeks["']/);
  assert.doesNotMatch(dashboard, /runTransaction\(db,[\s\S]{0,1800}?dashboardSettings["'],\s*["']team-2-portfolio/);
});

test('Firestore denies direct client writes to business collections', () => {
  assert.match(rules, /match \/weeks\/\{weekId\}[\s\S]*?allow write:\s*if false;/);
  assert.match(rules, /match \/dashboardSettings\/\{settingId\}[\s\S]*?allow write:\s*if false;/);
});

test('legacy Production team-2 entrypoint is retired', async () => {
  await assert.rejects(
    access(new URL('../team-2/index.html', import.meta.url)),
    error => error?.code === 'ENOENT',
  );
});

test('technical presence writes bind every document to the authenticated identity', () => {
  assert.match(dashboard, /function buildInitialPresencePayload\(\{/);
  assert.match(dashboard, /ownerUid:\s*currentUser\.uid/);
  assert.match(dashboard, /userKey:\s*getEmailKey\(currentUser\)/);
  assert.doesNotMatch(dashboard, /setDoc\(doc\(db, "presence", getEmailKey\(currentUser\)\)/);
});
