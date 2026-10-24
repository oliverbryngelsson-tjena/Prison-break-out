// Chapter registry.
import type { Chapter } from './chapter';
import { Chapter1 } from './ch1';

export const CHAPTERS: Array<{ num: number; title: string; make: () => Chapter }> = [
  { num: 1, title: 'Prison Life', make: () => new Chapter1() },
];

export function createChapter(n: number): Chapter {
  const c = CHAPTERS.find((x) => x.num === n) ?? CHAPTERS[0];
  return c.make();
}

export const CHAPTER_TITLES: Record<number, string> = {
  1: 'Prison Life',
  2: 'The Breakout',
  3: 'On the Run',
  4: 'The Revenge',
  5: 'The Chase',
  6: 'The Betrayal',
};
