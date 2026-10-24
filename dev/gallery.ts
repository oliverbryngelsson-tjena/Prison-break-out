// Model gallery for asset review. ?from=0&count=12
import * as THREE from 'three';
import { loadGLTF, initKTX2 } from '../src/engine/assets';
const p = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
initKTX2(renderer);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a3f47);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
const d = new THREE.DirectionalLight(0xffffff, 2.5); d.position.set(3, 5, 4); scene.add(d);
const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 200);
(async () => {
  const list: string[] = await (await fetch('/_staging/index.json')).json();
  const from = +(p.get('from') || 0), count = +(p.get('count') || 12);
  const items = (p.get('files')?.split(',') ?? list.slice(from, from + count));
  const cols = 4;
  for (let i = 0; i < items.length; i++) {
    try {
      const g = await loadGLTF('/_staging/' + items[i]);
      const o = g.scene;
      const box = new THREE.Box3().setFromObject(o);
      const size = box.getSize(new THREE.Vector3());
      const s = 1.6 / Math.max(size.x, size.y, size.z);
      o.scale.setScalar(s);
      const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
      const holder = new THREE.Group();
      o.position.sub(c);
      holder.add(o);
      holder.position.set((i % cols) * 2.2 - (cols - 1) * 1.1, -Math.floor(i / cols) * 2.2 + 2.2, 0);
      holder.rotation.y = -0.6;
      scene.add(holder);
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64;
      const ctx = cv.getContext('2d')!; ctx.fillStyle = '#ff0'; ctx.font = '28px sans-serif';
      ctx.fillText(items[i] + ` ${size.x.toFixed(1)}x${size.y.toFixed(1)}x${size.z.toFixed(1)}`, 4, 40);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv) }));
      spr.scale.set(2, 0.25, 1); spr.position.copy(holder.position).add(new THREE.Vector3(0, -0.95, 0.5));
      scene.add(spr);
    } catch (e) { console.error('fail', items[i], e); }
  }
  cam.position.set(0, 0, 13); cam.lookAt(0, 0, 0);
  (window as any).__ready = true;
})();
(function loop() { renderer.render(scene, cam); requestAnimationFrame(loop); })();
