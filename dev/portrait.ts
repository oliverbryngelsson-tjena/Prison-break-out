// Renders a lit head-and-shoulders portrait of a character (used for the lobby cards).
// ?id=elias&variant=civil&anim=idle_look
import * as THREE from 'three';
import { CharacterLibrary } from '../src/engine/characters';
import { loadEnvironment } from '../src/engine/assets';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const bg = document.createElement('canvas');
bg.width = 4; bg.height = 256;
const g = bg.getContext('2d')!;
const grad = g.createLinearGradient(0, 0, 0, 256);
grad.addColorStop(0, q.get('top') || '#2a2622'); grad.addColorStop(1, q.get('bottom') || '#0c0b0a');
g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
const bgTex = new THREE.CanvasTexture(bg); bgTex.colorSpace = THREE.SRGBColorSpace;
scene.background = bgTex;
const cam = new THREE.PerspectiveCamera(24, innerWidth / innerHeight, 0.05, 50);
const key = new THREE.DirectionalLight(0xffd6b0, 3.2); key.position.set(-1.5, 2.6, 2.2); key.castShadow = true; scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc0ff, 2.4); rim.position.set(2.0, 2.2, -2.0); scene.add(rim);
scene.add(new THREE.HemisphereLight(0x8a90a0, 0x1a1410, 0.5));
(async () => {
  try { const env = await loadEnvironment('env/hangar.hdr'); scene.environment = env; scene.environmentIntensity = 0.35; } catch { /* optional */ }
  const lib = new CharacterLibrary();
  await lib.init();
  const c = await lib.create(q.get('id') || 'elias', q.get('variant') || 'civil');
  c.root.rotation.y = Number(q.get('yaw') || 0.35);
  scene.add(c.root);
  c.play(q.get('anim') || 'idle_look', { loop: true, fade: 0 });
  for (let i = 0; i < 30; i++) c.update(Number(q.get('t') || 0.05));
  c.root.updateMatrixWorld(true);
  const head = c.bone('Bip01_Head')!.getWorldPosition(new THREE.Vector3());
  cam.position.set(head.x + 0.15, head.y - 0.02, head.z + 1.55);
  cam.lookAt(head.x, head.y - 0.12, head.z);
  renderer.render(scene, cam);
  (window as unknown as { __ready: boolean }).__ready = true;
})();
