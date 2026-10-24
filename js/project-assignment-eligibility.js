// Shared browser/Functions eligibility; permissions still come from trusted actor/user records.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PMProjectAssignment=api;})(globalThis,function(){
  const emailKey=value=>typeof value==='string'?value.trim().toLowerCase():'';
  const roleKey=value=>typeof value==='string'?value.trim().toLowerCase():'';
  function canAssignProjectAccount(actor,email,user){
    const target=emailKey(email);
    if(roleKey(actor?.role)!=='admin'||!target||!emailKey(actor?.email)||!user||user.active===false||user.disabled===true)return false;
    const role=roleKey(user.role);
    return role==='pm'||(role==='admin'&&target===emailKey(actor.email));
  }
  function projectAssignmentOptions(accounts,actor){
    const unique=new Map();
    for(const user of accounts){
      const email=emailKey(user.id||user.email);if(!email)continue;
      const previous=unique.get(email);
      if(unique.has(email)){
        if(!previous||roleKey(previous.role)!==roleKey(user.role)||previous.active!==user.active||previous.disabled!==user.disabled)unique.set(email,null);
      }else unique.set(email,user);
    }
    return [...unique].filter(([email,user])=>canAssignProjectAccount(actor,email,user)).map(([email,user])=>({email,name:typeof user.displayName==='string'&&user.displayName.trim()?user.displayName.trim():email}));
  }
  return Object.freeze({canAssignProjectAccount,projectAssignmentOptions});
});
