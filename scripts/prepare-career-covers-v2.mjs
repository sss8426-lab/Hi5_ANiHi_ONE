import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {occupationImageConcepts} from '../public/data-core/occupation-image-concepts.js';
import {careerImageScenes} from '../public/data-core/occupation-image-renewal.js';

const input = JSON.parse(await fs.readFile(process.argv[2] || 'outputs/career-images-v2-input.json', 'utf8'));
if (input.length !== 32 || new Set(input.map(x => x.id)).size !== 32) throw Error('Expected 32 distinct generated sources');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = [];
const registryPath = 'public/data-core/visual-assets.json';
const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
for (const c of occupationImageConcepts) {
  if (!careerImageScenes[c.occupationId]) continue;
  const entry = input.find(x => x.id === c.occupationId);
  if (!entry) throw Error(`Missing ${c.occupationId}`);
  const source = await fs.readFile(entry.sourcePath);
  const meta = await sharp(source).metadata();
  if (Math.abs(meta.width / meta.height - 4 / 3) > 0.01) throw Error(`Unexpected ratio ${c.occupationId}`);
  await fs.mkdir(path.dirname('public' + c.asset), {recursive:true});
  const derived = [];
  for (const [asset,width,height,quality,limit] of [[c.asset,640,480,82,80000],[c.detailAsset,1440,1080,84,350000]]) {
    let bytes;
    for (let q = quality; q >= 74; q -= 2) {
      bytes = await sharp(source).rotate().resize(width,height,{fit:'contain'}).webp({quality:q,effort:6}).toBuffer();
      if (bytes.length <= limit) break;
    }
    if (bytes.length > limit) throw Error(`Image budget exceeded: ${c.occupationId} ${bytes.length}`);
    try { await fs.writeFile('public' + asset,bytes,{flag:'wx'}); }
    catch (e) { if (e.code !== 'EEXIST' || hash(await fs.readFile('public' + asset)) !== hash(bytes)) throw e; }
    derived.push({asset,width,height,bytes:bytes.length,sha256:hash(bytes)});
  }
  const index = registry.assets.findIndex(x => x.key === c.occupationId);
  if (index < 0) throw Error('Missing existing registry slot');
  const previous = {...registry.assets[index]};
  delete previous.size;
  registry.assets[index] = {...previous,asset:c.asset,version:c.version,alt:c.alt,
    sourceAsset:c.sourceAsset,sourceSha256:derived[1].sha256,sha256:derived[0].sha256,
    bytes:derived[0].bytes,width:640,height:480,detailAsset:c.detailAsset,
    provenance:'New fictional AI-generated work scene for career education; not an actual business, student work or employment claim.'};
  provenance.push({id:c.occupationId,slug:c.slug,provider:'OpenAI image generation tool',
    generatedAt:'2026-09-19',syntheticScene:true,sourceName:path.basename(entry.sourcePath),
    sourceSha256:hash(source),prompt:entry.prompt,derived});
}
await fs.writeFile(registryPath,JSON.stringify(registry,null,2)+'\n');
await fs.writeFile('docs/roadmap-image-v2-provenance.json',JSON.stringify({version:'20260919-work-v2',preserved:['D002','D012','D020'],images:provenance},null,2)+'\n');
console.log(JSON.stringify({count:provenance.length,cardBytes:provenance.reduce((n,x)=>n+x.derived[0].bytes,0),detailBytes:provenance.reduce((n,x)=>n+x.derived[1].bytes,0)}));
