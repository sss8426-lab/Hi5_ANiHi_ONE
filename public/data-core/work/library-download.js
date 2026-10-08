import {Zip,ZipPassThrough} from '../vendor/fflate-0.8.3.js';
// One file downloads directly; several are bundled into one zip so the browser does not ask once per file.
const ZIP_LIMIT=500*1024*1024;
const save=(href,name)=>{const a=document.createElement('a');a.href=href;a.download=name;document.body.append(a);a.click();a.remove();};
const safe=name=>[...String(name||'파일')].map(c=>c.charCodeAt(0)<32||'\\/:*?"<>|'.includes(c)?'_':c).join('').slice(0,150)||'파일';
export async function downloadFiles(files,zipName,progress=()=>{}){
  files=files.filter(f=>f?.downloadUrl);if(!files.length)return;
  if(files.length===1){save(files[0].downloadUrl,files[0].fileName);return;}
  if(files.reduce((sum,f)=>sum+(Number(f.sizeBytes)||0),0)>ZIP_LIMIT)throw new Error('한 번에 받을 수 있는 크기(500MB)를 넘었습니다. 나눠서 받아 주세요.');
  const chunks=[],used=new Set();let zipError;
  const zip=new Zip((error,data)=>{if(error)zipError=error;else chunks.push(data);});
  try{
    for(const [i,f] of files.entries()){
      progress(`${i+1}/${files.length}개 받는 중…`);
      const response=await fetch(f.downloadUrl,{cache:'no-store'});
      if(!response.ok)throw new Error(`${f.fileName}: 파일을 받지 못했습니다.`);
      let name=safe(f.fileName);
      for(let n=2;used.has(name);n++)name=safe(f.fileName).replace(/(\.[^.]*)?$/,m=>` (${n})${m}`);
      used.add(name);
      const entry=new ZipPassThrough(name);zip.add(entry);entry.push(new Uint8Array(await response.arrayBuffer()),true);
      if(zipError)throw zipError;
    }
    zip.end();if(zipError)throw zipError;
    const url=URL.createObjectURL(new Blob(chunks,{type:'application/zip'}));
    save(url,safe(zipName).replace(/(\.zip)?$/i,'.zip'));setTimeout(()=>URL.revokeObjectURL(url),60000);
    progress('');
  }finally{zip.terminate();chunks.length=0;}
}
