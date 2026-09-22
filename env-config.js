// Environment configuration read by index.html before anything else runs.
// Generated from env/prod.json by scripts/env-config.mjs; do not edit by hand.
// The committed default is the PRODUCTION profile, so a plain checkout (GitHub Pages, local serving) can only
// ever behave as Production. The Hosting build writes dist/env-config.js for the target environment, and
// index.html refuses to start when this file is missing or names an unknown profile.
window.PM_DASHBOARD_ENV = Object.freeze({
  dashboardProfile: "production",
  environment: "prod",
  release: "v2.1",
  baseCommit: "6d9f7bd",
  firebaseConfig: Object.freeze({
    apiKey: "AIzaSyBke6_lXZwcS1UCGYpS15hLgfSbC6xGEFI",
    authDomain: "project-manager-dashboar-a067f.firebaseapp.com",
    projectId: "project-manager-dashboar-a067f",
    storageBucket: "project-manager-dashboar-a067f.firebasestorage.app",
    messagingSenderId: "842441149281",
    appId: "1:842441149281:web:ef2a9af8b37593451e1320",
    measurementId: "G-TW9FW819EY"
  })
});
