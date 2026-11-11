import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const rule = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]+)\\}`));
  assert.ok(match, `Missing rule: ${selector}`);
  return match[1];
};

test('Scout palette and shared system typography remain explicit', () => {
  assert.match(css, /--font-sans: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";/);
  for (const [token, value] of Object.entries({ ink:'#111827', heading:'#111827', muted:'#475569', secondary:'#64748b', green:'#009a4d', 'green-dark':'#008241', bg:'#f8fafc' })) {
    assert.ok(css.includes(`--${token}: ${value};`), token);
  }
  assert.doesNotMatch(css, /\bInter\b|font-synthesis\s*:\s*none/);
  for (const [, weight] of css.matchAll(/font-weight:\s*(\d+)/g)) assert.ok(['400','600','700','900'].includes(weight), weight);
  assert.match(rule('h1'), /font-weight: 900/);
  assert.match(rule('button, input, textarea, select'), /font: inherit/);
});

test('body, inputs and important restrictions use readable shared roles', () => {
  assert.match(css, /--text-body: clamp\(\.9375rem,[^;]+1rem\);/);
  assert.match(css, /--text-input: 1rem;/);
  assert.match(css, /--text-note: \.875rem;/);
  assert.match(css, /--text-small: \.75rem;/);
  for (const selector of ['.consent','.result-disclaimer','.field-note','.ai-status']) assert.match(rule(selector), /font-size: var\(--text-note\)/);
  assert.match(rule('.message'), /font-size: var\(--text-body\)/);
  assert.match(rule('input, select, textarea'), /font-size: var\(--text-input\)/);
  assert.match(rule('.measure-card > p, .case-card > p'), /font-size: var\(--text-body\)/);
});

test('headings wrap naturally and use one fluid scale', () => {
  for (const level of ['h1','h2','h3']) {
    assert.match(css, new RegExp(`--text-${level}: clamp\\(`));
    assert.equal([...css.matchAll(new RegExp(`(?:^|\\n)${level} \\{`, 'g'))].length, 1);
  }
  for (const [, content] of html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)) assert.doesNotMatch(content, /<br\b/i);
  assert.match(rule('h1, h2, h3'), /letter-spacing: -\.025em/);
  assert.doesNotMatch(rule('body'), /overflow-x:\s*(hidden|clip)/);
  assert.doesNotMatch(rule('.dashboard-card'), /transform:/);
  assert.doesNotMatch(rule('.float-pill'), /transform:/);
  assert.doesNotMatch(rule('.floating-proof'), /transform:/);
});

test('controls and cards retain reflow-friendly dimensions', () => {
  for (const selector of ['.filter','.measure-select','.icon-button','.case-button','.link-button']) assert.match(rule(selector), /(?:min-height|height): 44px/);
  assert.match(rule('.button'), /min-height: 48px/);
  assert.match(rule('select, dialog input'), /min-height: 48px/);
  assert.match(rule('.measure-card, .case-card'), /display: flex; flex-direction: column/);
  assert.doesNotMatch(rule('.measure-card > p, .case-card > p'), /(?:^|[;\s])(?:min-)?height:/);
  assert.match(rule('.measure-meta'), /margin-top: auto/);
  assert.match(rule('.case-result'), /margin-top: auto/);
  assert.match(rule('.result-number'), /overflow-wrap: anywhere/);
  assert.match(rule('dialog'), /max-height: calc\(100dvh - 32px\)/);
});
