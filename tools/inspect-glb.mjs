import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
for (const m of root.listMeshes()) {
  let v=0; for (const p of m.listPrimitives()) v+=p.getAttribute('POSITION').getCount();
  console.log('mesh', m.getName(), 'prims', m.listPrimitives().length, 'verts', v, 'mats', m.listPrimitives().map(p=>p.getMaterial()?.getName()).join(','));
}
for (const n of root.listNodes()) if (n.getMesh()) console.log('meshnode', n.getName(), 'skin', !!n.getSkin(), n.getSkin()?.listJoints().length);
for (const t of root.listTextures()) console.log('tex', t.getName(), t.getMimeType(), t.getImage()?.byteLength, t.getSize());
for (const mat of root.listMaterials()) console.log('mat', mat.getName(), mat.getAlphaMode(), !!mat.getBaseColorTexture(), !!mat.getNormalTexture(), !!mat.getMetallicRoughnessTexture());
console.log('skins', root.listSkins().length, 'nodes', root.listNodes().length, 'anims', root.listAnimations().length);
