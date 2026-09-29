import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {careerWorks} from '../public/data-core/career-works.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = path.join(root, 'public');
const manifestPath = path.join(root, 'docs/career-work-visual-provenance.json');
const outputPath = path.join(publicRoot, 'data-core/career-work-visuals.js');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const context = {window:{}};
vm.runInNewContext(await fs.readFile(path.join(publicRoot, 'data-core/roadmap-content.js'), 'utf8'), context);
vm.runInNewContext(await fs.readFile(path.join(publicRoot, 'data-core/career-visual-content.js'), 'utf8'), context);
const careers = context.window.HI5_ROADMAP_CONTENT.careers;
const direction = {
  D001: 'Original full-color vertical webtoon about a student returning a lost sketchbook. Show the actual webtoon panels or character sheets, not a drawing monitor. Vertical scroll examples can be arranged in successive narrow columns with small numbered reading-order labels.',
  D002: 'Original black-and-white printed short comic about a paper airplane at a riverside. Precise ink and screentone, visible actual pages and purposeful panel layout. No museum or author photos.',
  D003: 'A realistic editorial planning document for an ORIGINAL fictional webtoon, including its own comic thumbnails. Flat legible planning boards, not a photograph of an office. Short Korean labels, synthetic dates and anonymous fictional roles only.',
  D004: 'An original story about two adults finding a missing island map. Real readable story planning and script excerpts with scene thumbnails. Flat finished writing/conte documents, not generic writing desk photos.',
  D005: 'Original hand-drawn 2D animation: young adult in coral jacket and gray trousers. Clearly distinguish drawn frames, keys and breakdown poses. Film/reel tasks use a labeled still-frame montage, never pretend a still image is a playing video.',
  D006: 'Original stylized 3D woman in teal sweatshirt, charcoal pants, dark hair in a bun. Body mechanics shows preparing/lifting/balancing the same heavy wooden crate. Acting shows clear changing emotions. Reel uses distinct rendered scenes and a small wireframe comparison. Fully visible bodies, no lamp statue.',
  D007: 'Original animated coastal adventure with two adult protagonists. Actual storyboards, color scripts and sequence planning frames. Each camera/lighting proposal must show the same world. Stills only, no fake video player.',
  D008: 'Original film storyboard about an adult courier moving through a train station. Grayscale storyboard frames, clear cinematic camera cuts, readable motion arrows. The action, dialogue and animatic tasks must look visibly different.',
  D009: 'Original painterly fantasy game set around a cliffside harbor. Professional game concept art: clearly depict the requested world, exploration, or in-game key scene. Not a poster for an existing game.',
  D010: 'Original female exploration-game cartographer in petrol-blue field coat, coral scarf, ivory trousers, boots, compass and map tube. Consistent anatomy and equipment in FRONT/SIDE/BACK views. Costume variants and expressions are separate task sheets. No existing franchise characters.',
  D011: 'Original environment design for a terraced cliffside harbor with an observatory. Actual wide landscape concept art and requested spatial/lighting/prop studies, not a screen showing art.',
  D012: 'Original game interface for a friendly exploration game: map, quests, inventory and a teal/coral HUD. Only functional game UI is allowed inside the artwork. Show actual screens and components; no physical monitor.',
  D013: 'Original editorial illustration with vivid flat shapes and refined texture; themes of travel, reading and everyday city life. Key art features an original explorer character. Series uses coherent but genuinely different finished illustrations. No existing artist imitation.',
  D014: 'Original simple mascot: a small friendly rounded geometric robot with a yellow face panel and teal body. Character identity must persist across views, expressions and merchandise; no existing brand mascot.',
  D015: 'Original expressive round geometric robot messenger sticker character. Distinct readable emotions, transparent-looking plain white background. Motion tasks show successive animation frames. No fake chat account or real user messages.',
  D016: 'Original illustrated picturebook about two children building a paper boat, in soft gouache and cut-paper texture. Actual dummy spreads, completed story scenes, or character/world sheets as requested; not photos of books on a desk.',
  D017: 'Original contemporary typography/graphic system for a fictional art festival called SHIFT. Coral, cobalt, lemon yellow and white, intentional grids, sharp typography. Show the actual poster series/system/applications at large scale.',
  D018: 'Original fictional stationery brand MORU: folded-paper geometric M monogram, coral and deep teal on white, charcoal type. Consistent logo across identity guide, stationery/packaging applications and campaign. Do not use real IBM/ABC/UPS logos.',
  D019: 'Original editorial design for FIELD magazine and a related nature/design book series. Well-set type, photographs/illustrations and a coherent page grid. Flat front-facing actual spreads and covers; no unrelated room photos.',
  D020: 'Original fictional botanical soap packaging brand LEAF: sage green, coral and white, three varieties. Distinguish finished package series, a usable dieline with cut/fold/glue labels, and assembled prototype views. Show actual package structure accurately.',
  D021: 'Original public-interest campaign about saving water. Strong visual idea using a tap and simple water motif, short clear Korean headline. Separate key visual, multi-format applications, and planning board.',
  D022: 'Original practical library seat reservation app. Realistic task-specific UX research/case-study, wireframe flow, or polished app screens. All charts explicitly synthetic examples, no invented validated research claims. Flat readable screens, no device mockup.',
  D023: 'Original motion design for a fictional culture event called FRAME. Crisp typography, geometric visual rhythm, coral/cyan/black. Show actual sequential style frames or reel contact sheets with time labels, not a still falsely presented as playable video.',
  D024: 'Original short promotional film for a fictional local ceramics workshop. Actual film stills or storyboard/shot-list as requested, coherent visual narrative. No real student identities. Reel represented by honest sequential stills.',
  D025: 'Original portable reading lamp with a compact folding hinge and circular light. Industrial design sketch variations, actual clean 3D product renders, or prototype testing comparison as requested. Make mechanics and proportions plausible.',
  D026: 'Original compact urban electric vehicle, unbranded. Clearly distinct exterior sketch sheet, interior ergonomics design, and future mobility scenario. Human scale, no impossible steering/control layout.',
  D027: 'Original bright neighborhood reading lounge. Actual interior material/concept board, top-down floor plan with coherent circulation, or full-bleed architectural interior rendering as requested. Sage upholstery, white plaster, red accents, avoid generic office photography.',
  D028: 'Original art-book pop-up exhibition. Actual visitor-facing space concept, product display elevation, or floor plan/circulation diagram. Clear physical scale, no illegible crowds of posters.',
  D029: 'Original theater stage for a story about a lighthouse and the sea. Show stage concept, buildable stage plan/model, or the SAME set under several lighting cues. Clearly distinguish design tasks.',
  D030: 'Original contemporary functional clothing collection inspired by folded paper: navy, coral, white and moss. Six coherent outfits, fashion illustration, or accurate front/back technical flats with fabric swatches. Fully clothed adult figures.',
  D031: 'Original textile collection inspired by abstract leaves and woven lines, with main/secondary/accent prints. Distinguish pattern collection, multiple colorways of the SAME repeat, and actual textile product applications. Crisp seams and repeat continuity.',
  D032: 'Original silver and aquamarine jewelry based on interlocking oval forms. Distinguish finished wearable collection, precise three-view/CAD construction, and material/prototype process studies. Realistic geometry, no branded jewelry.',
  D033: 'Original ceramic work in white porcelain, sage glaze and iron-red accents. Distinguish functional stacking tableware, expressive connected sculptural series, and a systematic glaze test tile grid. Full objects, tactile texture.',
  D034: 'Original small-space bent-plywood and steel reading chair. Distinguish concept/use sketches, accurate material/joinery diagrams and assembly sequence, and scale model/full product visualization. Show buildable joints.',
  D035: 'Original AI-assisted museum guide concept. Honest DESIGN PROTOTYPE visualizations only: user-facing interactive service screens, human-review workflow diagram, or proof-of-concept installation storyboard. No claim of real AI processing, real user data, or tested outcomes.',
};

