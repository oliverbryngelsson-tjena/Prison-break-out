// 3D background for the main menu: a dim cell at night with both characters.
import { aspectZoom } from '../engine/camera';
import * as THREE from 'three';
import { World } from '../game/world';
import { Kit } from '../levels/kit';
import type { MaterialLib } from '../engine/materials';
import type { CharacterLibrary, CharacterModel } from '../engine/characters';
import type { AudioManager } from '../engine/audio';
import type { QualitySettings } from '../engine/quality';

export class MenuScene {
  world: World;
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
  private models: CharacterModel[] = [];
  private t = 0;
  private kit: Kit;
  private flicker: THREE.PointLight | null = null;

  constructor(mats: MaterialLib, chars: CharacterLibrary, audio: AudioManager, q: QualitySettings) {
    this.world = new World(mats, chars, audio, q);
    this.kit = new Kit(this.world);
  }

  async build(): Promise<void> {
    const w = this.world;
    await w.init();
    const L = w.mats;
    await w.setEnvironment({
      hdr: 'env/night_city.hdr', envIntensity: 0.25, background: 0x07090c,
      fog: { color: 0x07090c, density: 0.06 },
      hemi: { sky: 0x2a3a52, ground: 0x120e0a, intensity: 0.25 },
      sun: { color: 0x8fb0ff, intensity: 1.1, dir: [-0.5, 0.75, 0.45], shadows: true },
      grade: { saturation: 0.85, contrast: 1.08, shadowTint: [0.9, 0.97, 1.12], highlightTint: [1.08, 1.0, 0.9], exposure: 1.05, bloom: 0.9, vignette: 0.6 },
    });
    const kit = this.kit;
    kit.ao = { floors: [0], ceilings: [2.9], strength: 0.55, range: 0.7 };
    const [floorM, wallM, steel, concrete] = await Promise.all([
      L.pbr('concrete_floor', { scale: 0.4, roughness: 0.95 }),
      L.pbr('painted_plaster', { scale: 0.5, color: 0x5c7a66, roughness: 0.85 }),
      L.pbr('steel', { scale: 1, color: 0x5d6165, metalness: 0.7, roughness: 0.5 }),
      L.pbr('concrete_grey', { scale: 0.4, color: 0x8a877f }),
    ]);
    const bulbM = L.emissive(0xffc98a, 4);
    // Cell: x[-1.4,1.4], z[-2,2] with bars on z=+2 (camera outside).
    kit.floor(floorM, -4, -2.2, 4, 5, 0, 0.2);
    kit.wall(wallM, -1.4, -2, 1.4, -2, 0, 2.9, 0.25, [{ at: 1.9, width: 0.7, bottom: 1.8, top: 2.3 }]);
    kit.wall(wallM, -1.4, 2, -1.4, -2, 0, 2.9, 0.25);
    kit.wall(wallM, 1.4, -2, 1.4, 2, 0, 2.9, 0.25);
    kit.ceiling(concrete, -1.6, -2.2, 1.6, 2.2, 2.9);
    kit.bars(steel, -1.4, 2, 1.4, 2, 0, 2.9, 0.14);
    kit.box(steel, [0, 2.85, 2], [2.8, 0.1, 0.12]);
    kit.box(steel, [0, 0.03, 2], [2.8, 0.06, 0.12]);
    // Corridor outside
    kit.wall(concrete, -4, 5, 4, 5, 0, 3.4, 0.3);
    kit.bars(steel, 0.42, -2.03, 0.78, -2.03, 1.8, 0.5, 0.09);
    kit.bulb(bulbM, steel, 1.15, 2.45, -0.2, 0xffb070, 3.2, 6);
    const bed = await w.model('bed_iron');
    kit.place(bed, [-0.72, 0, -0.55], Math.PI / 2, 0.92);
    const toilet = await w.model('toilet');
    kit.place(toilet, [1.0, 0, -1.6], Math.PI, 1);
    // Window light shaft
    kit.shaft([0.6, 2.05, -1.95], new THREE.Vector3(-0.35, -0.75, 0.55).normalize(), 0.6, 3.4, 0xb8ccff, 0.07);
    kit.finish();
    this.flicker = new THREE.PointLight(0xffb070, 3.2, 6, 2);
    this.flicker.position.set(1.15, 2.4, -0.2);
    this.flicker.castShadow = w.q.shadows;
    this.flicker.shadow.mapSize.set(512, 512);
    this.flicker.shadow.bias = -0.002;
    w.scene.add(this.flicker);
    // Characters
    const chars = w.chars;
    const [elias, jax] = await Promise.all([chars.create('elias', 'prison'), chars.create('jax', 'prison')]);
    elias.root.position.set(-0.55, 0, -0.35);
    elias.root.rotation.y = Math.PI / 2 + 0.25;
    jax.root.position.set(0.62, 0, 0.95);
    jax.root.rotation.y = -Math.PI * 0.72;
    for (const m of [elias, jax]) {
      m.root.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true; } });
      w.scene.add(m.root);
      this.models.push(m);
    }
    await chars.ensureClips('m');
    elias.play('sit_chair_nervous', { loop: true, fade: 0 });
    jax.play('idle_look', { loop: true, fade: 0 });
    jax.lookTarget = new THREE.Vector3(-0.5, 1.2, -0.3);
    elias.lookTarget = new THREE.Vector3(0.6, 1.6, 0.9);
    this.camera.position.set(0.3, 1.45, 4.4);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.zoom = aspectZoom(this.camera.fov, w / h);
    // Frame the cell to the right of the menu column on wide screens; centred (menu below) in portrait.
    if (h > w) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, -w * 0.14, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    const c = this.camera;
    c.position.set(0.3 + Math.sin(t * 0.07) * 0.5, 1.4 + Math.sin(t * 0.11) * 0.06, 4.3 + Math.cos(t * 0.07) * 0.25);
    c.lookAt(0.05, 1.0, 0);
    if (this.flicker) {
      const f = Math.sin(t * 13) * Math.sin(t * 3.1) > 0.92 ? 0.35 : 1;
      this.flicker.intensity = 3.2 * f;
    }
    for (const m of this.models) m.update(dt);
    this.world.update(dt);
    this.world.updateShadowFocus(new THREE.Vector3(0, 0, 0));
  }

  dispose(): void {
    for (const m of this.models) m.root.removeFromParent();
    this.world.dispose();
  }
}
