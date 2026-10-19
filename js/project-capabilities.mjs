export const DISABLED_PROJECT_CAPABILITIES = Object.freeze({environmentEligible:false,backendSupported:false,draftsEnabled:false,archiveRecoveryEnabled:false,legacyWritesRestricted:false});

// The UI can expose only capabilities returned by the authenticated backend.
export function createProjectCapabilitiesController({load,onState}) {
  let generation=0;
  function reset(){generation++;onState({...DISABLED_PROJECT_CAPABILITIES});}
  async function refresh(){
    const current=++generation;
    onState({...DISABLED_PROJECT_CAPABILITIES});
    let result;
    try { result=await load(); } catch { result=null; }
    if(current!==generation)return;
    const supported=result?.environmentEligible===true && result?.backendSupported===true;
    onState({
      environmentEligible:result?.environmentEligible===true,
      backendSupported:result?.backendSupported===true,
      draftsEnabled:supported && result.draftsEnabled===true,
      archiveRecoveryEnabled:supported && result.archiveRecoveryEnabled===true,
      legacyWritesRestricted:supported && result.draftsEnabled===true && result.legacyWritesRestricted===true,
    });
  }
  return {reset,refresh};
}
