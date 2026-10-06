import { readFileSync } from 'node:fs';

// production-pages is a Production-only, single-profile surface: index.html is the source a browser runs.
// Tests written for the profiled main source ask for a profile; only 'production' exists here by design.
export const PROFILES = ['production'];

export function dashboardSource(profile = 'production') {
  if (profile !== 'production') throw new Error(`production-pages has no ${profile} profile`);
  return readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
}
