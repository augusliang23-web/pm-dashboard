import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const dashboard = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function sourceBetween(startText, endText) {
  const start = dashboard.indexOf(startText);
  const end = dashboard.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `missing dashboard section: ${startText}`);
  return dashboard.slice(start, end);
}

test('production prototype fallback uses only anonymous demo identities', () => {
  const publicDemoSource = [
    sourceBetween('function demoTeamMembers(', '/* resource-budget-status:start */'),
    sourceBetween('function buildPrototypeWeeks()', 'async function refreshFxRates('),
  ].join('\n');
  const formerEmployeeNames = [
    'Augus',
    'Bonnie',
    'Josiah',
    'Huichong',
    'Mia Chen',
    'Ryan Tan',
    'Grace Lin',
    'Ethan Wu',
  ];
  for (const name of formerEmployeeNames) {
    assert.ok(!publicDemoSource.includes(name), `public demo source contains former employee name: ${name}`);
  }

  const context = vm.createContext({});
  vm.runInContext(sourceBetween('function stableHash(', '/* resource-budget-status:start */'), context);
  vm.runInContext(sourceBetween('function buildPrototypeWeeks()', 'async function refreshFxRates('), context);

  const expectedPeople = [
    'Demo PM A',
    'Demo PM B',
    'Demo PM C',
    'Demo Member D',
    'Demo Member E',
    'Demo Member F',
    'Demo Member G',
    'Demo Member H',
  ];
  const generatedPeople = new Set();
  for (let index = 0; index < 256; index += 1) {
    for (const member of context.demoTeamMembers({ code: `DEMO-${index}` }, index)) {
      generatedPeople.add(member.name);
    }
  }
  assert.deepEqual([...generatedPeople].sort(), [...expectedPeople].sort());

  const projects = context.buildPrototypeWeeks()[0].projects;
  const prototypePeople = projects.flatMap(project => [
    project.owner,
    project.deputy,
    ...project.teamMembers.map(member => member.name),
  ]);
  assert.ok(prototypePeople.length > 0);
  assert.ok(prototypePeople.every(name => expectedPeople.includes(name)));
  const ownerPairs = JSON.parse(JSON.stringify(
    projects.map(project => [project.owner, project.deputy]),
  ));
  assert.deepEqual(
    ownerPairs,
    [
      ['Demo PM A', 'Demo PM B'],
      ['Demo PM B', 'Demo PM C'],
      ['Demo PM C', 'Demo PM A'],
    ],
  );
});
