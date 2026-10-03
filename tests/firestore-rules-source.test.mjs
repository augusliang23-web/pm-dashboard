import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRules = () =>
  readFile(new URL("../firestore.rules", import.meta.url), "utf8").catch(
    () => "",
  );

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

test("userPermissions overrides are self/Admin readable and never client-writable", async () => {
  const rules = await readRules();
  const block = rules.match(/match\s+\/userPermissions\/\{email\}\s*\{([\s\S]*?)\n    \}/)?.[1] || '';

  assert.match(block, /allow read:\s*if hasDashboardAccess\(\)\s*&& \(request\.auth\.token\.email == email \|\| isAdmin\(\)\);/);
  assert.match(block, /allow write:\s*if false;/);
  assert.doesNotMatch(block, /allow (create|update|delete)/);
});

test("userPermissionAudit is Admin-readable and never client-writable", async () => {
  const rules = await readRules();
  const block = rules.match(/match\s+\/userPermissionAudit\/\{auditId\}\s*\{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(block, /allow read:\s*if isAdmin\(\);/);
  assert.match(block, /allow write:\s*if false;/);
  assert.doesNotMatch(block, /allow (create|update|delete)|request\.auth\.token\.email/);
});

test("Production, UAT and shared-backend rules share one recognized-role normalization contract", async () => {
  const { CAPABILITIES } = await import("../js/permission-registry.mjs");
  const { ROLE_CASES } = await import("./helpers/dashboard-role-cases.mjs");
  const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const rulesets = {
    production: await read("firestore.rules"),
    uat: await read("firestore.uat.rules"),
    shared: await read("firestore.shared-backend.rules"),
  };
  const helperOf = rules => rules.match(/    function normalizeDashboardRole\(role\) \{\n[\s\S]*?\n    \}\n/)?.[0] || "";
  const helpers = Object.fromEntries(Object.entries(rulesets).map(([name, rules]) => [name, helperOf(rules)]));
  assert.ok(helpers.production, "Production rules must define normalizeDashboardRole");
  assert.equal(helpers.production, helpers.uat, "Production helper must match UAT byte-for-byte");
  assert.equal(helpers.production, helpers.shared, "Production helper must match shared-backend byte-for-byte");
  assert.match(helpers.production, /role is string \? role\.trim\(\)\.lower\(\) : ''/);

  const rulesRoles = JSON.parse(helpers.production.match(/value in (\[[^\]]*\])/)[1].replace(/'/g, '"')).sort();
  const registryRoles = [...CAPABILITIES["week.manage"].roleDefaults, ...CAPABILITIES["week.manage"].grantableRoles].sort();
  const browserRoles = [...new Set(ROLE_CASES.map(({ expected }) => expected).filter(Boolean))].sort();
  assert.deepEqual(rulesRoles, registryRoles, "rules and the permission registry recognize the same roles");
  assert.deepEqual(rulesRoles, browserRoles, "rules and the browser role contract recognize the same roles");

  // Authorization reads the normalized role everywhere.
  assert.match(rulesets.production, /function isAdmin\(\) \{\n      return normalizedDashboardRole\(\) == 'admin';\n    \}/);
  for (const rules of [rulesets.uat, rulesets.shared]) {
    assert.match(rules, /function isAdmin\(\) \{\n      return dashboardRole\(\) == 'admin';\n    \}/);
    assert.match(rules, /function dashboardRole\(\) \{[\s\S]*?normalizeDashboardRole\(get\(/);
  }
  assert.match(rulesets.production, /function normalizedDashboardRole\(\) \{[\s\S]*?normalizeDashboardRole\(get\([\s\S]*?\.data\.get\('role', ''\)\)/);
  // Production keeps the exact stored role only for the presenceSessions identity binding.
  assert.match(rulesets.production, /function dashboardRole\(\) \{[\s\S]*?\.data\.role\n        : '';\n    \}/);
  assert.equal(rulesets.production.split("dashboardRole()").length - 1, 2, "raw dashboardRole() is defined once and used once");
  assert.match(rulesets.production, /&& request\.resource\.data\.role == dashboardRole\(\)/);
  // Production week reads are unchanged by role normalization.
  assert.match(rulesets.production, /match \/weeks\/\{weekId\} \{\n      allow read: if hasDashboardAccess\(\);\n      allow write: if false;\n      allow delete: if false;\n    \}/);
});
