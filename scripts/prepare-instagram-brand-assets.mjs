// Deterministic crops only: never redraw, recolor, distort, or overwrite supplied references.
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
const [reference1, reference2] = process.argv.slice(2);
if (!reference1 || !reference2) throw new Error('Provide both user-supplied logo reference paths.');
const dir = path.resolve('public/data-core/assets/brand');
await fs.mkdir(dir, { recursive: true });
for (const [n, file] of [[1, reference1], [2, reference2]]) await fs.copyFile(file, path.join(dir, `reference-${n}-20260921.jpg`), 1);
const { width, height } = await sharp(reference1).metadata();
for (const [name, box] of [['anihi', [80, 137, 621, 186]], ['hi5', [89, 647, 418, 194]], ['combined', [260, 432, 682, 128]]]) {
  const [x,y,w,h] = box;
  await sharp(reference1).extract({left:Math.round(x/1334*width),top:Math.round(y/1888*height),width:Math.round(w/1334*width),height:Math.round(h/1888*height)})
    .png().toFile(path.join(dir, `${name}-20260921.png`));
}
