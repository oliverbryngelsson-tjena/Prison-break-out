// Writes CREDITS.md from public/assets/credits.json (the same data the in-game Credits screen shows).
import fs from 'node:fs';
const c = JSON.parse(fs.readFileSync('public/assets/credits.json', 'utf8'));
const groups = [['character', 'Characters'], ['animation', 'Animations'], ['image', 'Images'], ['model', '3D models'], ['texture', 'Textures'], ['hdri', 'Environment maps (HDRI)'], ['audio', 'Sound and music']];
let md = '# Credits\n\nEvery third-party asset in this game, with its author, source and licence. All characters, story and dialogue are original and fictional.\n\n';
md += 'Generated from `public/assets/credits.json` by `node tools/credits-md.mjs`. The same list is shown in the game under **Credits**.\n\n';
for (const [k, title] of groups) {
  const items = c.filter((x) => x.kind === k);
  if (!items.length) continue;
  md += `## ${title}\n\n| Asset | Author | Licence | Obtained via |\n|---|---|---|---|\n`;
  for (const x of items) md += `| [${x.title.replace(/\|/g, '/')}](${x.link}) | ${x.author.replace(/\|/g, '/')} | [${x.license}](${x.licenseUrl}) | ${(x.via ?? '').replace(/\|/g, '/')} |\n`;
  md += '\n';
}
md += '## Software\n\nthree.js (MIT) · postprocessing (Zlib) · PeerJS (MIT) · ws (MIT) · glTF-Transform (MIT) · meshoptimizer (MIT) · EZ-Tree (MIT) · Vite (MIT) · TypeScript (Apache-2.0)\n';
fs.writeFileSync('CREDITS.md', md);
console.log('CREDITS.md:', c.length, 'entries');
