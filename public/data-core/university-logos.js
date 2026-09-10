import {universityLogos} from './university-logo-manifest.js';
import {universityIdentity} from './admissions-model.js?v=20260910-connected';
// Renamed schools require an explicit reviewed alias; do not infer mergers or campuses.
export const universityLogoAliases={};
export function resolveUniversityLogo(name,campus='',entries=universityLogos){
  const raw=String(name||'').trim();
  const wanted=universityIdentity(universityLogoAliases[raw]||raw,campus);
  const candidates=entries.filter(e=>universityIdentity(e.name,e.campus).school===wanted.school);
  const campusSpecific=candidates.filter(e=>universityIdentity(e.name,e.campus).campus&&universityIdentity(e.name,e.campus).campus===wanted.campus);
  if(campusSpecific.length===1)return campusSpecific[0];
  if(campusSpecific.length>1)return null;
  const common=candidates.filter(e=>!universityIdentity(e.name,e.campus).campus);
  return common.length===1&&!candidates.some(e=>universityIdentity(e.name,e.campus).campus)?common[0]:null;
}
