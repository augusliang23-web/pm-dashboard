// Pure, read-only planner. Inputs must be trusted Admin SDK metadata + explicit Owner-reviewed mappings.
// No Firebase initialization, account creation, role creation, network or write capability.
export function planIdentityMigration({authUsers,dashboardUsers,approvedMappings}){
 if(![authUsers,dashboardUsers,approvedMappings].every(Array.isArray))throw Error('Complete trusted inventories and approved mappings are required.');
 const emailKey=v=>typeof v==='string'?v.trim().toLowerCase():'';
 const unique=(items,key,label)=>{const m=new Map();for(const x of items){const k=key(x);if(!k||m.has(k))throw Error(label+' collision or missing identity.');m.set(k,x);}return m;};
 const uidKey=v=>typeof v==='string'&&v.length<=128?v:'';
 const authByUid=unique(authUsers,u=>uidKey(u.uid),'Auth UID');unique(authUsers,u=>emailKey(u.email),'Auth email');
 const dashboard=unique(dashboardUsers,u=>emailKey(u.email),'Dashboard email');
 const mappings=unique(approvedMappings,u=>emailKey(u.email),'Approved email');unique(approvedMappings,u=>uidKey(u.uid),'Approved UID');unique(approvedMappings.filter(u=>u.googleSubject),u=>uidKey(u.googleSubject),'Approved Google subject');
 const roles=new Set(['admin','pm','vip','executive','engineering','business','sales','bd','product']);
 if(dashboard.size!==mappings.size)throw Error('Every retained dashboard identity needs exactly one reviewed mapping before cutover.');
 return [...mappings].map(([email,mapping])=>{
  const stored=dashboard.get(email),auth=authByUid.get(mapping.uid);
  if(!stored||!auth||emailKey(auth.email)!==email||auth.disabled===true||!roles.has(emailKey(stored.data?.role)))throw Error('Approved mapping does not match an active trusted identity and role.');
  if(stored.email!==email)throw Error('Noncanonical dashboard email must be reviewed before migration.');
  if(stored.data.authUid&&stored.data.authUid!==mapping.uid)throw Error('Existing UID binding cannot be reassigned automatically.');
  const patch={authUid:mapping.uid};
  if(mapping.googleSubject){
   if(emailKey(stored.data.role)!=='admin')throw Error('Only Admin may receive Google subject approval.');
   const provider=auth.providerData?.find(p=>p.providerId==='google.com');
   if(auth.emailVerified!==true||provider?.uid!==mapping.googleSubject||emailKey(provider.email)!==email)throw Error('Approved Google provider does not match trusted Auth metadata.');
   if(stored.data.googleSubject&&stored.data.googleSubject!==mapping.googleSubject)throw Error('Existing Google binding cannot be reassigned automatically.');
   patch.googleSubject=mapping.googleSubject;
  }
  return {email,patch};
 });
}
