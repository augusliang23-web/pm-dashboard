import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRules = () =>
  readFile(new URL("../firestore.rules", import.meta.url), "utf8").catch(
    () => "",
  );

const readSharedBackendRules = () =>
  readFile(new URL("../firestore.shared-backend.rules", import.meta.url), "utf8").catch(
    () => "",
  );

const readDashboard = () =>
  readFile(new URL("../index.html", import.meta.url), "utf8").catch(() => "");

test("presence sessions allow owner writes and admin reads", async () => {
  const rules = await readRules();

  assert.match(rules, /match\s+\/presenceSessions\/\{sessionId\}/);
  assert.match(rules, /request\.resource\.data\.ownerUid\s*==\s*request\.auth\.uid/);
  assert.match(rules, /resource\.data\.ownerUid\s*==\s*request\.auth\.uid/);
  assert.match(rules, /allow read:\s*if isAdmin\(\)/);
  assert.match(rules, /allow delete:\s*if false/);
});

test("daily rollups are admin-readable and client read-only", async () => {
  const rules = await readRules();

  assert.match(rules, /match\s+\/presenceDailyRollups\/\{rollupId\}/);
  assert.match(rules, /allow read:\s*if isAdmin\(\)/);
  assert.match(rules, /allow write:\s*if false/);
});

test("firebase config maps the Firestore rules source", async () => {
  const config = JSON.parse(
    await readFile(new URL("../firebase.json", import.meta.url), "utf8"),
  );

  assert.equal(config.firestore?.rules, "firestore.rules");
});

test("firebase config includes Executive history query indexes", async () => {
  const config = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));
  const indexes = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));

  assert.equal(config.firestore?.indexes, "firestore.indexes.json");
  const updates = indexes.indexes.find(index => index.collectionGroup === "executiveMilestoneUpdates");
  assert.deepEqual(updates.fields, [
    { fieldPath: "weekId", order: "ASCENDING" },
    { fieldPath: "itemId", order: "ASCENDING" },
    { fieldPath: "sectionId", order: "ASCENDING" },
    { fieldPath: "createdAt", order: "DESCENDING" },
  ]);
});

