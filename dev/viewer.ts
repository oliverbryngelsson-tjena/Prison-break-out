// Development asset viewer: renders characters with animations for visual checks.
// URL params: ?chars=elias:prison,jax:civil&anim=walk&cam=front|side|close
import * as THREE from 'three';
import { CharacterLibrary, solveTwoBone, type CharacterModel } from '../src/engine/characters';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x30343a);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 100);
const hemi = new THREE.HemisphereLight(0xdde6ff, 0x3a3228, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -6; sun.shadow.camera.right = 6; sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xaaccff, 0.6);
fill.position.set(-4, 3, -2);
scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
// Axis markers: red = +X, blue = +Z
scene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.01, 0), 1, 0xff0000));
scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.01, 0), 1, 0x0000ff));

const lib = new CharacterLibrary();
const chars: CharacterModel[] = [];
const spec = (params.get('chars') || 'elias:prison,jax:prison,elias:civil,jax:civil').split(',');
const anim = params.get('anim') || 'idle';
const speed = parseFloat(params.get('speed') || '0');

(async () => {
  await lib.init();
  let x = -(spec.length - 1) * 0.45;
  for (const s of spec) {
    const [id, variant] = s.split(':');
    const c = await lib.create(id, variant);
    c.root.position.x = x;
    x += 0.9;
    scene.add(c.root);
    if (params.get('ik')) {
      c.postHooks.push((m) => {
        m.root.updateMatrixWorld(true);
        const chest = m.bone('Bip01_Spine2')!.getWorldPosition(new THREE.Vector3());
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(m.root.quaternion);
        const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(m.root.quaternion);
        const ext = parseFloat(params.get('ik')!);
        // right hand punches forward, left hand guards the chin
        const tR = chest.clone().addScaledVector(fwd, 0.25 + 0.4 * ext).addScaledVector(right, 0.18 - 0.12 * ext).add(new THREE.Vector3(0, 0.22, 0));
        const tL = chest.clone().addScaledVector(fwd, 0.3).addScaledVector(right, -0.12).add(new THREE.Vector3(0, 0.3, 0));
        solveTwoBone(m.bone('Bip01_R_UpperArm')!, m.bone('Bip01_R_Forearm')!, m.bone('Bip01_R_Hand')!, tR, new THREE.Vector3(0, -1, 0).addScaledVector(right, 0.8));
        solveTwoBone(m.bone('Bip01_L_UpperArm')!, m.bone('Bip01_L_Forearm')!, m.bone('Bip01_L_Hand')!, tL, new THREE.Vector3(0, -1, 0).addScaledVector(right, -0.8));
        const axis = params.get('fax') || 'z';
        const amt = parseFloat(params.get('fang') || '1.2');
        for (const side of ['L', 'R']) for (const f of ['1', '2', '3', '4']) for (const seg of ['', '1', '2']) {
          const b = m.bone(`Bip01_${side}_Finger${f}${seg}`);
          if (b) (b as any)['rotate' + axis.toUpperCase()](amt * (seg === '' ? 0.8 : 1));
        }
      });
    }
    if (speed > 0) c.setLocomotion(speed);
    else if (anim !== 'idle') c.play(anim, { fade: 0 });
    chars.push(c);
  }
  const cam = params.get('cam') || 'front';
  const n = spec.length;
  if (cam === 'front') { camera.position.set(0, 1.3, 2.2 + n * 0.9); camera.lookAt(0, 1.0, 0); }
  if (cam === 'side') { camera.position.set(5 + n, 1.2, 0); camera.lookAt(0, 0.9, 0); }
  if (cam === 'side34') { camera.position.set(2.2, 1.6, 2.2); camera.lookAt(0, 1.2, 0); }
  if (cam === 'close') { camera.position.set(chars[0].root.position.x, 1.62, 0.75); camera.lookAt(chars[0].root.position.x, 1.6, 0); }
  if (cam === 'back') { camera.position.set(0, 1.3, -(2.2 + n * 0.9)); camera.lookAt(0, 1.0, 0); }
  const t0 = parseFloat(params.get('t') || '0.5');
  for (const c of chars) c.update(t0);
  (window as unknown as { __ready: boolean }).__ready = true;
})();

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (params.get('animate') === '1') for (const c of chars) c.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