export const jobs = careers.flatMap(career => careerWorks[career.id].map((work, index) => {
  const title = career.visualContent.portfolio.items[index].title;
  const key = `${career.id.toLowerCase()}-${String(index + 1).padStart(2, '0')}`;
  return {
    key, careerId:career.id, careerName:career.name, index, title,
    image:`/data-core/assets/roadmap/works/${key}.webp`,
    alt:`${career.name} · ${title} 과제의 교육용 생성 예시`,
    points:work.portfolio,
    prompt:`Create ONE original educational portfolio ARTWORK, not an infographic about a career, not a web UI mockup. Wide landscape 3:1 aspect ratio, at least 1800 pixels wide. Career: ${career.name}. EXACT SINGLE TASK: ${title}. Task meaning: ${work.about} Visual world/style reference: ${direction[career.id]} ONLY depict the exact task above, not all tasks mentioned in the style reference. The website already renders all explanations, portfolio checklists and artist biographies OUTSIDE this image: do not duplicate those here. Show the ACTUAL finished artwork, design artifact, storyboard or product, filling the canvas edge-to-edge with minimal margins. Let ART dominate, not explanatory text. Do NOT include educational paragraphs, inspirational slogans, summary panels, software logos, biography or tips. For animation pose tasks use just THREE LARGE poses or frames, clear anatomy and visible full bodies, with at most a short label under each. For finished scene/image tasks use a single expansive image. For design sheets, use a maximum of three substantial visual groupings, clean large visual examples and minimal short labels. For actual writing/planning/document tasks ONLY, show the requested readable document with relevant small illustrations and synthetic data clearly marked as examples. For video/reel tasks show a sequence of STILL FRAMES, no playback controls, no claim of a real rendered video. No tiny contact-sheet clutter. Consistent subject across views, no important cropping. No browser chrome, no app header/footer, no WORK labels, no external screenshots, no photo of a desk/monitor displaying art. No real artists' work or copyrighted franchise characters. This is fictional AI-generated educational material. Do not add a signature or attribution.`,
  };
}));

