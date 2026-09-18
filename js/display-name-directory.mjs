const MAX_DISPLAY_NAME_LENGTH = 128;

function emailKey(value) {
  return String(value || '').trim().toLowerCase();
}

function validDisplayName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_DISPLAY_NAME_LENGTH && !/[\u0000-\u001f\u007f]/.test(name)
    ? name
    : '';
}

function genericDisplayName(email) {
  const first = emailKey(email).split('@')[0].split('.')[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function createDisplayNameDirectory() {
  let names = new Map();

  function set(email, account = {}) {
    const key = emailKey(email);
    if (!key) return;
    const name = validDisplayName(account.displayName);
    if (name) names.set(key, name);
    else names.delete(key);
  }

  return {
    set,
    replace(accounts = []) {
      names = new Map();
      for (const account of accounts) {
        set(account.id || account.email, account);
      }
    },
    resolve(email) {
      if (!email || email === 'System') return 'System';
      return names.get(emailKey(email)) || genericDisplayName(email);
    },
    clear() {
      names.clear();
    },
  };
}
