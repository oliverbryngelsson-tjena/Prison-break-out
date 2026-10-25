// Chapter registry.
import type { Chapter } from './chapter';
import { Chapter1 } from './ch1';
import { Chapter2 } from './ch2';
import { Chapter3 } from './ch3';
import { Chapter4 } from './ch4';
import { Chapter5 } from './ch5';
import { Chapter6 } from './ch6';

export const CHAPTERS: Array<{ num: number; title: string; make: () => Chapter }> = [
  { num: 1, title: 'Prison Life', make: () => new Chapter1() },
  { num: 2, title: 'The Breakout', make: () => new Chapter2() },
  { num: 3, title: 'On the Run', make: () => new Chapter3() },
  { num: 4, title: 'The Brother', make: () => new Chapter4() },
  { num: 5, title: 'The Garage', make: () => new Chapter5() },
  { num: 6, title: 'The Getaway', make: () => new Chapter6() },
];

export function createChapter(n: number): Chapter {
  const c = CHAPTERS.find((x) => x.num === n) ?? CHAPTERS[0];
  return c.make();
}

export const CHAPTER_TITLES: Record<number, string> = {
  1: 'Prison Life',
  2: 'The Breakout',
  3: 'On the Run',
  4: 'The Brother',
  5: 'The Garage',
  6: 'The Getaway',
};
