import {LOGOS,CUSTOM_LOGO_PATTERN} from './instagram-brand-policy.js?v=20260923-logoup';
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
  // A campus's own uploaded mark: place it as-is, preserving transparency and aspect ratio — no
  // generated campus-name text or white backing, unlike the official lockups below.
  if(CUSTOM_LOGO_PATTERN.test(type)){
    const fileId=type.slice('custom:'.length);
    const logo=await loadBitmap('/api/data-core/files/'+encodeURIComponent(fileId),signal);
    try{
      canvas.width=1800;canvas.height=340;
      const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
      fitted(ctx,logo,0,0,canvas.width,canvas.height);
    }finally{logo.close();}
    return;
  }
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
// The frame without any user layers: background + official logo + the photo/artwork. User layers are
// always drawn on top of a fresh base, so editing them never stacks a second copy into the pixels.
// Returns the canvas and where the photo/artwork actually landed (for placing new layers beside it).
export async function composeBase(sourceUrl,design,label,signal){
  const image=await loadBitmap(sourceUrl,signal),logo=document.createElement('canvas'),canvas=document.createElement('canvas');
  canvas.width=MASTER.width;canvas.height=MASTER.height;
  try{
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,2160,2700);
    if(design.logoType!=='none'){await drawLogo(logo,design.logoType,label,signal);fitted(ctx,logo,110,32,1940,260);}
    const box=imageBox(design.materialKind,design.logoType),cover=box.fit==='cover';fitted(ctx,image,box.x,box.y,box.width,box.height,cover);
    const scale=(cover?Math.max:Math.min)(box.width/image.width,box.height/image.height),w=Math.min(box.width,image.width*scale),h=Math.min(box.height,image.height*scale);
    // top/bottom: the photo frame's own edges — the official logo band above it is never "free space".
    return {canvas,artwork:{x:box.x+(box.width-w)/2,y:box.y+(box.height-h)/2,w,h,top:box.y,bottom:box.y+box.height}};
  }catch(error){canvas.width=canvas.height=1;throw error;}
  finally{image.close();logo.width=logo.height=1;}
}
export const USER_LAYER_LIMIT=20;
// User images are drawn exactly as uploaded — same pixels, alpha kept, only scaled to the layer box.
export function drawLayers(ctx,layers,assets,scale=1){
  for(const layer of [...layers].sort((a,b)=>a.z-b.z)){
    const image=assets.get(layer.assetId);
    if(!image)throw Error(`'${layer.assetName||'사용자 이미지'}'를 불러오지 못했습니다.`);
    ctx.drawImage(image,layer.x*scale,layer.y*scale,layer.w*scale,layer.h*scale);
  }
}
// Loads each referenced user image once. A deleted or no-longer-permitted image is reported by name —
// never replaced or silently left out of the picture.
export async function loadLayerAssets(layers,signal,cache=new Map()){
  for(const layer of layers){
    if(cache.has(layer.assetId))continue;
    try{cache.set(layer.assetId,await loadBitmap('/api/data-core/files/'+encodeURIComponent(layer.assetId),signal));}
    catch(error){if(error.name==='AbortError')throw error;throw Error(`'${layer.assetName||'사용자 이미지'}' 이미지를 불러올 수 없습니다. 삭제되었거나 권한이 바뀌었는지 확인하고, 이 이미지를 빼고 다시 적용해주세요.`);}
  }
  return cache;
}
// Where a newly added user image goes by default: in free space below (or above) the artwork when
// there is room, so a student's work is never covered unless the user drags it there; otherwise a
// small bottom-right corner. Several images line up right to left.
export function defaultLayerBox(asset,artwork,index,occupied=0){
  const ratio=asset.width/asset.height,margin=56,gap=24;
  const below=(artwork.bottom??MASTER.height-margin)-(artwork.y+artwork.h),above=artwork.y-(artwork.top??margin);
  const band=below>=160?{y:artwork.y+artwork.h+(below-Math.min(below-gap,360))/2,h:Math.min(below-gap,360)}:above>=160?{y:artwork.y-Math.min(above-gap,360)-gap/2,h:Math.min(above-gap,360)}:null;
  let h=band?band.h:360,w=h*ratio;
  if(w>(band?900:560)){w=band?900:560;h=w/ratio;}
  const x=MASTER.width-margin-occupied-w,y=band?band.y+(band.h-h)/2:MASTER.height-margin-h;
  return {x:Math.round(Math.max(0,x)),y:Math.round(y),w:Math.max(8,Math.round(w)),h:Math.max(8,Math.round(h)),z:index};
}
export async function composeInstagram(sourceUrl,design,label,signal,{layers=[],place=[],assets}={}){
  const start=performance.now();
  const {canvas,artwork}=await composeBase(sourceUrl,design,label,signal);
  const loaded=performance.now(),cache=assets||new Map();
  try{
    // `place`: user images chosen for every photo, not yet positioned on this one.
    const placed=[...layers];let occupied=0;
    if(place.length){
      await loadLayerAssets(place.map(asset=>({assetId:asset.id,assetName:asset.name})),signal,cache);
      for(const asset of place){
        const box=defaultLayerBox(cache.get(asset.id),artwork,placed.length,occupied);occupied=MASTER.width-56-box.x+24;
        placed.push({id:crypto.randomUUID(),assetId:asset.id,assetName:asset.name,...box});
      }
    }
    await loadLayerAssets(placed,signal,cache);
    drawLayers(canvas.getContext('2d'),placed,cache);
    const composed=performance.now(),blob=await encodeMaster(canvas,signal),encoded=performance.now();
    for(const [name,from,to]of [['source',start,loaded],['compose',loaded,composed],['png',composed,encoded]]){
      performance.clearMeasures('instagram.'+name);performance.measure('instagram.'+name,{start:from,end:to});
    }
    return {blob,layers:placed.map(({id,assetId,assetName,x,y,w,h,z})=>({id,assetId,assetName,x,y,w,h,z}))};
  }finally{canvas.width=canvas.height=1;if(!assets)for(const image of cache.values())image.close();}
}
