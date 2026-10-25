import{readFileSync,existsSync}from'node:fs';import{join}from'node:path';
const MANIFEST=new URL('../config/uat-sso-client-blocks.json',import.meta.url);
export function renderSsoTarget(source,target){
 if(!['prod','uat'].includes(target))throw Error('Unknown SSO build target');
 const expected=JSON.parse(readFileSync(MANIFEST,'utf8')),seen=[];
 const pattern=/^(?:\/\/|<!--) @uat-admin-sso begin (sso-\d+)(?: -->)?\n([\s\S]*?)^(?:\/\*|<!--) @uat-admin-sso production \1\n([\s\S]*?)^@uat-admin-sso end \1 (?:\*\/|-->)\n/gm;
 const out=source.replace(pattern,(_m,id,uat,prod)=>{seen.push(id);return target==='uat'?uat:prod;});
 if(JSON.stringify(seen)!==JSON.stringify(expected)||out.includes('@uat-admin-sso'))throw Error('Missing, duplicate or malformed UAT SSO feature block');
 return out;
}
const forbidden=/GoogleAuthProvider|signInWithPopup|linkWithPopup|google-auth-flow|googleLoginBtn|googleSubject|dashboard-identity|handleGoogleLogin|linkGoogleAccount|accountSecurityOverlay|PMDashboardIdentity|google-sso-gate|googleSso|googleLinkingEnabled|googleSignInEnabled|resolveGoogleSsoGates/;
export function assertNoProductionSso(files){for(const[name,text]of files){if(forbidden.test(name)||forbidden.test(text))throw Error('Production artifact contains UAT SSO: '+name);}}
export function assertSsoReleaseTarget(root,target,{dryRun=false}={}){
 if(existsSync(join(root,'config/uat-only-source.json'))&&['prod','production'].includes(target)&&!dryRun)throw Error('UAT-only SSO source cannot be released to Production. Use the clean Production release line.');
}
