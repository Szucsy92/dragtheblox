import { describe, expect, it } from 'vitest';

// The Android app must work with no network at all: the offline entry must not reference anything remote.
const raw = (m: Record<string, string>) => Object.values(m)[0] ?? '';
const html = raw(import.meta.glob<string>('../../native-web/index.html', { query: '?raw', import: 'default', eager: true }));
const entry = raw(import.meta.glob<string>('../../native-web/main.tsx', { query: '?raw', import: 'default', eager: true }));
const css = raw(import.meta.glob<string>('../styles.css', { query: '?raw', import: 'default', eager: true }));

describe('offline Android bundle', () => {
  it('has an entry page that loads nothing from the network', () => {
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('./main.tsx');
  });

  it('mounts only the game, without the router or server code', () => {
    expect(entry).toContain('Playroom');
    expect(entry).not.toMatch(/tanstack|react-router|react-start|fetch\(/i);
  });

  it('keeps the stylesheet free of remote imports', () => {
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/@import\s+(url\()?\s*["']?https?:/);
  });
});
