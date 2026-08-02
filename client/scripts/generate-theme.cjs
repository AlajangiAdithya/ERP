/**
 * Theme palette generator  →  src/theme.css
 *
 *   node scripts/generate-theme.cjs
 *
 * Why this exists
 * ---------------
 * The app has ~7,600 hard-coded colour utilities (`bg-white`, `text-gray-500`,
 * `border-navy-100`, …) spread over 130+ files. Rather than bolt a `dark:`
 * variant onto every one of them, dark mode is done once at the palette level:
 * tailwind.config.js points every colour section at a CSS variable, and this
 * script emits the two sets of values those variables take.
 *
 *   :root, .on-dark   → the original light values (nothing changes by default)
 *   html.dark         → the dark values
 *
 * `.on-dark` re-declares the light set so any subtree that already sits on a
 * permanently dark surface (sidebar, gradient page heroes, the login backdrop)
 * keeps its original semantics — white stays white there, in both themes.
 *
 * Variable naming: --bg-<family>-<shade>, --tx-… (text), --bd-… (border/ring).
 * Values are space-separated RGB channels so Tailwind's `<alpha-value>` works
 * (`bg-white/85`, `border-navy-100/70`, …).
 */
const fs = require('fs');
const path = require('path');
const tw = require('tailwindcss/colors');

// ── Colour maths ───────────────────────────────────────────────────────────
const hex2rgb = (h) => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
};
const rgbStr = (rgb) => rgb.map((v) => Math.max(0, Math.min(255, Math.round(v)))).join(' ');
// Lay `fg` over `bg` at `a` opacity — used to build dark tinted surfaces.
const mix = (fg, bg, a) => hex2rgb(fg).map((c, i) => c * a + hex2rgb(bg)[i] * (1 - a));
const lighten = (hex, a) => mix('#ffffff', hex, a);

// ── Dark neutral surfaces (cool, to sit under the navy brand) ──────────────
const SURFACE = '#151d2e'; // bg-white   — cards, modals, table rows
const PAGE = '#0a0f1a';    // page background behind everything
// Tinted chips (bg-red-50, bg-green-50, …) are mixed over a near-neutral base
// instead of SURFACE: the surface's blue bias would drag reds toward magenta.
const TINT_BASE = '#171a24';

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Project palette (mirrors tailwind.config.js `theme.extend.colors`).
const NAVY = {
  50: '#EEF2FA', 100: '#D6DFF1', 200: '#AEBFE2', 300: '#7E96CB', 400: '#506FAF',
  500: '#2F4F95', 600: '#1E3A8A', 700: '#16306E', 800: '#102452', 900: '#0A1838',
};
const BLUE = {
  50: '#EFF5FF', 100: '#DBE7FE', 200: '#BAD0FC', 300: '#8FB1F8', 400: '#5C8AF2',
  500: '#3A6BE0', 600: '#1E50C7', 700: '#1E3A8A', 800: '#172E6C', 900: '#0F1F4D',
};
const BRAND = {
  blue: '#1E3A8A', blueDark: '#102452', blueLight: '#3A6BE0', accent: '#DBE7FE',
  red: '#E63329', white: '#FFFFFF', gray: '#EEF1F6', grayDark: '#D6DBE5',
  surface: '#FFFFFF', muted: '#6B7385',
};

const FAMILIES = {
  gray: tw.gray, slate: tw.slate, zinc: tw.zinc, stone: tw.stone, red: tw.red,
  orange: tw.orange, amber: tw.amber, yellow: tw.yellow, lime: tw.lime,
  green: tw.green, emerald: tw.emerald, teal: tw.teal, cyan: tw.cyan,
  sky: tw.sky, indigo: tw.indigo, violet: tw.violet, purple: tw.purple,
  fuchsia: tw.fuchsia, pink: tw.pink, rose: tw.rose, blue: BLUE, navy: NAVY,
};

// ── Generic dark rules for a tinted family ─────────────────────────────────
// Backgrounds: the light 50–300 tints become the same hue laid over the dark
// surface at low opacity, so a status chip reads as "tinted dark", not a torch.
// 400+ are solid button/dot colours and stay put.
const BG_TINT = { 50: 0.14, 100: 0.2, 200: 0.28, 300: 0.36 };
const BD_TINT = { 50: 0.18, 100: 0.24, 200: 0.32, 300: 0.4 };
// Text: the ramp flips — dark-on-light shades become light-on-dark ones.
const TX_FLIP = { 500: 400, 600: 400, 700: 300, 800: 300, 900: 200, 950: 200 };

