import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const pr = (n, d) => {
  const m = n.getMesh();
  let tris = 0; if (m) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? 0) / 3;
  const b = m ? getBounds(n) : null;
  console.log(' '.repeat(d * 2) + n.getName(), 'T', n.getTranslation().map((x) => +x.toFixed(3)).join(','), 'R', n.getRotation().map((x) => +x.toFixed(3)).join(','), 'S', n.getScale().map((x) => +x.toFixed(3)).join(','), m ? `mesh tris=${tris} mats=${m.listPrimitives().map(p=>p.getMaterial()?.getName()).join('|')} bmin=${b.min.map(x=>x.toFixed(2))} bmax=${b.max.map(x=>x.toFixed(2))}` : '');
  for (const c of n.listChildren()) pr(c, d + 1);
};
for (const s of doc.getRoot().listScenes()) for (const n of s.listChildren()) pr(n, 0);
console.log('materials', doc.getRoot().listMaterials().map((m) => m.getName()).join(', '));
console.log('textures', doc.getRoot().listTextures().map((t) => t.getName() + ':' + t.getSize()).join(', '));
