import { read, utils } from 'xlsx';
import { readPsd, getCompositeImageData, initializeCanvas } from 'ag-psd';
import { Inflate } from '../vendor/fflate-0.8.3.js';

// Parsing is isolated in a terminable worker. No macros, formulas, or HTML run.
function checkZip(buffer){
  const d=new DataView(buffer);if(d.byteLength<4||d.getUint32(0,true)!==0x04034b50)return;
  let end=-1;for(let i=d.byteLength-22;i>=Math.max(0,d.byteLength-65557);i--)if(d.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw Error('손상된 압축 문서입니다.');
  const count=d.getUint16(end+10,true);let offset=d.getUint32(end+16,true),total=0;
  if(count>4000||count===65535)throw Error('미리보기 압축 항목 제한을 초과합니다.');
  let expanded=0;
  for(let n=0;n<count;n++){
    if(offset+46>d.byteLength||d.getUint32(offset,true)!==0x02014b50)throw Error('손상된 압축 문서입니다.');
    total+=d.getUint32(offset+24,true);if(total>64*1024*1024)throw Error('압축 해제 크기 64MB 제한을 초과합니다.');
    if(d.getUint16(offset+8,true)&1)throw Error('암호화된 문서는 다운로드 후 열어주세요.');
    // Verify actual expansion in small chunks; forged ZIP size fields are not a budget.
    const method=d.getUint16(offset+10,true),compressed=d.getUint32(offset+20,true),declared=d.getUint32(offset+24,true),local=d.getUint32(offset+42,true);
    if(local+30>d.byteLength||d.getUint32(local,true)!==0x04034b50||d.getUint16(local+8,true)!==method||(d.getUint16(local+6,true)&1))throw Error('손상되었거나 암호화된 압축 문서입니다.');
    const start=local+30+d.getUint16(local+26,true)+d.getUint16(local+28,true);
    if(start+compressed>d.byteLength)throw Error('손상된 압축 문서입니다.');
    let actual=0;
    const accept=chunk=>{actual+=chunk.length;expanded+=chunk.length;if(actual>declared||expanded>64*1024*1024)throw Error('실제 압축 해제 크기가 미리보기 제한 또는 문서 정보를 초과합니다.');};
    const bytes=new Uint8Array(buffer,start,compressed);
    if(method===0)accept(bytes);
    else if(method===8){const inflater=new Inflate(accept);for(let i=0;i<bytes.length;i+=1024)inflater.push(bytes.subarray(i,i+1024),i+1024>=bytes.length);}
    else throw Error('지원하지 않는 ZIP 압축 방식입니다.');
    if(actual!==declared)throw Error('압축 문서의 저장 크기가 올바르지 않습니다.');
    offset+=46+d.getUint16(offset+28,true)+d.getUint16(offset+30,true)+d.getUint16(offset+32,true);
  }
}
let workbook;
function sheet(index){
  const name=workbook.SheetNames[index],ws=workbook.Sheets[name];
  if(!ws)return {error:'시트를 찾을 수 없습니다.'};
  const range=utils.decode_range(ws['!ref']||'A1'),rows=[];
  const last=Math.min(range.e.r,499),lastCol=Math.min(range.e.c,49);
  for(let r=0;r<=last;r++){
    if(ws['!rows']?.[r]?.hidden)continue;
    const cells=[];for(let c=0;c<=lastCol;c++){
      if(ws['!cols']?.[c]?.hidden)continue;
      const cell=ws[utils.encode_cell({r,c})];cells.push({r,c,text:cell?String(cell.w??(cell.v===undefined?(cell.f?'계산 결과 없음':''):utils.format_cell(cell))).slice(0,4000):''});
    }rows.push(cells);
  }
  return {kind:'sheet',name,index,names:workbook.SheetNames,rows,merges:(ws['!merges']||[]).filter(m=>m.s.r<=last&&m.s.c<=lastCol).slice(0,2000),limited:!!ws['!fullref']||range.e.r>499||range.e.c>49};
}
self.onmessage=({data:{buffer,kind,index}})=>{
  try{
    if(kind==='sheet')return self.postMessage(sheet(index));
    if(kind==='excel'){
      checkZip(buffer);
      workbook=read(buffer,{type:'array',cellStyles:true,cellNF:true,cellDates:false,sheetRows:500,bookVBA:false,cellHTML:false});
      workbook.SheetNames=workbook.SheetNames.filter(name=>!workbook.Workbook?.Sheets?.find(s=>s.name===name)?.Hidden);
      if(!workbook.SheetNames.length)throw Error('표시 가능한 시트가 없습니다.');
      if(workbook.SheetNames.length>100)throw Error('시트 100개 제한을 초과합니다.');
      return self.postMessage(sheet(0));
    }
    const d=new DataView(buffer);
    if(d.byteLength<26||d.getUint32(0)!==0x38425053)throw Error('올바른 PSD 파일이 아닙니다.');
    if(d.getUint16(4)!==1)throw Error('PSB는 미리보기를 지원하지 않습니다. 원본을 다운로드해 주세요.');
    const height=d.getUint32(14),width=d.getUint32(18);
    if(width*height>16000000)throw Error('PSD 미리보기는 1,600만 픽셀까지 지원합니다.');
    if(d.getUint16(22)!==8||d.getUint16(24)!==3)throw Error('PSD 미리보기는 8비트 RGB 합성 이미지만 지원합니다.');
    initializeCanvas((w,h)=>new OffscreenCanvas(w,h),(w,h)=>new ImageData(w,h));
    const psd=readPsd(buffer,{useRawData:true,useRawThumbnail:true,skipLayerImageData:true,skipLinkedFilesData:true,totalMemoryLimit:128*1024*1024});
    const pixels=getCompositeImageData(psd);
    if(pixels){self.postMessage({kind:'psd',width:pixels.width,height:pixels.height,data:pixels.data},[pixels.data.buffer]);}
    else if(psd.imageResources?.thumbnailRaw){const t=psd.imageResources.thumbnailRaw;self.postMessage({kind:'thumbnail',data:t.data});}
    else throw Error('저장된 합성 이미지나 썸네일이 없습니다. 호환성 최대화로 다시 저장해 주세요.');
  }catch(error){self.postMessage({error:/password|encrypt/i.test(error.message)?'암호화된 문서는 다운로드 후 열어주세요.':error.message||'손상되었거나 지원하지 않는 파일입니다.'});}
};
