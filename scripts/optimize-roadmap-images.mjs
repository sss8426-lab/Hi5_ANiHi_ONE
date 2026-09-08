import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { occupationImageConcepts } from '../public/data-core/occupation-image-concepts.js';

const manifest=JSON.parse(await fs.readFile(process.argv[2] || 'outputs/roadmap-image-manifest.json','utf8'));
const directory=path.resolve('public/data-core/assets/roadmap/jobs');
await fs.mkdir(directory,{recursive:true});
let bytes=0;
for(const [id,source] of Object.entries(manifest)){
  const concept=occupationImageConcepts.find(c=>c.occupationId===id);
  if(!concept || typeof source!=='string')throw new Error('Unknown image concept');
  const destination=path.join(directory,path.basename(concept.asset));
  const info=await sharp(source).resize(600,800,{fit:'cover'}).webp({quality:82,effort:5}).toFile(destination);
  bytes+=info.size;
}
console.log(JSON.stringify({optimized:Object.keys(manifest).length,bytes}));