// Hand-tuned ramps where the generic rule doesn't hold: the neutrals carry
// almost all of the app's copy, and navy/blue are the brand accents.
const TEXT_OVERRIDES = {
  gray:  { 300: '#64748b', 400: '#7e8a9e', 500: '#98a3b7', 600: '#b4becf', 700: '#d2d9e4', 800: '#e5eaf1', 900: '#f3f6fa', 950: '#f8fafc' },
  slate: { 300: '#64748b', 400: '#7e8a9e', 500: '#98a3b7', 600: '#b4becf', 700: '#d2d9e4', 800: '#e5eaf1', 900: '#f3f6fa', 950: '#f8fafc' },
  zinc:  { 400: '#7e8a9e', 500: '#98a3b7', 600: '#b4becf', 700: '#d2d9e4', 800: '#e5eaf1', 900: '#f3f6fa' },
  stone: { 400: '#7e8a9e', 500: '#98a3b7', 600: '#b4becf', 700: '#d2d9e4', 800: '#e5eaf1', 900: '#f3f6fa' },
  navy:  { 300: '#94adde', 400: '#7c9de0', 500: '#8db0ec', 600: '#9dbcf3', 700: '#aecbf8', 800: '#c8dbfc', 900: '#e2edfe' },
  blue:  { 400: '#7ba4f5', 500: '#8fb1f8', 600: '#a2bffa', 700: '#b5cdfb', 800: '#cbdcfd', 900: '#e2edfe' },
};
// Neutral + brand surfaces are hand-set rather than mixed: they carry the
// page → card → raised-row hierarchy, which needs even luminance steps.
const BG_OVERRIDES = {
  gray:  { 50: '#1a2336', 100: '#202a3e', 200: '#29344b', 300: '#35415a' },
  slate: { 50: '#1a2336', 100: '#202a3e', 200: '#29344b', 300: '#35415a' },
  zinc:  { 50: '#1a2336', 100: '#202a3e', 200: '#29344b' },
  stone: { 50: '#1b2233', 100: '#21293b', 200: '#2a3348' },
  navy:  { 50: '#192440', 100: '#1e2b4c', 200: '#25355d', 300: '#2d406e' },
  blue:  { 50: '#18223e', 100: '#1d294c', 200: '#24345d', 300: '#2c3f70' },
};
const BORDER_OVERRIDES = {
  gray:  { 50: '#1d2637', 100: '#253044', 200: '#2e3a53', 300: '#3c4a67' },
  slate: { 50: '#1d2637', 100: '#253044', 200: '#2e3a53', 300: '#3c4a67' },
  zinc:  { 100: '#253044', 200: '#2e3a53' },
  stone: { 100: '#262f42', 200: '#2f3a55' },
  navy:  { 50: '#1c2643', 100: '#243257', 200: '#2d3e69', 300: '#38497c' },
  blue:  { 50: '#1c2643', 100: '#243257', 200: '#2d3e69', 300: '#38497c' },
};

const darkBg = (fam, shade, hex) => {
  const o = BG_OVERRIDES[fam]?.[shade];
  if (o) return hex2rgb(o);
  if (BG_TINT[shade]) return mix(FAMILIES[fam][400] || hex, TINT_BASE, BG_TINT[shade]);
  return hex2rgb(hex); // 400+ — solid buttons, dots, badges keep their punch
};
const darkText = (fam, shade, hex) => {
  const o = TEXT_OVERRIDES[fam]?.[shade];
  if (o) return hex2rgb(o);
  const flip = TX_FLIP[shade];
  if (flip) return hex2rgb(FAMILIES[fam][flip] || hex);
  return hex2rgb(hex); // 50–400 already read on dark (they live on heroes today)
};
const darkBorder = (fam, shade, hex) => {
  const o = BORDER_OVERRIDES[fam]?.[shade];
  if (o) return hex2rgb(o);
  if (BD_TINT[shade]) return mix(FAMILIES[fam][400] || hex, TINT_BASE, BD_TINT[shade]);
  // 400–600 double as focus rings (`ring-navy-500`) — lift them so they show.
  if (shade <= 600) return lighten(hex, 0.3);
  return lighten(hex, 0.15);
};

// ── Emit ───────────────────────────────────────────────────────────────────
const light = [];
const dark = [];
const push = (name, l, d) => { light.push(`  --${name}: ${l};`); dark.push(`  --${name}: ${d};`); };

