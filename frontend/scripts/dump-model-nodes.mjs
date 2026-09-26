import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { analyzeModel } from '../src/lib/analyzeModel.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.self ??= globalThis;

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'public', 'chess-themes', '3d');
const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/dump-model-nodes.mjs <model-file.glb>');
  process.exit(1);
}

const buf = fs.readFileSync(path.join(dir, file));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const gltf = await new GLTFLoader().parseAsync(ab, dir + '/');
const scene = gltf.scene;
scene.updateMatrixWorld(true);

let analysis = null;
try {
  analysis = analyzeModel(scene.clone(), file);
} catch (e) {
  analysis = { playable: false, error: String(e?.message || e) };
}
console.log(`verdict: playable=${!!analysis?.playable} pieces=${analysis?.pieceCount ?? '?'} clusters=${analysis?.clusterCount ?? '?'}`);

const rows = [];
scene.traverse((node) => {
  if (!node.name) return;
  if (node.isMesh) {
    const box = new THREE.Box3().setFromObject(node);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    rows.push({
      kind: 'mesh',
      name: node.name,
      parent: node.parent?.name || '',
      cx: +c.x.toFixed(2), cy: +c.y.toFixed(2), cz: +c.z.toFixed(2),
      sx: +size.x.toFixed(2), sy: +size.y.toFixed(2), sz: +size.z.toFixed(2),
    });
  } else if (node.type === 'Group' && node.children.length) {
    const box = new THREE.Box3().setFromObject(node);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    rows.push({
      kind: 'group',
      name: node.name,
      parent: node.parent?.name || '',
      cx: +c.x.toFixed(2), cy: +c.y.toFixed(2), cz: +c.z.toFixed(2),
      sx: +size.x.toFixed(2), sy: +size.y.toFixed(2), sz: +size.z.toFixed(2),
    });
  }
});
rows.sort((a, b) => a.cz - b.cz || a.cx - b.cx);
rows.forEach((r) => {
  console.log(
    `[${r.kind}] "${r.name}" parent="${r.parent}" ` +
    `center=(${r.cx}, ${r.cy}, ${r.cz}) size=(${r.sx}, ${r.sy}, ${r.sz})`
  );
});
