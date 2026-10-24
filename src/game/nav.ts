// Waypoint navigation graph with A* for NPCs.
import * as THREE from 'three';
import type { CollisionWorld } from '../engine/physics';

export class NavGraph {
  readonly nodes: THREE.Vector3[] = [];
  readonly edges: number[][] = [];

  constructor(private physics: CollisionWorld) {}

  add(x: number, y: number, z: number): number {
    this.nodes.push(new THREE.Vector3(x, y, z));
    this.edges.push([]);
    return this.nodes.length - 1;
  }

  link(a: number, b: number): void {
    if (!this.edges[a].includes(b)) this.edges[a].push(b);
    if (!this.edges[b].includes(a)) this.edges[b].push(a);
  }

  /** Connect nodes that can see each other at walking height. */
  autoLink(maxDist = 14, maxDy = 0.6): void {
    for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
      const a = this.nodes[i], b = this.nodes[j];
      if (a.distanceTo(b) > maxDist || Math.abs(a.y - b.y) > maxDy) continue;
      if (this.clear(a, b)) this.link(i, j);
    }
  }

  /** Walkable straight line between points (checks at knee and chest height, with some width). */
  clear(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(0.25);
    for (const h of [0.5, 1.2]) for (const s of [-1, 1]) {
      const p = a.clone().add(new THREE.Vector3(0, h, 0)).addScaledVector(side, s);
      const q = b.clone().add(new THREE.Vector3(0, h, 0)).addScaledVector(side, s);
      const d = q.clone().sub(p);
      const len = d.length();
      if (len < 1e-3) continue;
      if (this.physics.raycast(p, d.divideScalar(len), len, (x) => x.solid, false)) return false;
    }
    return true;
  }

  nearest(p: THREE.Vector3, needClear = true): number {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (Math.abs(n.y - p.y) > 1.5) continue;
      const d = n.distanceToSquared(p);
      if (d < bd && (!needClear || this.clear(p, n))) { bd = d; best = i; }
    }
    if (best < 0 && needClear) return this.nearest(p, false);
    return best;
  }

  /** Returns a list of points from `from` to `to` (excluding `from`). */
  path(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    if (Math.abs(from.y - to.y) < 0.6 && this.clear(from, to)) return [to.clone()];
    if (!this.nodes.length) return [to.clone()];
    const s = this.nearest(from), g = this.nearest(to);
    if (s < 0 || g < 0) return [to.clone()];
    const open = new Set([s]);
    const came = new Map<number, number>();
    const gs = new Map<number, number>([[s, 0]]);
    const fs = new Map<number, number>([[s, this.nodes[s].distanceTo(this.nodes[g])]]);
    while (open.size) {
      let cur = -1, bf = Infinity;
      for (const n of open) { const f = fs.get(n) ?? Infinity; if (f < bf) { bf = f; cur = n; } }
      if (cur === g) break;
      open.delete(cur);
      for (const nb of this.edges[cur]) {
        const t = (gs.get(cur) ?? Infinity) + this.nodes[cur].distanceTo(this.nodes[nb]);
        if (t < (gs.get(nb) ?? Infinity)) {
          came.set(nb, cur);
          gs.set(nb, t);
          fs.set(nb, t + this.nodes[nb].distanceTo(this.nodes[g]));
          open.add(nb);
        }
      }
    }
    const out: THREE.Vector3[] = [to.clone()];
    let c = g;
    if (!came.has(g) && g !== s) return [this.nodes[s].clone(), to.clone()];
    while (c !== s && c !== undefined) { out.unshift(this.nodes[c].clone()); c = came.get(c)!; }
    out.unshift(this.nodes[s].clone());
    // Skip the first node if we can already see the second.
    while (out.length > 1 && this.clear(from, out[1]) && Math.abs(from.y - out[1].y) < 0.6) out.shift();
    return out;
  }
}