for (const [fam, scale] of Object.entries(FAMILIES)) {
  for (const shade of SHADES) {
    const hex = scale[shade];
    if (!hex) continue;
    const base = rgbStr(hex2rgb(hex));
    push(`bg-${fam}-${shade}`, base, rgbStr(darkBg(fam, shade, hex)));
    push(`tx-${fam}-${shade}`, base, rgbStr(darkText(fam, shade, hex)));
    push(`bd-${fam}-${shade}`, base, rgbStr(darkBorder(fam, shade, hex)));
  }
}

// Neutrals that aren't part of a scale. `bg-white` is a surface, so it goes
// dark; `text-white` / `border-white` stay white — they label solid buttons and
// gradient heroes in both themes.
push('bg-white', '255 255 255', rgbStr(hex2rgb(SURFACE)));
push('bg-black', '0 0 0', '0 0 0');

// Brand tokens.
push('bg-brand-white', '255 255 255', rgbStr(hex2rgb(SURFACE)));
push('bg-brand-surface', '255 255 255', rgbStr(hex2rgb(SURFACE)));
push('bg-brand-gray', rgbStr(hex2rgb(BRAND.gray)), '26 34 51');
push('bg-brand-grayDark', rgbStr(hex2rgb(BRAND.grayDark)), '35 45 66');
push('bg-brand-accent', rgbStr(hex2rgb(BRAND.accent)), '30 44 76');
for (const k of ['blue', 'blueDark', 'blueLight', 'red']) {
  push(`bg-brand-${k}`, rgbStr(hex2rgb(BRAND[k])), rgbStr(hex2rgb(BRAND[k])));
}
push('tx-brand-red', rgbStr(hex2rgb(BRAND.red)), '255 122 114');
push('tx-brand-muted', rgbStr(hex2rgb(BRAND.muted)), '152 163 183');
push('tx-brand-blue', rgbStr(hex2rgb(BRAND.blue)), '174 203 248');
push('tx-brand-blueDark', rgbStr(hex2rgb(BRAND.blueDark)), '200 219 252');
push('tx-brand-blueLight', rgbStr(hex2rgb(BRAND.blueLight)), '143 177 248');
push('tx-brand-white', '255 255 255', '255 255 255');
push('bd-brand-gray', rgbStr(hex2rgb(BRAND.gray)), '44 56 83');
push('bd-brand-grayDark', rgbStr(hex2rgb(BRAND.grayDark)), '58 71 99');
push('bd-brand-blue', rgbStr(hex2rgb(BRAND.blue)), rgbStr(lighten(BRAND.blue, 0.3)));
push('bd-brand-red', rgbStr(hex2rgb(BRAND.red)), rgbStr(lighten(BRAND.red, 0.2)));

// Page chrome + shadow tint (consumed by index.css and the boxShadow theme).
push('page-bg', '237 240 247', rgbStr(hex2rgb(PAGE)));
push('page-glow', '58 107 224', '58 107 224');
push('page-dot', '30 58 138', '148 178 255');
push('page-dot-alpha', '0.045', '0.05');
push('shadow-rgb', '16 36 82', '0 0 0');
push('shadow-strength', '1', '2.2');
push('scrollbar-thumb', '185 197 223', '51 65 90');
push('scrollbar-thumb-hover', '80 111 175', '73 92 128');
push('scrollbar-track', '237 240 247', rgbStr(hex2rgb(PAGE)));

const out = `/* ─────────────────────────────────────────────────────────────────────────
   GENERATED FILE — do not edit by hand.
   Regenerate with:  node scripts/generate-theme.cjs

   Every colour utility in the app resolves through these variables (see
   tailwind.config.js), so flipping \`.dark\` on <html> retints the whole UI
   without touching a single component class.

   \`.on-dark\` pins the light values for a subtree — use it on surfaces that
   are dark in BOTH themes (sidebar, gradient heroes) so their white text,
   frosted \`bg-white/10\` tiles and light rings keep working.
   ───────────────────────────────────────────────────────────────────────── */

:root,
.on-dark {
${light.join('\n')}
}

html.dark {
  color-scheme: dark;
${dark.join('\n')}
}
`;

const dest = path.join(__dirname, '..', 'src', 'theme.css');
fs.writeFileSync(dest, out);
console.log(`wrote ${dest} — ${light.length} tokens per theme`);
