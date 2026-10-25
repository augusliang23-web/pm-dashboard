import{readFileSync}from'node:fs';
export function verifySsoPromotion(environment=process.env){
 const base=environment.GITHUB_BASE_REF,ref=environment.GITHUB_REF;
 if(base==='main'||(environment.GITHUB_EVENT_NAME==='push'&&ref==='refs/heads/main'))throw Error('UAT SSO source must not be promoted into Production main; use the clean Production release line.');
 const policy=JSON.parse(readFileSync(new URL('../config/uat-only-source.json',import.meta.url),'utf8'));
 if(policy.productionPromotionAllowed!==false)throw Error('UAT-only source policy must fail closed');
}
verifySsoPromotion();