async function readManifest() {
  try { return JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return {schemaVersion:1, generator:'OpenAI built-in image_gen', assets:{}}; }
}

async function refresh(manifest) {
  const result = {};
  for (const job of jobs) {
    const asset = manifest.assets[job.key];
    (result[job.careerId] ||= []).push({
      title:job.title, image:job.image, alt:job.alt, points:job.points,
      width:asset?.width || 1800, height:asset?.height || 600,
      version:asset?.sha256.slice(0,12) || 'pending', available:Boolean(asset),
      provenance:'ai-generated-educational-example',
    });
  }
  await fs.writeFile(outputPath, '// Generated by scripts/prepare-career-work-visuals.mjs. Artist references remain separate.\nexport const careerWorkVisuals = '+JSON.stringify(result,null,2)+';\n');
}

async function main() {
  const [mode, key, source] = process.argv.slice(2);
  const manifest = await readManifest();
  if (mode === '--jobs') { console.log(JSON.stringify(jobs)); return; }
  if (mode === '--image') {
    const job = jobs.find(item => item.key === key);
    if (!job || !source || !path.isAbsolute(source)) throw Error('Use --image d001-01 absolute-generated-source');
    const previous = manifest.assets[key];
    const sourceBytes = await fs.readFile(source);
    const input = await sharp(sourceBytes).metadata();
    if (!input.width || !input.height || input.width / input.height < 2 || input.width / input.height > 4) throw Error('Expected a wide artwork, not a portrait or UI screenshot');
    const bytes = await sharp(sourceBytes).rotate().resize({width:1800,withoutEnlargement:true}).webp({quality:84,effort:5}).toBuffer();
    const metadata = await sharp(bytes).metadata();
    const destination = path.join(publicRoot, job.image);
    await fs.mkdir(path.dirname(destination), {recursive:true});
    await fs.writeFile(destination, bytes, {flag:previous ? 'w' : 'wx'});
    manifest.assets[key] = {careerId:job.careerId, workIndex:job.index, title:job.title, image:job.image, width:metadata.width, height:metadata.height, bytes:bytes.length, sha256:hash(bytes), originalSha256:hash(sourceBytes), prompt:job.prompt, generatedAt:new Date().toISOString(), ...(previous ? {supersedes:previous.sha256} : {})};
    await fs.writeFile(manifestPath, JSON.stringify(manifest,null,2)+'\n');
  } else if (mode === '--check') {
    for (const job of jobs) {
      const asset = manifest.assets[job.key];
      if (!asset) throw Error(`Missing generated artwork ${job.key}`);
      const bytes = await fs.readFile(path.join(publicRoot, job.image));
      if (hash(bytes) !== asset.sha256) throw Error(`Hash mismatch ${job.key}`);
    }
    console.log(JSON.stringify({careers:careers.length, works:jobs.length, verified:jobs.length}));
    return;
  } else if (mode && mode !== '--refresh') throw Error('Unknown mode');
  await refresh(manifest);
  console.log(JSON.stringify({completed:Object.keys(manifest.assets).length,total:jobs.length}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
