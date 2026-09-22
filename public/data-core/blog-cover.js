import {drawLogo,loadBitmap} from './instagram-layout.js';
import {LOGOS} from './instagram-brand-policy.js';
import {resolveFiles} from './blog-download.js';

export function mountBlogCover({host,$,state,onApply,onError}){
  const section=document.createElement('details');section.className='blog-workflow';
  section.innerHTML='<summary>대표 이미지</summary><div class="blog-fields"><label>원본 사진<select id="blogCoverSource"></select></label><label>양식<select id="blogCoverStyle"><option value="photo">사진 중심</option><option value="class">수업 소개</option><option value="work">작품 전체 보존</option><option value="news">소식 안내</option><option value="info">정보 정리</option></select></label><label>제목<input id="blogCoverTitle" maxlength="90"></label><label>로고<select id="blogCoverLogo"></select></label><label>밝기<input type="range" id="blogCoverBrightness" min="80" max="120" value="100"></label><label>사진 가로 위치<input type="range" id="blogCoverX" min="0" max="100" value="50"></label></div><div class="blog-actions"><button type="button" class="ghost-btn" id="blogCoverPreview">미리보기 만들기</button><button type="button" class="ghost-btn" id="blogCoverApply" disabled>이 이미지 적용·저장</button></div><canvas id="blogCoverCanvas" width="1200" height="900" hidden style="max-width:100%;height:auto"></canvas><p id="blogCoverStatus" role="status"></p>';
  host.append(section);let current=null,controller,epoch=0,selectedPhotos=[];
  $('blogCoverSource').closest('.blog-fields').insertAdjacentHTML('beforeend','<label>적용 위치<select id="blogImageTarget"><option value="cover">대표 이미지</option><option value="body">선택한 본문 사진 편집</option></select></label><label>로고 크기<input id="blogLogoScale" type="range" min="50" max="100" value="100"></label><label>로고 위치<select id="blogLogoAlign"><option value="center">가운데</option><option value="left">왼쪽</option><option value="right">오른쪽</option></select></label>');
  $('blogCoverLogo').innerHTML=Object.entries(LOGOS).map(([id,v])=>`<option value="${id}">${v.label||id}</option>`).join('');$('blogCoverLogo').value='none';
  const read=()=>({sourceFileId:$('blogCoverSource').value,title:$('blogCoverTitle').value,style:$('blogCoverStyle').value,logoType:$('blogCoverLogo').value,brightness:Number($('blogCoverBrightness').value),x:Number($('blogCoverX').value),target:$('blogImageTarget').value,logoScale:Number($('blogLogoScale').value),logoAlign:$('blogLogoAlign').value});
  function protect(){const p=selectedPhotos.find(p=>p.fileId===$('blogCoverSource').value),locked=p&&['student','teacher','fact'].includes(p.kind);if(locked)$('blogCoverStyle').value='work';$('blogCoverStyle').disabled=Boolean(locked);$('blogCoverBrightness').disabled=Boolean(locked);}
  section.addEventListener('input',()=>{epoch++;controller?.abort();$('blogCoverApply').disabled=true;current=null;protect();});
  async function preview(){
    controller?.abort();controller=new AbortController();const signal=controller.signal,token=++epoch,config=read(),campusId=$('draftCampus').value;current=null;$('blogCoverApply').disabled=true;$('blogCoverStatus').textContent='미리보기 준비 중';
    let image;
    try{
      const [source]=await resolveFiles([config.sourceFileId],campusId,signal);if(!source||source.error)throw Error(source?.error||'원본 사진을 선택하세요.');
      if(source.preserveReason)config.style='work';
      image=await loadBitmap(source.url,signal);const canvas=$('blogCoverCanvas'),ctx=canvas.getContext('2d');canvas.width=1200;canvas.height=900;ctx.fillStyle='#fff';ctx.fillRect(0,0,1200,900);
      const logoHeight=config.logoType==='none'?0:125,photoY=logoHeight+24,photoHeight=900-photoY-(config.title?170:24);
      if(config.title){ctx.fillStyle=({class:'#edf4f0',work:'#fff',news:'#f7f0f1',info:'#eef1f7',photo:'#fff'})[config.style];ctx.fillRect(0,740,1200,160);}
      // Artwork is always contained and never color-adjusted or cropped.
      const preserve=config.style==='work',cover=!preserve&&config.style==='photo',scale=(cover?Math.max:Math.min)(1152/image.width,photoHeight/image.height);
      ctx.save();ctx.beginPath();ctx.rect(24,photoY,1152,photoHeight);ctx.clip();ctx.filter=preserve?'none':`brightness(${config.brightness}%)`;ctx.drawImage(image,24+(1152-image.width*scale)*config.x/100,photoY+(photoHeight-image.height*scale)/2,image.width*scale,image.height*scale);ctx.restore();
      if(config.logoType!=='none'){
        const response=await fetch('/api/data-core/content/instagram-policy?campusId='+encodeURIComponent(campusId),{signal});const policy=await response.json();if(!response.ok)throw Error(policy.error||'캠퍼스 로고 확인 실패');
        const label=policy.campusLogoLabel;if(!label)throw Error('승인된 캠퍼스 로고 표시명을 확인할 수 없습니다.');
        const logo=document.createElement('canvas');await drawLogo(logo,config.logoType,label,signal);const ratio=Math.min(1100/logo.width,110/logo.height)*config.logoScale/100;const x=config.logoAlign==='left'?50:config.logoAlign==='right'?1150-logo.width*ratio:(1200-logo.width*ratio)/2;ctx.drawImage(logo,x,12,logo.width*ratio,logo.height*ratio);logo.width=1;logo.height=1;
      }
      await document.fonts.ready;ctx.fillStyle='#222';ctx.textAlign='center';ctx.textBaseline='middle';let font=54,lines=[];
      do{ctx.font=`700 ${font}px sans-serif`;lines=[''];for(const char of config.title){let i=lines.length-1;if(ctx.measureText(lines[i]+char).width>1100)lines.push(char);else lines[i]+=char;}font-=2;}while(lines.length>2&&font>16);
      lines.forEach((line,i)=>ctx.fillText(line,600,900-110+i*(font+8)));
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));signal.throwIfAborted();if(token!==epoch)return;
      if(!blob)throw Error('PNG 생성 실패');current={config,source,blob,campusId};canvas.hidden=false;$('blogCoverApply').disabled=false;$('blogCoverStatus').textContent='1200 × 900 · 미리보기 준비';
    }catch(error){if(token===epoch)$('blogCoverStatus').textContent=error.name==='AbortError'?'취소':error.message;}finally{image?.close();}
  }
  $('blogCoverPreview').onclick=preview;
  $('blogCoverApply').onclick=async()=>{if(!current)return;const value=current,token=epoch;$('blogCoverApply').disabled=true;try{const form=new FormData();form.set('file',value.blob,'blog-cover.png');form.set('sourceFileId',value.source.id);form.set('sourceVersion',value.source.version);form.set('campusId',value.campusId);const response=await fetch('/api/data-core/content/blog/image',{method:'POST',body:form,signal:controller.signal});const result=await response.json();if(!response.ok)throw Error(result.error);if(token!==epoch)return;onApply({...value.config,fileId:result.file.id,sourceFileId:value.source.id,sourceVersion:value.source.version});$('blogCoverStatus').textContent='이미지 저장·적용 완료';}catch(error){onError(error.message);$('blogCoverApply').disabled=false;}};
  return {selection(photos){selectedPhotos=photos;const previous=$('blogCoverSource').value;$('blogCoverSource').replaceChildren();for(const p of photos){const option=document.createElement('option');option.value=p.fileId;option.textContent=state.knownFiles.get(p.fileId)?.fileName||p.fileName||'사진';$('blogCoverSource').append(option);}if(photos.some(p=>p.fileId===previous))$('blogCoverSource').value=previous;protect();if(current&&(current.config.sourceFileId!==$('blogCoverSource').value||current.config.style!==$('blogCoverStyle').value)){epoch++;controller?.abort();current=null;$('blogCoverApply').disabled=true;}},reset(){epoch++;controller?.abort();current=null;$('blogCoverCanvas').hidden=true;$('blogCoverApply').disabled=true;$('blogCoverTitle').value='';},};
}
