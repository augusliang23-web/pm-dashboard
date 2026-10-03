// Product contract fixtures shared by browser/Functions parity and real rules emulator tests.
// Expected roles are literal; never derived from the resolver under test.
const roles = ['admin', 'pm', 'engineering', 'business', 'sales', 'bd', 'product', 'vip', 'executive'];
export const ROLE_CASES = roles.flatMap(role => [
  { raw: role, expected: role },
  { raw: role.toUpperCase(), expected: role },
  { raw: role[0].toUpperCase() + role.slice(1), expected: role },
  { raw: ` \t${role.toUpperCase()}\n `, expected: role },
]).concat([undefined, null, '', '   ', 'unknown', 1, true, {}, ['vip'], ['pm'], ['admin']]
  .map(raw => ({ raw, expected: '' })));
