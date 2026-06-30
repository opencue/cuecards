import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { test, expect } from 'vitest';

test('Button component file exists', () => {
  expect(existsSync('src/Button.tsx')).toBe(true);
});

test('Button accepts label and onClick props', () => {
  const src = readFileSync('src/Button.tsx', 'utf-8');
  expect(src).toContain('label');
  expect(src).toContain('onClick');
});

test('index re-exports Button', () => {
  const idx = readFileSync('src/index.ts', 'utf-8');
  expect(idx).toMatch(/Button/);
});

test('project builds', () => {
  // Throws (and fails the test) if the build fails.
  execSync('npm run build', { stdio: 'pipe' });
});
