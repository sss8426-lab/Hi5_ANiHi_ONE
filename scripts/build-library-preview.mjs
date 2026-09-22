import { build } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
const dest='public/data-core/vendor/library-preview';
await mkdir(dest,{recursive:true});
await build({configFile:false,publicDir:false,logLevel:'warn',build:{outDir:dest,emptyOutDir:false,target:'es2022',minify:true,
  lib:{entry:'public/data-core/work/library-preview-worker.js',formats:['es'],fileName:()=> 'parser.js'}}});
for(const name of ['build/pdf.mjs','build/pdf.worker.mjs','cmaps','standard_fonts','wasm','LICENSE'])await cp(`node_modules/pdfjs-dist/${name}`,`${dest}/${name}`,{recursive:true});
await cp('node_modules/ag-psd/LICENSE',`${dest}/LICENSE-ag-psd`);
await cp('node_modules/xlsx/LICENSE',`${dest}/LICENSE-xlsx`);
await build({configFile:false,publicDir:false,logLevel:'warn',build:{outDir:dest,emptyOutDir:false,target:'es2022',minify:true,
  lib:{entry:'node_modules/image-size/dist/esm/index.js',formats:['es'],fileName:()=> 'image-size.mjs'}}});
await cp('node_modules/image-size/LICENSE',`${dest}/LICENSE-image-size`);
