import assert from 'node:assert/strict';
const changes=[
 ['accounts: snap.docs.map(entry => ({ id: entry.id, ...entry.data() }))','accounts: snap.docs.map(entry => ({ ...entry.data(), id: entry.id }))'],
 ['const accounts = snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }));','const accounts = snapshot.docs.map(entry => ({ ...entry.data(), id: entry.id }));']
];
export function normalizeS02bForBaseline(source){for(const [before,after] of changes){assert.equal(source.split(after).length-1,1,'S02B exact identity hunk must match once');source=source.replace(after,()=>before)}return source;}
export {changes};
