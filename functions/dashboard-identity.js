// Identical in browser, Functions and PDF. Trusted user records are provisioned server-side only.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PMDashboardIdentity=api;
})(globalThis,function(){
  const emailKey=value=>typeof value==='string'?value.trim().toLowerCase():'';
  const roles=new Set(['admin','pm','vip','executive','engineering','business','sales','bd','product']);
  function dashboardIdentityError(identity,user){
    const uid=identity?.uid,email=emailKey(identity?.email),claims=identity?.claims;
    if(typeof uid!=='string'||!uid||!email||typeof user?.authUid!=='string'||!user.authUid)return 'identity-binding-required';
    if(user.authUid!==uid)return 'identity-binding-mismatch';
    if(emailKey(claims?.email)!==email)return 'identity-email-mismatch';
    if(user.active===false)return 'identity-disabled';
    if(!roles.has(emailKey(user.role)))return 'identity-role-forbidden';
    const provider=claims?.firebase?.sign_in_provider;
    if(provider==='password')return '';
    if(provider!=='google.com')return 'identity-provider-forbidden';
    if(emailKey(user.role)!=='admin')return 'identity-google-admin-only';
    if(claims.email_verified!==true)return 'identity-google-unverified';
    const subjects=claims.firebase.identities?.['google.com'];
    if(typeof user.googleSubject!=='string'||!user.googleSubject||!Array.isArray(subjects)||subjects.length!==1||subjects[0]!==user.googleSubject)return 'identity-google-unapproved';
    return '';
  }
  return Object.freeze({dashboardIdentityError});
});
