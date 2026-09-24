import { createRequire } from 'node:module';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const projectId = 'demo-pm-dashboard-v22t';
const password = 'TestOnly!12345';
const app = getApps().length ? getApps()[0] : initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);

async function seedAuth(email) {
  try {
    await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    await auth.createUser({ email, password, emailVerified: true });
  }
}

async function seedDocument(collection, id, data) {
  await db.collection(collection).doc(id).set(data, { merge: true });
}

const accounts = [
  { email: 'test.admin@pm-dashboard.local', displayName: 'Test', role: 'admin', isProjectManager: true },
  { email: 'test.pm@pm-dashboard.local', displayName: 'Test', role: 'pm', isProjectManager: true },
  { email: 'test.bd@pm-dashboard.local', displayName: 'Test BD', role: 'bd', isProjectManager: false },
];

const executiveTimelineConfig = {
  version: 1,
  sections: [
    { sectionId: 'ioe-product-portfolio', label: 'IoE Product Portfolio', viewRoles: ['admin', 'executive', 'pm', 'engineering', 'sales', 'bd', 'product'], updateRoles: ['admin', 'executive', 'pm', 'engineering'] },
    { sectionId: 'customer-engagements', label: 'Customer Engagements', viewRoles: ['admin', 'executive', 'sales', 'bd', 'product'], updateRoles: ['admin', 'executive', 'sales', 'bd', 'product'] },
    { sectionId: 'investors-strategy', label: 'Investors & Strategy', viewRoles: ['admin', 'executive', 'sales', 'bd', 'product'], updateRoles: ['admin', 'executive'] },
  ],
  quarters: [{ quarterId: 'q1', label: 'Q1' }, { quarterId: 'q2', label: 'Q2' }, { quarterId: 'q3', label: 'Q3' }, { quarterId: 'q4', label: 'Q4' }],
  sectionPolicies: {
    'ioe-product-portfolio': { viewRoles: ['admin', 'executive', 'pm', 'engineering', 'sales', 'bd', 'product'], updateRoles: ['admin', 'executive', 'pm', 'engineering'] },
    'customer-engagements': { viewRoles: ['admin', 'executive', 'sales', 'bd', 'product'], updateRoles: ['admin', 'executive', 'sales', 'bd', 'product'] },
    'investors-strategy': { viewRoles: ['admin', 'executive', 'sales', 'bd', 'product'], updateRoles: ['admin', 'executive'] },
  },
};

const liveExecutiveTimeline = {
  title: 'TEST / DO NOT DELETE · Executive milestone timeline',
  rows: [
    { sectionId: 'ioe-product-portfolio', label: 'IoE Product Portfolio', cells: { q1: [{ id: 'test-exec-product-q1', text: 'TEST / DO NOT DELETE · Product validation', rag: 'green', version: 1 }], q2: [], q3: [], q4: [] } },
    { sectionId: 'customer-engagements', label: 'Customer Engagements', cells: { q1: [{ id: 'test-exec-customer-q1', text: 'TEST / DO NOT DELETE · Customer engagement', rag: 'green', version: 1 }], q2: [], q3: [], q4: [] } },
    { sectionId: 'investors-strategy', label: 'Investors & Strategy', cells: { q1: [{ id: 'test-exec-strategy-q1', text: 'TEST / DO NOT DELETE · Strategy review', rag: 'yellow', version: 1 }], q2: [], q3: [], q4: [] } },
  ],
  phases: ['', '', '', ''],
  ragOverrides: {},
};

for (const account of accounts) {
  await seedAuth(account.email);
  await seedDocument('users', account.email, {
    displayName: account.displayName,
    role: account.role,
    isProjectManager: account.isProjectManager,
    label: 'TEST / DO NOT DELETE',
  });
}

await seedDocument('executiveMilestoneConfig', 'timeline', executiveTimelineConfig);
await seedDocument('executiveMilestoneState', 'live', {
  timeline: liveExecutiveTimeline,
  version: 1,
  initializedAt: new Date().toISOString(),
  initializedBy: 'test.admin@pm-dashboard.local',
  updatedAt: new Date().toISOString(),
  updatedBy: 'test.admin@pm-dashboard.local',
  label: 'TEST / DO NOT DELETE',
});

const testProject = {
  name: 'TEST / DO NOT DELETE · Draft project',
  code: 'TEST-DRAFT-001',
  owner: 'Test',
  deputy: '',
  level: 'system',
  status: 'green',
  progress: 25,
  milestones: [],
  visibility: 'active',
};

await seedDocument('weeks', 'W30-2026', {
  weekLabel: 'W30 2026',
  weekDate: 'Jul 20 - Jul 24',
  isReleased: false,
  lastModifiedBy: 'test.admin@pm-dashboard.local',
  projects: [testProject],
  summary: {},
  strategyLayer: { executiveMilestoneTimeline: liveExecutiveTimeline },
  label: 'TEST / DO NOT DELETE',
});

await seedDocument('weeks', 'W29-2026', {
  weekLabel: 'W29 2026',
  weekDate: 'Jul 13 - Jul 17',
  isReleased: true,
  lastModifiedBy: 'test.admin@pm-dashboard.local',
  projects: [{ ...testProject, code: 'TEST-RELEASED-001', name: 'TEST / DO NOT DELETE · Released project' }],
  summary: {},
  strategyLayer: {
    executiveMilestoneTimeline: liveExecutiveTimeline,
    executiveMilestoneTimelineSnapshot: {
      timeline: liveExecutiveTimeline,
      timelineVersion: 1,
      capturedAt: new Date().toISOString(),
      capturedBy: 'test.admin@pm-dashboard.local',
    }
  },
  label: 'TEST / DO NOT DELETE',
});

console.log(`Seeded ${accounts.length} local-only accounts. Password: ${password}`);