test("clients cannot change an existing Executive timeline or dashboard week directly", async () => {
  const rules = await readRules();
  const weeksStart = rules.indexOf('match /weeks/{weekId}');
  const weeksEnd = rules.indexOf('\n    match /', weeksStart + 1);
  const weeksRules = rules.slice(weeksStart, weeksEnd);

  assert.match(rules, /function\s+executiveTimelineUnchanged\(\)/);
  assert.match(rules, /request\.resource\.data\.get\('strategyLayer'/);
  assert.match(rules, /resource\.data\.get\('strategyLayer'/);
  assert.notEqual(weeksStart, -1);
  assert.match(weeksRules, /allow write:\s*if false/);
  assert.match(weeksRules, /allow delete:\s*if false/);
  assert.doesNotMatch(weeksRules, /allow create:\s*if isAdmin\(\)/);
  assert.doesNotMatch(rules, /allow read, create:\s*if isSignedIn\(\)/);
});

test("live Executive milestone state is dashboard-user readable and client write protected", async () => {
  const rules = await readRules();

  assert.match(rules, /match\s+\/executiveMilestoneState\/\{stateId\}[\s\S]*?allow read:\s*if hasDashboardAccess\(\);[\s\S]*?allow write:\s*if false/);
});

test("Executive append-only collections are role-readable and client read-only", async () => {
  const rules = await readRules();

  assert.match(rules, /function\s+dashboardRole\(\)/);
  assert.match(rules, /function\s+isExecutive\(\)/);
  assert.match(rules, /function\s+canViewExecutiveSection\(sectionId\)/);
  for (const collection of [
    "executiveMilestoneUpdates",
    "executiveMilestoneChangeRequests",
    "executiveMilestoneAudit",
  ]) {
    assert.match(rules, new RegExp(`match\\s+/${collection}`));
  }
  assert.match(rules, /match\s+\/executiveMilestoneUpdates[\s\S]*?allow write:\s*if false/);
  assert.match(rules, /match\s+\/executiveMilestoneChangeRequests[\s\S]*?allow write:\s*if false/);
  assert.match(rules, /match\s+\/executiveMilestoneAudit[\s\S]*?allow write:\s*if false/);
});

test("Executive configuration is dashboard-user-readable but callable-write-only", async () => {
  const rules = await readRules();

  assert.match(rules, /match\s+\/executiveMilestoneConfig\/\{configId\}/);
  assert.match(rules, /allow read:\s*if hasDashboardAccess\(\);\s*allow write:\s*if false;/);
  assert.doesNotMatch(rules, /sectionId == 'ioe-product-portfolio'/);
});

test('Firestore draft week reads are limited to PM and Admin while released reads remain available to dashboard users', async () => {
  const rules = await readRules();
  assert.match(rules, /function canReadDraftWeeks\(\)/);
  assert.match(rules, /dashboardRole\(\) in \['admin', 'pm'\]/);
  assert.match(rules, /allow read:\s*if hasDashboardAccess\(\)\s*&& \(canReadDraftWeeks\(\) \|\| resource\.data\.isReleased == true\)/);
  assert.match(rules, /allow write: if false;/);
});

test('shared backend rules cannot restore direct client week writes', async () => {
  const rules = await readSharedBackendRules();
  const config = JSON.parse(
    await readFile(new URL("../firebase.shared-backend.json", import.meta.url), "utf8"),
  );

  assert.equal(config.firestore?.rules, "firestore.shared-backend.rules");
  assert.match(rules, /match\s+\/weeks\/\{weekId\}[\s\S]*?allow write:\s*if false/);
  assert.doesNotMatch(rules, /match\s+\/weeks\/\{weekId\}[\s\S]*?allow read, write:\s*if isSignedIn\(\)/);
  assert.match(rules, /match\s+\/executiveMilestoneState\/\{stateId\}[\s\S]*?allow read:\s*if hasDashboardAccess\(\);[\s\S]*?allow write:\s*if false/);
  assert.match(rules, /match\s+\/executiveMilestoneConfig\/\{configId\}[\s\S]*?allow read:\s*if hasDashboardAccess\(\);[\s\S]*?allow write:\s*if false/);
  assert.match(rules, /match\s+\/executiveMilestoneUpdates[\s\S]*?allow write:\s*if false/);
  assert.match(rules, /match\s+\/executiveMilestoneChangeRequests[\s\S]*?allow write:\s*if false/);
  assert.match(rules, /match\s+\/executiveMilestoneAudit[\s\S]*?allow write:\s*if false/);
});

test('both rulesets protect the legacy Gantt settings path without renaming it', async () => {
  for (const rules of [await readRules(), await readSharedBackendRules()]) {
    assert.match(rules, /match\s+\/dashboardSettings\/team-2-portfolio\s*\{/);
    assert.match(rules, /allow read:\s*if hasDashboardAccess\(\);/);
    assert.match(rules, /allow create:\s*if isAdmin\(\)\s*&&\s*hasValidGanttTemplateCreate\(\);/);
    assert.match(rules, /allow update:\s*if isAdmin\(\)\s*&&\s*hasValidGanttTemplateUpdate\(\);/);
    assert.match(rules, /allow delete:\s*if false;/);
    assert.doesNotMatch(rules, /match\s+\/dashboardSettings\/gantt-templates/);
  }
});

test('root dashboard creates one complete presence document and preserves identity on later updates', async () => {
  const dashboard = await readDashboard();
  const initializationStart = dashboard.indexOf('function buildInitialPresencePayload({');
  const initializationEnd = dashboard.indexOf('\nconst handleUserActivity', initializationStart);
  const initialization = dashboard.slice(initializationStart, initializationEnd);
  const presenceUpdates = dashboard.match(
    /updateDoc\(doc\(db, "presence", getEmailKey\(currentUser\)\), \{[\s\S]{0,240}?\}\)/g,
  ) || [];

  assert.ok(initializationStart >= 0 && initializationEnd > initializationStart);
  assert.match(initialization, /usageBuckets:\s*\{\}/);
  assert.match(initialization, /await runTransaction\(db, async transaction =>/);
  assert.match(initialization, /const existing = await transaction\.get\(presenceRef\)/);
  assert.match(initialization, /if \(existing\.exists\(\)\) return/);
  assert.match(initialization, /transaction\.set\(presenceRef, buildInitialPresencePayload/);
  assert.equal(presenceUpdates.length, 5);
  for (const write of presenceUpdates) {
    assert.match(write, /ownerUid:\s*currentUser\.uid/);
    assert.match(write, /userKey:\s*getEmailKey\(currentUser\)/);
  }
  assert.doesNotMatch(dashboard, /setDoc\(doc\(db, "presence", getEmailKey\(currentUser\)\)/);
});
