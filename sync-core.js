export function cleanFirestoreData(value) {
  if (Array.isArray(value)) {
    return value.map(cleanFirestoreData).filter(item => item !== undefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, item]) => key && item !== undefined)
        .map(([key, item]) => [key, cleanFirestoreData(item)])
        .filter(([, item]) => item !== undefined)
    );
  }
  return value === undefined ? undefined : value;
}

function withWriteTimeout(operation, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(
        new Error('Firestore did not confirm the write in time.'),
        { code: 'write-timeout' }
      ));
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve().then(operation), timeout])
    .finally(() => clearTimeout(timer));
}

export async function confirmWeekMutation(
  source,
  changes,
  write,
  { timeoutMs = 15000 } = {}
) {
  const candidate = cleanFirestoreData({ ...source, ...changes });
  await withWriteTimeout(() => write(candidate), timeoutMs);
  if (source?.__documentId) {
    Object.defineProperty(candidate, '__documentId', {
      value: source.__documentId,
      enumerable: false
    });
  }
  return candidate;
}

export function getWriteErrorMessage(error) {
  const code = String(error?.code || '');
  if (code.includes('permission-denied')) {
    return 'Save blocked by Firestore permissions. Ask the Firebase administrator to allow admin updates to released weeks.';
  }
  if (code === 'write-timeout') {
    return 'Save was not confirmed. Check the connection and try again.';
  }
  return 'Save failed. Your previous data was kept; please try again.';
}
