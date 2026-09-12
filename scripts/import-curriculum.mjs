import { main } from './import-curriculum-tree.mjs';

const args=process.argv.slice(2);
// The short command previews the central store. Writes always require an explicit --apply.
if(!args.some(a=>['--preview','--apply','--verify'].includes(a)))args.push('--preview');
if(!args.includes('--remote'))args.push('--remote');
await main(args).catch(e=>{console.error(e.message);process.exitCode=1;});
