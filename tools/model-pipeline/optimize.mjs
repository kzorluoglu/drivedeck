// Shrinks a car GLB for the T-Box: welds, optionally simplifies, resizes textures to 1024 px and
// applies meshopt compression. Named pivot nodes (wheel-*, door-*) are kept as they are.
//
//   node optimize.mjs <input.glb> <output.glb> [ratio=1.0] [error=0.0005]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [input, output, ratio = '1.0', error = '0.0005'] = process.argv.slice(2);
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);

const steps = [dedup(), weld()];
if (Number(ratio) < 1) {
  steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: Number(ratio), error: Number(error) }));
}
steps.push(textureCompress({ encoder: sharp, resize: [1024, 1024] }), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await doc.transform(...steps);

const root = doc.getRoot();
let triangles = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    triangles += (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;
  }
}
const pivots = root.listNodes().map((n) => n.getName()).filter((n) => /^(wheel|door)-[a-z-]+$/.test(n) && !n.endsWith('-mesh'));
console.log(`triangles ${triangles}, pivots: ${pivots.join(', ')}`);
await io.write(output, doc);
