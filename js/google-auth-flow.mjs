// Firebase performs OAuth/account linking. This controller only serializes intent and blocks stale auth commits.
export function createGoogleAuthFlow({auth,api,getSession,onState=()=>{}}){
 let active=null,sequence=0;
 const emit=(busy,operation,error='',message='')=>onState({busy,operation,error,message});
 const same=stamp=>auth.currentUser?.uid===stamp.uid&&getSession().generation===stamp.generation;
 api.beforeAuthStateChanged(auth,async user=>{if(user&&active?.cancelled)throw Error('Sign-in was cancelled. Please try again.');});
 function cancel(){if(active){active.cancelled=true;emit(true,active.kind,'','Cancelling sign-in…');}}
 async function run(kind,operation){
  if(active)return null;
  const attempt={id:++sequence,kind,cancelled:false};active=attempt;emit(true,kind);
  try{const result=await operation(attempt);if(attempt.cancelled)return null;emit(false,kind,'',result?.message||'');return result;}
  catch(error){if(attempt.cancelled&&!error.recoveryRequired)return null;emit(false,kind,error.message||'Authentication failed.');throw error;}
  finally{if(active===attempt){active=null;if(attempt.cancelled)emit(false,kind);}}
 }
 const provider=email=>{const p=new api.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account',...(email?{login_hint:email}:{})});return p;};
 return {
  cancel,
  get operation(){return active?.kind||'';},
  google:()=>run('google',()=>api.signInWithPopup(auth,provider())),
  password:(email,password)=>run('password',()=>api.signInWithEmailAndPassword(auth,email,password)),
  link:password=>run('link',async attempt=>{
   const stamp=getSession(),user=auth.currentUser;
   if(stamp.record?.role?.trim().toLowerCase()!=='admin')throw Error('Google linking is restricted to an approved Admin.');
   if(!stamp.uid||stamp.record?.authUid!==stamp.uid||!password)throw Error('Sign in to your approved account and enter your current password first.');
   const current=()=>!attempt.cancelled&&same(stamp);
   await api.reauthenticateWithCredential(user,api.EmailAuthProvider.credential(stamp.email,password));
   if(!current())return null;
   const result=await api.linkWithPopup(user,provider(stamp.email));
   // Always inspect a committed link, even if token revalidation signed the user out meanwhile.
   const google=result.user.providerData.find(p=>p.providerId==='google.com');
   const matching=result.user.uid===stamp.uid&&google?.uid&&google.email?.trim().toLowerCase()===stamp.email?.trim().toLowerCase()
    &&(!stamp.record.googleSubject||google.uid===stamp.record.googleSubject);
   if(!matching){
    let removed=false;
    try{if(result.user.uid===stamp.uid){await api.unlink(result.user,'google.com');removed=true;}}
    catch{/* Sign out and disclose failed recovery; never turn it into success. */}
    if(current())await api.signOut(auth);
    throw Object.assign(Error(removed?'You selected a different Google account. It was unlinked; sign in again with your password.':'The Google account did not match and could not be removed safely. Signed out; ask the Owner to inspect the account before retrying.'),{recoveryRequired:!removed});
   }
   if(!result.user.providerData.some(p=>p.providerId==='password')){
    if(current())await api.signOut(auth);
    throw Object.assign(Error('Password fallback is missing. Signed out; ask the Owner to inspect the account before continuing.'),{recoveryRequired:true});
   }
   if(!current())return null;
   const approved=stamp.record.googleSubject===google.uid;
   return {uid:stamp.uid,status:approved?'approved':'pending-approval',message:approved?'Google account linked. Your account and role are unchanged.':'Google account linked. Owner approval is required before Google sign-in; keep using your password.'};
  })
 };
}
