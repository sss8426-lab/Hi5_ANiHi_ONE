// Extract official marks without synthesizing or altering logo pixels.
import sharp from 'sharp';
import fs from 'node:fs/promises';
const root=process.argv[2];
if(!root)throw Error('Supply the user attachment directory.');
const refs={anihi:'d49ba6fa-fdef-4ce0-9438-b1aef749f2d0',hi5:'2abe7da2-ecf2-4a55-9fbb-f284287d44dc',combined:'fc488210-8aa3-4ebf-9152-7f471e4f5219',slogan:'b21a1566-fa25-42d1-b0fe-f9b252bce459',horizontal:'50e9e64d-fd1f-4392-b854-490184376d7b'};
const dest='public/data-core/assets/brand';
for(const [name,id]of Object.entries(refs)){
  const file=`${root}/codex-clipboard-${id}.png`;
  await fs.copyFile(file,`${dest}/${name}-reference-20260921-v2.png`,1);
  if(name==='slogan')await sharp(file).png().toFile(`${dest}/slogan-20260921-v2.png`);
  else if(name==='horizontal')await sharp(file).extract({left:12,top:15,width:530,height:93}).png().toFile(`${dest}/horizontal-mark-20260921-v2.png`);
}
