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
