import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const dir=dirname(fileURLToPath(import.meta.url)),repo=resolve(dir,'../..'),runtime=join(dir,'.runtime');
await mkdir(join(runtime,'scripts'),{recursive:true});
for(const file of ['curriculum-sync-core.mjs','curriculum-tree.mjs','curriculum-cloudflare.mjs','import-curriculum-tree.mjs'])await copyFile(join(repo,'scripts',file),join(runtime,'scripts',file));
const config=JSON.parse(await readFile(join(repo,'dist/server/wrangler.json'),'utf8'));
if(config.name!=='hi5-anihi-one')throw Error('Expected existing production configuration.');
const d1=config.d1_databases.find(b=>b.binding==='DB'),r2=config.r2_buckets.find(b=>b.binding==='FILES');
if(!d1?.database_id||!r2?.bucket_name)throw Error('Existing DB/FILES missing.');
// Only public resource identifiers; never package the Worker vars/secrets or OAuth state.
await writeFile(join(runtime,'cloudflare.json'),JSON.stringify({name:config.name,...(config.account_id?{account_id:config.account_id}:{}),d1_databases:[{binding:'DB',database_id:d1.database_id}],r2_buckets:[{binding:'FILES',bucket_name:r2.bucket_name}]},null,2));
await copyFile(join(dir,'node_modules/lucide/dist/umd/lucide.min.js'),join(runtime,'lucide.js'));
const logo=await sharp(await readFile(join(repo,'public/admissions-web/renderer/assets/hi5-anihi-logo.png'))).resize(256,256,{fit:'contain',background:'#ffffff'}).png().toBuffer();
await writeFile(join(runtime,'logo.png'),logo);
const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(logo.length,14);header.writeUInt32LE(22,18);
await writeFile(join(runtime,'icon.ico'),Buffer.concat([header,logo]));
console.log('Sync runtime built from existing importer; no source or central writes.');
