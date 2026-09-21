import {encode} from './vendor/fast-png-8.0.0-encoder.js';

self.onmessage = ({data:{width,height,pixels}}) => {
  try {
    if(width!==2160||height!==2700||pixels.byteLength!==width*height*4)throw Error('이미지 규격을 확인하세요.');
    const rgba=new Uint8Array(pixels),rgb=new Uint8Array(width*height*3);
    for(let i=0,j=0;i<rgba.length;i+=4){rgb[j++]=rgba[i];rgb[j++]=rgba[i+1];rgb[j++]=rgba[i+2];}
    const bytes=encode({width,height,channels:3,depth:8,data:rgb},{zlib:{level:6}});
    self.postMessage({bytes},[bytes.buffer]);
  }catch(error){self.postMessage({error:error.message});}
};
