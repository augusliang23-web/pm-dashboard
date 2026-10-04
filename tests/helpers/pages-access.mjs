// Production Pages keeps its role helpers inline in index.html (there is no js/dashboard-access.mjs on this branch).
// Tests that need them get the real function from the page source instead of a second implementation.
import vm from 'node:vm';
import { normalizePermissionRole } from '../../js/permission-registry.mjs';
import { dashboardSource } from './dashboard-source.mjs';

const source = dashboardSource('production');
const start = source.indexOf('function canReadDraftWeeks(');
const end = source.indexOf('\n}\n', start);
if (start < 0 || end < 0) throw new Error('index.html must define canReadDraftWeeks');
const context = vm.createContext({});
vm.runInContext(`${source.slice(start, end + 3)}\nthis.canReadDraftWeeks = canReadDraftWeeks;`, context);

export const canReadDraftWeeks = context.canReadDraftWeeks;
// Same normalization the registry applies to raw dashboard roles (trim + lowercase, known roles only).
export const normalizeDashboardRole = normalizePermissionRole;
