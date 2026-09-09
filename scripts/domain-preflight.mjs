import {pathToFileURL} from 'node:url';

export const preflightChecks = Object.freeze([
  {path:'/data-core/',status:200,type:'text/html'},
  {path:'/data-core/login',status:200,type:'text/html'},
  {path:'/data-core/counseling',status:200,type:'text/html'},
  {path:'/data-core/roadmap',status:200,type:'text/html'},
  {path:'/family/',status:200,type:'text/html'},
  {path:'/family/sw.js',status:200,type:'javascript'},
  {path:'/family/manifest.webmanifest',status:200,manifest:true},
  {path:'/data-core/assets/mode-counseling.webp',status:200,type:'image/webp'},
  {path:'/data-core/assets/mode-work.webp',status:200,type:'image/webp'},
  {path:'/api/data-core/files?limit=1',status:401,private:true},
  {path:'/api/auth/accounts',status:401,private:true},
  {path:'/api/data-core/admin/backups',status:401,private:true},
  {path:'/api/family/children',status:401,private:true},
]);

export function normalizeOrigin(value) {
  let url;
  try { url=new URL(value); } catch { throw Error('Use an HTTPS origin without credentials, path, query or fragment.'); }
  if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash || url.port || !url.hostname.includes('.')){
    throw Error('Use an HTTPS origin without credentials, path, query or fragment.');
  }
  return url.origin;
}

export function manifestUsesCurrentOrigin(value, origin) {
  if(!value || typeof value!=='object' || !Array.isArray(value.icons) || !value.icons.length)return false;
  const localPath=(path)=>typeof path==='string' && path.startsWith('/family/') && !path.includes('\\') && new URL(path,origin).origin===origin && new URL(path,origin).pathname.startsWith('/family/');
  return value.start_url==='/family/' && value.scope==='/family/' && value.icons.every(icon=>localPath(icon?.src));
}

async function readSmallManifest(response) {
  const reader=response.body?.getReader();if(!reader)throw Error('Empty manifest');
  const chunks=[];let length=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>32768)throw Error('Oversized manifest');chunks.push(value);}
  } finally {await reader.cancel();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function runPreflight(value, fetcher=fetch) {
  const origin=normalizeOrigin(value),results=[];
  for(const check of preflightChecks){
    let response;
    try {
      // Never send a session, follow redirects, read private response bodies or mutate data.
      response=await fetcher(new URL(check.path,origin),{method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)});
      const status=response.status;
      let ok=status===check.status;
      if(check.type)ok=ok && (response.headers.get('content-type') || '').includes(check.type);
      if(check.manifest && ok)ok=manifestUsesCurrentOrigin(await readSmallManifest(response),origin);
      results.push({path:check.path,status,ok});
    } catch { results.push({path:check.path,ok:false,error:'Check failed; response details omitted.'}); }
    finally {if(response?.body && !response.body.locked)await response.body.cancel().catch(()=>{});}
  }
  return {origin,mode:'anonymous-read-only',ok:results.every(r=>r.ok),checks:results,notVerified:['domain ownership and DNS','custom-hostname certificate activation','authenticated session on the new hostname','new-origin PWA installation and device notifications','cutover-time backup and rollback readiness','dependency security advisory triage']};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);
  if(args.length!==1 || !args[0].startsWith('--origin=')){
    console.error('Usage: node --use-system-ca scripts/domain-preflight.mjs --origin=https://your-domain');process.exitCode=1;
  }else{
    try {const result=await runPreflight(args[0].slice(9));console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}
    catch {console.error('Invalid HTTPS origin; input omitted.');process.exitCode=1;}
  }
}
