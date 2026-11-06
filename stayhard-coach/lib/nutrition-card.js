// Nutrition card: today's totals vs. target as a PNG.
// Built with React.createElement (no JSX build step) and rendered by
// next/og's ImageResponse (satori + resvg). Satori rule: any element with
// more than one child must set display: 'flex'.

import { createElement as h } from 'react';
import { ImageResponse } from 'next/og';

export const CARD_WIDTH = 1080;

const C = {
  bg: '#0b0b0c', panel: '#151517', track: '#26262a', text: '#f4f4f5', dim: '#8b8b93',
  red: '#ff3b30', protein: '#00e676', carbs: '#4a9eff', fat: '#ff7043', over: '#ffd600',
};

const fmt = (n) => Math.round(n ?? 0).toLocaleString('en-US');

export function prettyDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

const box = (style, ...children) => h('div', { style: { display: 'flex', ...style } }, ...children);
const text = (style, value) => h('div', { style: { display: 'flex', ...style } }, String(value));

function bar(pct, color) {
  const w = Math.max(0, Math.min(pct, 1)) * 100;
  return box(
    { width: '100%', height: 18, background: C.track, borderRadius: 9, overflow: 'hidden' },
    box({ width: `${w}%`, height: '100%', background: pct > 1.05 ? C.over : color, borderRadius: 9 }),
  );
}

function macroRow(label, value, target, unit, color) {
  const pct = target ? value / target : 0;
  return box(
    { flexDirection: 'column', width: '100%', gap: 10 },
    box(
      { justifyContent: 'space-between', alignItems: 'baseline', width: '100%' },
      text({ fontSize: 30, color: C.text, fontWeight: 700 }, label),
      box(
        { alignItems: 'baseline', gap: 8 },
        text({ fontSize: 34, color: pct > 1.05 ? C.over : C.text, fontWeight: 700 }, `${fmt(value)}${unit}`),
        text({ fontSize: 26, color: C.dim }, target ? `/ ${fmt(target)}${unit}` : '/ no target'),
      ),
    ),
    bar(pct, color),
  );
}

// Protein always shows; carbs and fat only when they have targets.
function macroRows(day) {
  const t = day.totals ?? {};
  const g = day.target ?? {};
  return [
    ['Protein', t.protein_g, g.protein_g, ' g', C.protein],
    ['Carbs', t.carbs_g, g.carbs_g, ' g', C.carbs],
    ['Fat', t.fat_g, g.fat_g, ' g', C.fat],
  ].filter(([label, , target]) => label === 'Protein' || target != null);
}

// Height grows with the number of macro rows so the footer never clips.
export function cardSize(day) {
  return { width: CARD_WIDTH, height: 600 + 100 * macroRows(day).length };
}

// day: the object returned by get_nutrition_day
export function buildCard(day) {
  const t = day.totals ?? {};
  const g = day.target ?? {};
  const calPct = g.calories ? t.calories / g.calories : 0;
  const left = g.calories != null ? g.calories - t.calories : null;
  const status = left == null ? 'No calorie target set'
    : left >= 0 ? `${fmt(left)} kcal left` : `${fmt(-left)} kcal over`;

  const macros = macroRows(day);

  const n = day.items?.length ?? 0;
  const extras = [
    `${n} item${n === 1 ? '' : 's'} logged`,
    t.fiber_g ? `Fiber ${fmt(t.fiber_g)} g` : null,
    t.sodium_mg ? `Sodium ${fmt(t.sodium_mg)} mg` : null,
  ].filter(Boolean).join('   ·   ');

  return box(
    { width: '100%', height: '100%', background: C.bg, padding: 56, flexDirection: 'column', fontFamily: 'sans-serif' },
    // header
    box(
      { justifyContent: 'space-between', alignItems: 'center', width: '100%' },
      text({ fontSize: 24, letterSpacing: 6, color: C.red, fontWeight: 700 }, 'STAYHARD · FUEL'),
      text({ fontSize: 28, color: C.dim }, prettyDate(day.date)),
    ),
    // calories hero
    box(
      { flexDirection: 'column', marginTop: 36, gap: 18, width: '100%' },
      box(
        { alignItems: 'baseline', gap: 16 },
        text({ fontSize: 120, fontWeight: 800, color: calPct > 1.05 ? C.over : C.text, lineHeight: 1 }, fmt(t.calories)),
        text({ fontSize: 40, color: C.dim }, g.calories ? `/ ${fmt(g.calories)} kcal` : 'kcal'),
      ),
      box({ width: '100%', height: 26, background: C.track, borderRadius: 13, overflow: 'hidden' },
        box({ width: `${Math.min(calPct, 1) * 100}%`, height: '100%', background: calPct > 1.05 ? C.over : C.red, borderRadius: 13 })),
      text({ fontSize: 30, color: left != null && left < 0 ? C.over : C.text }, status),
    ),
    // macros
    box(
      { flexDirection: 'column', gap: 26, marginTop: 40, padding: 32, background: C.panel, borderRadius: 20, width: '100%' },
      ...macros.map((m) => macroRow(...m)),
    ),
    // footer
    box({ marginTop: 'auto', paddingTop: 28, width: '100%' }, text({ fontSize: 24, color: C.dim }, extras)),
  );
}

export async function renderCardPng(day) {
  const res = new ImageResponse(buildCard(day), cardSize(day));
  return new Uint8Array(await res.arrayBuffer());
}
