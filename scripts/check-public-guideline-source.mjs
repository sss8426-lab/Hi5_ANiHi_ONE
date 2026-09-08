import {decodePublicGuidelines,guidelineIdentity} from '../public/data-core/admissions-model.js';
for(const [season,file] of [['susi','susi'],['jungsi','jeongsi']]){
  try{
    const r=await fetch(`https://grinalda.net/wp-content/uploads/grinalda/grinalda-${file}-2027-data.json`,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!r.ok || !r.headers.get('content-type')?.includes('application/json'))throw new Error('Source unavailable');
    const rows=decodePublicGuidelines(await r.json(),season,{sourceName:'그리날다',sourceUrl:`https://grinalda.net/univ-info-${season}/`,sourceUpdatedAt:r.headers.get('last-modified'),fetchedAt:new Date().toISOString()});
    console.log(JSON.stringify({season,http:r.status,rows:rows.length,identities:new Set(rows.map(guidelineIdentity)).size,simpleRatios:rows.filter(r=>r.practicalRatio!==null).length,memberOnlyStatisticsStored:false}));
  }catch{console.error(JSON.stringify({season,error:'Public source schema/availability validation failed; no data saved.'}));process.exitCode=1;}
}
