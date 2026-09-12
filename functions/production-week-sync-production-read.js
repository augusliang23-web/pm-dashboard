const { applicationDefault, getApp, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const core = require('./production-week-sync-core');

const PRODUCTION_APP_NAME = 'production-week-sync-read-only';

function createProductionReadStore(productionDb) {
  return Object.freeze({
    async listWeeks() {
      const snapshot = await productionDb.collection('weeks').get();
      const weeks = snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
      const readTime = snapshot.readTime?.toDate?.();
      if (readTime instanceof Date && !Number.isNaN(readTime.getTime())) {
        Object.defineProperty(weeks, 'sourceReadTime', { value: readTime.toISOString() });
      }
      return weeks;
    },
  });
}

function getProductionFirestore() {
  let app;
  try {
    app = getApp(PRODUCTION_APP_NAME);
  } catch (_notInitialized) {
    app = initializeApp({ credential: applicationDefault(), projectId: core.PRODUCTION_PROJECT_ID }, PRODUCTION_APP_NAME);
  }
  return getFirestore(app);
}

module.exports = { createProductionReadStore, getProductionFirestore };
