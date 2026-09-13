import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {occupationImageConcepts} from '../public/data-core/occupation-image-concepts.js';

// Display-sized copies only. The 105 approved detail assets and old portraits stay unchanged.
const inventoryPath = 'public/data-core/visual-assets.json';
const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
for (const concept of occupationImageConcepts) {
  const original = await fs.readFile('public' + concept.sourceAsset);
  const bytes = await sharp(original).resize(concept.width, concept.height, {fit:'inside'}).webp({quality:84, effort:5}).toBuffer();
  const destination = 'public' + concept.asset;
  await fs.mkdir(path.dirname(destination), {recursive:true});
  await fs.writeFile(destination, bytes);
  const asset = inventory.assets.find(item => item.key === concept.occupationId);
  Object.assign(asset, {asset:concept.asset, version:concept.version, width:concept.width, height:concept.height,
    alt:concept.alt, sourceAsset:concept.sourceAsset, legacyAsset:concept.legacyAsset,
    sourceSha256:createHash('sha256').update(original).digest('hex'),
    sha256:createHash('sha256').update(bytes).digest('hex'), bytes:bytes.length,
    role:'occupation-work-cover', provenance:'Display derivative of the same occupation approved fictional portfolio photograph; not actual student work.'});
}
await fs.writeFile(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
console.log(`Prepared ${occupationImageConcepts.length} work-focused covers; source images preserved.`);
