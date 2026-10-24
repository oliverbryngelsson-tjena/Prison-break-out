import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const root = doc.getRoot();
console.log('meshes', root.listMeshes().length, 'nodes', root.listNodes().length);
for (const a of root.listAnimations()) {
  console.log('anim', a.getName(), 'channels', a.listChannels().length);
  const by = {};
  for (const c of a.listChannels()) {
    const n = c.getTargetNode().getName(); const p = c.getTargetPath();
    const s = c.getSampler(); const out = s.getOutput(); const inp = s.getInput();
    const arr = out.getArray(); const sz = out.getElementSize();
    let mn = [], mx = [];
    for (let k = 0; k < sz; k++) { mn[k] = Infinity; mx[k] = -Infinity; }
    for (let i = 0; i < out.getCount(); i++) for (let k = 0; k < sz; k++) { mn[k] = Math.min(mn[k], arr[i*sz+k]); mx[k] = Math.max(mx[k], arr[i*sz+k]); }
    const range = mx.map((v,k)=>+(v-mn[k]).toFixed(4));
    if (/^Bip01$|Pelvis|Footsteps|Spine$|Thigh|Calf/.test(n) || process.argv[3]) console.log(' ', n, p, 'keys', inp.getCount(), 'dur', inp.getMax([])[0].toFixed(2), 'range', range.join(','), 'first', Array.from(arr.slice(0,sz)).map(x=>+x.toFixed(3)).join(','));
  }
}
