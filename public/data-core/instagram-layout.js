import {LOGOS} from './instagram-brand-policy.js';
export const MASTER={width:2160,height:2700};
export function imageBox(kind,logoType){return {x:56,y:logoType==='none'?56:340,width:2048,height:logoType==='none'?2588:2304,fit:kind==='student-artwork'||kind==='fact-document'?'contain':'cover'};}
export async function loadBitmap(url,signal){
  const response=await fetch(url,{credentials:'same-origin',signal});if(!response.ok)throw Error('이미지를 불러오지 못했습니다.');
  const blob=await response.blob();if(blob.size>20*1024*1024)throw Error('20MB 이하 이미지를 선택하세요.');
  try{
    const image=await createImageBitmap(blob,{imageOrientation:'from-image'});if(image.width*image.height>100000000){image.close();throw Error('1억 화소 이하 이미지를 선택하세요.');}return image;
  }catch(error){if(error.name==='AbortError'||error.message.includes('화소'))throw error;throw Error('이미지를 읽을 수 없습니다. PNG, JPG, JPEG, WebP, GIF, AVIF, BMP 파일인지 확인하세요.');}
}
export function encodeMaster(canvas,signal){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./instagram-png-worker.js',import.meta.url),{type:'module'});
    const finish=(error,blob)=>{worker.terminate();signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(blob);};
    const abort=()=>finish(new DOMException('작업을 중단했습니다.','AbortError'));
    signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=()=>finish(Error('PNG 변환에 실패했습니다. 새로고침 후 다시 시도하세요.'));
    worker.onmessage=({data})=>data.error?finish(Error(data.error)):finish(null,new Blob([data.bytes],{type:'image/png'}));
    try{const pixels=canvas.getContext('2d').getImageData(0,0,MASTER.width,MASTER.height).data;worker.postMessage({...MASTER,pixels:pixels.buffer},[pixels.buffer]);}catch(error){finish(error);}
  });
}
function fitted(ctx,image,x,y,w,h,cover=false){const scale=(cover?Math.max:Math.min)(w/image.width,h/image.height);ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.drawImage(image,x+(w-image.width*scale)/2,y+(h-image.height*scale)/2,image.width*scale,image.height*scale);ctx.restore();}
// Tight measured lockups. The marks themselves are original user-supplied raster pixels.
export async function drawLogo(canvas,type,label,signal){
  const spec=LOGOS[type];if(!spec)throw Error('로고를 선택하세요.');
  const logo=await loadBitmap(spec.src,signal);await document.fonts.ready;
  try{
    const ctx=canvas.getContext('2d');canvas.width=1800;canvas.height=type==='slogan'?695:340;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(type==='slogan'){fitted(ctx,logo,0,0,1800,695);return;}
    if(label==='안산 입시본원'){
      const ref=await loadBitmap(`/data-core/assets/brand/${type}-reference-20260921-v2.png`,signal);
      try{fitted(ctx,ref,0,0,1800,340);}finally{ref.close();}return;
    }
    ctx.fillStyle='#383634';ctx.textBaseline='middle';
    const regionalLabel=label.match(/^(.*?)\s*(입시본원|캠퍼스)$/);
    if(type==='combined'&&regionalLabel){
      // The red official mark sits between black region/type labels, as in the supplied lockup.
      ctx.font='700 132px sans-serif';const prefix=regionalLabel[1].trim(),suffix=regionalLabel[2];
      const left=ctx.measureText(prefix).width,right=ctx.measureText(suffix).width,markHeight=210,markWidth=markHeight*logo.width/logo.height,gap=28;
      const total=left+gap+markWidth+gap+right,scale=Math.min(1,1740/total);
      ctx.save();ctx.translate((1800-total*scale)/2,(340-markHeight*scale)/2);ctx.scale(scale,scale);
      ctx.fillText(prefix,0,126);ctx.drawImage(logo,left+gap,0,markWidth,markHeight);ctx.fillText(suffix,left+gap+markWidth+gap,126);ctx.restore();return;
    }
    const twoLine=['anihi','hi5'].includes(type),font=twoLine?122:132;ctx.font=`700 ${font}px sans-serif`;
    const textWidth=ctx.measureText(label).width,markHeight=twoLine?250:210,markWidth=markHeight*logo.width/logo.height,gap=twoLine?34:28;
    const total=markWidth+gap+Math.max(textWidth,twoLine?ctx.measureText(spec.tagline).width*0.38:0),scale=Math.min(1,1740/total);
    ctx.save();ctx.translate((1800-total*scale)/2,(340-markHeight*scale)/2);ctx.scale(scale,scale);
    ctx.drawImage(logo,0,0,markWidth,markHeight);ctx.fillText(label,markWidth+gap,twoLine?100:markHeight/2);
    if(twoLine){ctx.fillRect(markWidth+gap,171,textWidth,2.5);ctx.font='47px sans-serif';ctx.fillText(spec.tagline,markWidth+gap,224);}
    ctx.restore();
  }finally{logo.close();}
}
export async function composeInstagram(sourceUrl,design,label,signal){
  const start=performance.now();
  const image=await loadBitmap(sourceUrl,signal),logo=document.createElement('canvas'),canvas=document.createElement('canvas');
  const loaded=performance.now();
  canvas.width=MASTER.width;canvas.height=MASTER.height;
  try{
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,2160,2700);
    if(design.logoType!=='none'){await drawLogo(logo,design.logoType,label,signal);fitted(ctx,logo,110,32,1940,260);}
    const box=imageBox(design.materialKind,design.logoType);fitted(ctx,image,box.x,box.y,box.width,box.height,box.fit==='cover');
    const composed=performance.now(),blob=await encodeMaster(canvas,signal),encoded=performance.now();
    for(const [name,from,to]of [['source',start,loaded],['compose',loaded,composed],['png',composed,encoded]]){
      performance.clearMeasures('instagram.'+name);performance.measure('instagram.'+name,{start:from,end:to});
    }
    return blob;
  }finally{image.close();canvas.width=canvas.height=1;logo.width=logo.height=1;}
}
