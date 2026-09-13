import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {occupationImageConcepts} from '../public/data-core/occupation-image-concepts.js';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
await fs.mkdir('outputs/work-covers', {recursive:true});
const browser = await chromium.launch({headless:true, channel:'chrome'});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1100}});
  for (let offset = 0; offset < occupationImageConcepts.length; offset += 8) {
    const cards = [];
    for (const c of occupationImageConcepts.slice(offset, offset + 8)) {
      const bytes = await fs.readFile('public' + c.asset);
      cards.push(`<article><img src="data:image/webp;base64,${bytes.toString('base64')}"><h2>${c.occupationId} ${c.title}</h2><p>${c.visualFocus}</p></article>`);
    }
    await page.setContent(`<html lang="ko"><meta charset="utf-8"><style>body{margin:24px;font:15px 'Malgun Gothic',sans-serif;background:#f8f8f5}main{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}article{background:white;border:1px solid #ddd;padding:10px}img{width:100%;aspect-ratio:4/3;object-fit:contain}h2{font-size:16px}p{font-size:13px}</style><main>${cards.join('')}</main></html>`);
    await page.locator('img').evaluateAll(nodes => Promise.all(nodes.map(i => i.decode())));
    await page.screenshot({path:`outputs/work-covers/review-${offset + 1}.png`,fullPage:true});
  }
} finally { await browser.close(); }
