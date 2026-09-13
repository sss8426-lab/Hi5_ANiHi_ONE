import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createHash} from 'node:crypto';

const slots = {
  story: ['웹툰·게임·애니메이션', '세로 웹툰 원고, 3D 애니메이션 화면과 스토리보드가 놓인 작업대'],
  design: ['디자인', '패키지 시제품, 편집물, 색상표와 앱 화면을 비교하는 디자인 작업대'],
  competition: ['공모전·실기대회', '수채화 작품, 투시 드로잉과 도형 소묘를 준비한 미술 작업대'],
  admissions: ['대학 합격 로드맵', '진학 자료 비교표와 포트폴리오를 정리한 테이블'],
  operations: ['업무', '일정표와 자료 폴더, 작품 목록을 정리한 업무용 책상'],
};
const [slot, source] = process.argv.slice(2);
if (!Object.hasOwn(slots, slot) || !source || !path.isAbsolute(source)) throw Error('Use slot and absolute generated-image path');
const asset = `/data-core/assets/work-visuals/${slot}-v1.webp`;
const bytes = await sharp(source).rotate().resize(1440, 960, {fit:'inside'}).webp({quality:84, effort:5}).toBuffer();
await fs.mkdir(path.dirname('public' + asset), {recursive:true});
await fs.writeFile('public' + asset, bytes, {flag:'wx'});
const inventoryPath = 'public/data-core/visual-assets.json';
const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
if (inventory.assets.some(item => item.key === `work-${slot}`)) throw Error('Duplicate asset key');
inventory.assets.push({key:`work-${slot}`,title:slots[slot][0],alt:slots[slot][1],asset,
  width:1440,height:960,version:'20260913-work-v1',style:'bright-photorealistic',role:'work-focused-page',
  fictionalPeople:false,generated:true,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
  provenance:'Generated fictional work materials. Not actual students, admissions evidence or official documents.'});
await fs.writeFile(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({slot,asset,bytes:bytes.length}));
