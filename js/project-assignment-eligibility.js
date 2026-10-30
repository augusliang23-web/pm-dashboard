// Eligibility is based on directory document identities, never on client-supplied roles.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PMProjectAssignment=api;})(globalThis,function(){
  const emailKey=value=>typeof value==='string'?value.trim().toLowerCase():'';
  const roleKey=value=>typeof value==='string'?value.trim().toLowerCase():'';
  function canAssignProjectAccount(actor,email,user){
    const target=emailKey(email);
    if(roleKey(actor?.role)!=='admin'||!target||!emailKey(actor?.email)||!user||user.active===false||user.disabled===true)return false;
    if(('active' in user && typeof user.active!=='boolean')||('disabled' in user && typeof user.disabled!=='boolean'))return false;
    const role=roleKey(user.role);
    return role==='pm'||(role==='admin'&&target===emailKey(actor.email));
  }
  function resolveProjectAccount(documents,email){
    const target=emailKey(email),matches=documents.filter(doc=>emailKey(doc.id)===target);
    if(!target||matches.length!==1)return null;
    const user=matches[0].data;
    if(!user||typeof user!=='object'||Array.isArray(user))return null;
    if(Object.hasOwn(user,'email')&&(!emailKey(user.email)||emailKey(user.email)!==target))return null;
    return user;
  }
  function projectAssignmentOptions(accounts,actor){
    const docs=accounts.map(user=>({id:user.id,data:user}));
    const identities=[...new Set(docs.map(doc=>emailKey(doc.id)).filter(Boolean))];
    return identities.map(email=>({email,user:resolveProjectAccount(docs,email)}))
      .filter(({email,user})=>canAssignProjectAccount(actor,email,user))
      .map(({email,user})=>({email,name:typeof user.displayName==='string'&&user.displayName.trim()?user.displayName.trim():email}));
  }
  return Object.freeze({canAssignProjectAccount,resolveProjectAccount,projectAssignmentOptions});
});
