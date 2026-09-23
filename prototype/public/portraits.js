/**
 * The cast, drawn as inline SVG.
 *
 * These are archetype avatars for a game, not likenesses. The people on the roster are
 * real and public, but nothing here tries to depict them: a prospect gets a silhouette
 * and a prop that belong to the number on their tile, and the expression belongs to the
 * scene rather than to the person. No external images, no icon fonts, no emoji.
 *
 * Every bust is built from the same skeleton so eight of them read as one cast:
 *   backdrop wash, floor pool in the prospect's accent, torso, neck, head, hair or
 *   headwear, three tones on every mass (base, shade, highlight), a cast shadow under
 *   the jaw and one rim light down the right edge. The key light is upper left and the
 *   rim is the prospect's accent, so a row of them reads as one lit stage.
 *
 * Two crops, because a 145px tile and a 190px stage portrait want different framing:
 *   `face` fills the frame with the head, the reference character-select crop.
 *   `bust`  shows head and shoulders.
 *
 * Four expressions per prospect, crossfaded by `data-x`: idle, confident, caught, sold.
 * PENNY (portrait key 'meridian') keeps its five desk moods. Colours arrive as CSS custom properties on the
 * <svg> root, so the stylesheet owns the switching and this file owns the shapes.
 */

const CROPS = { face: '36 14 169 192', bust: '0 0 240 320' };

/* Shoulders are shared: eight people, one lit stage, one camera height. */
const TORSO = 'M-6 320 C-6 252 52 222 120 222 C188 222 246 252 246 320 Z';
const TORSO_SHADE = 'M120 222 C188 222 246 252 246 320 L164 320 C160 272 142 240 120 222 Z';
const TORSO_RIM = 'M200 320 C196 274 174 242 148 226 C186 232 224 262 232 320 Z';

/**
 * The head is built from four numbers, so no two prospects share a silhouette: `w`
 * widens the skull, `jaw` widens or narrows the chin, and `top` and `chin` set how long
 * the face is. The shading, the rim light and the ears are derived from the same
 * numbers and clipped to the outline, so a narrow head is lit like a narrow head.
 */
const headPath = ({ w, jaw, top, chin }) => {
  const cx = 120, hw = 68 * w, jw = 44 * jaw, mid = top + (chin - top) * 0.46;
  return [
    `M${cx} ${top}`,
    `C${cx + hw * 0.6} ${top} ${cx + hw} ${top + (mid - top) * 0.5} ${cx + hw} ${mid}`,
    `C${cx + hw} ${mid + (chin - mid) * 0.55} ${cx + jw + 16} ${chin - 10} ${cx + jw} ${chin - 4}`,
    `C${cx + jw * 0.55} ${chin + 6} ${cx - jw * 0.55} ${chin + 6} ${cx - jw} ${chin - 4}`,
    `C${cx - jw - 16} ${chin - 10} ${cx - hw} ${mid + (chin - mid) * 0.55} ${cx - hw} ${mid}`,
    `C${cx - hw} ${top + (mid - top) * 0.5} ${cx - hw * 0.6} ${top} ${cx} ${top}`,
    'Z',
  ].join(' ');
};

const headGroup = (key, m) => {
  const { w, top, chin } = m;
  const hw = 68 * w, h = chin - top, cy = top + h * 0.5;
  const ear = side =>
    `M${120 + side * hw} ${cy - 14} c${side * 13} -4 ${side * 21} 8 ${side * 17} 23 ` +
    `c${-side * 4} 15 ${-side * 13} 22 ${-side * 24} 19 Z`;
  return `
<clipPath id="head-${key}"><path d="${headPath(m)}"/></clipPath>
<path class="ear" d="${ear(-1)}"/>
<path class="ear" d="${ear(1)}"/>
<g clip-path="url(#head-${key})">
  <rect class="head" x="0" y="0" width="240" height="320"/>
  <ellipse class="head-shade" cx="${120 + hw * 0.88}" cy="${cy + h * 0.06}" rx="${hw * 0.8}" ry="${h * 0.72}"/>
  <ellipse class="head-light" cx="${120 - hw * 0.66}" cy="${top + h * 0.3}" rx="${hw * 0.44}" ry="${h * 0.34}"/>
  <rect class="head-rim" x="${120 + hw - 12}" y="${top + h * 0.2}" width="12" height="${h * 0.62}" rx="6"/>
</g>
<path class="nose" d="M120 ${m.eyeY + 4} c${m.noseW} ${m.noseL * 0.62} ${m.noseW * 2.2} ${m.noseL} ${m.noseW * 3} ${m.noseL * 1.2} c${-m.noseW * 1.6} ${m.noseW * 1.4} ${-m.noseW * 5.6} ${m.noseW * 1.4} ${-m.noseW * 7.2} 0 Z"/>`;
};

/**
 * Four expressions, drawn from the same per-prospect numbers as the head: where the
 * eyes sit, how wide and how open they are, how the brow tilts and how wide the mouth
 * is. A narrow-eyed prospect is narrow-eyed in all four of them.
 */
const facesFor = m => {
  const { eyeY, eyeX, eyeRx, eyeRy, browTilt, mouthY, mouthW } = m;
  const L = 120 - eyeX, R = 120 + eyeX;
  const browY = eyeY - 26;
  const bw = eyeRx + 9;
  const pupil = Math.max(5, eyeRx * 0.55);
  return `
<g class="x x-idle">
  <path class="brow" d="M${L - bw} ${browY - browTilt} L${L + bw} ${browY + browTilt * 0.4}"/>
  <path class="brow" d="M${R + bw} ${browY - browTilt} L${R - bw} ${browY + browTilt * 0.4}"/>
  <path class="socket" d="M${L - bw} ${eyeY - 12} H${L + bw} M${R - bw} ${eyeY - 12} H${R + bw}"/>
  <ellipse class="eye" cx="${L}" cy="${eyeY}" rx="${eyeRx}" ry="${eyeRy}"/>
  <ellipse class="eye" cx="${R}" cy="${eyeY}" rx="${eyeRx}" ry="${eyeRy}"/>
  <path class="mouth" d="M${120 - mouthW} ${mouthY} H${120 + mouthW}"/>
</g>
<g class="x x-confident">
  <path class="brow" d="M${L - bw} ${browY - browTilt - 6} L${L + bw} ${browY + browTilt}"/>
  <path class="brow" d="M${R + bw} ${browY + 2} L${R - bw} ${browY - browTilt - 2}"/>
  <path class="socket" d="M${L - bw} ${eyeY - 10} H${L + bw} M${R - bw} ${eyeY - 10} H${R + bw}"/>
  <ellipse class="eye" cx="${L}" cy="${eyeY}" rx="${eyeRx * 0.9}" ry="${eyeRy * 0.86}"/>
  <ellipse class="eye" cx="${R}" cy="${eyeY - 2}" rx="${eyeRx * 1.1}" ry="${eyeRy * 1.14}"/>
  <path class="mouth" d="M${120 - mouthW} ${mouthY - 2} Q120 ${mouthY + 8} ${120 + mouthW} ${mouthY - 10}"/>
</g>
<g class="x x-caught">
  <path class="brow" d="M${L - bw} ${browY - 12} L${L + bw} ${browY - 22}"/>
  <path class="brow" d="M${R + bw} ${browY - 12} L${R - bw} ${browY - 22}"/>
  <circle class="sclera" cx="${L}" cy="${eyeY - 2}" r="${eyeRx + 5}"/>
  <circle class="sclera" cx="${R}" cy="${eyeY - 2}" r="${eyeRx + 5}"/>
  <circle class="eye" cx="${L + 3}" cy="${eyeY + 1}" r="${pupil}"/>
  <circle class="eye" cx="${R + 3}" cy="${eyeY + 1}" r="${pupil}"/>
  <ellipse class="mouth-fill" cx="121" cy="${mouthY + 3}" rx="${mouthW * 0.5}" ry="${mouthW * 0.42}"/>
  <path class="sweat" d="M182 ${browY - 32} c8 11 12 19 12 25 a12 12 0 0 1 -24 0 c0 -6 4 -14 12 -25 Z"/>
</g>
<g class="x x-sold">
  <path class="brow" d="M${L - bw} ${browY - 4} L${L + bw} ${browY - 12}"/>
  <path class="brow" d="M${R + bw} ${browY - 4} L${R - bw} ${browY - 12}"/>
  <path class="eye-arc" d="M${L - eyeRx - 4} ${eyeY + 4} Q${L} ${eyeY - 20} ${L + eyeRx + 4} ${eyeY + 4}"/>
  <path class="eye-arc" d="M${R - eyeRx - 4} ${eyeY + 4} Q${R} ${eyeY - 20} ${R + eyeRx + 4} ${eyeY + 4}"/>
  <path class="mouth-fill" d="M${120 - mouthW - 6} ${mouthY - 12} Q120 ${mouthY + 26} ${120 + mouthW + 6} ${mouthY - 14} Z"/>
  <path class="tooth" d="M${120 - mouthW - 6} ${mouthY - 12} H${120 + mouthW + 6} L${120 + mouthW} ${mouthY - 2} H${120 - mouthW} Z"/>
</g>`;
};

/** Head and face numbers, filled in from a prospect's own overrides. */
const metrics = o => {
  const m = { w: 1, jaw: 1, top: 40, chin: 222, ...o };
  const h = m.chin - m.top;
  return {
    ...m,
    eyeY: m.eyeY ?? m.top + h * 0.44,
    eyeX: m.eyeX ?? 27 * m.w,
    eyeRx: m.eyeRx ?? 10,
    eyeRy: m.eyeRy ?? 7,
    browTilt: m.browTilt ?? 5,
    mouthY: m.mouthY ?? m.chin - h * 0.23,
    mouthW: m.mouthW ?? 24 * m.jaw,
    noseW: m.noseW ?? 5,
    noseL: m.noseL ?? 28,
  };
};

/**
 * The cast table. `behind` draws before the torso, `hair` after the head, `front` last.
 * Every prospect owns one prop that survives at 96 px, because the silhouette is what a
 * player picks from, and every prop breaks the head outline so no two are the same shape.
 */
const CAST = {
  // Swept-back volume, heavy moustache, a lit cigar across the jaw. Oldest money here.
  legend: {
    m: metrics({ w: 1.08, jaw: 1.3, top: 42, chin: 224, eyeRx: 9, eyeRy: 5.5, browTilt: 9, mouthW: 30, noseW: 6.5, noseL: 32 }),
    skin: '#C08A61', shade: '#7A5033', light: '#F0CFA6', cloth: '#262C36', clothShade: '#131820', ink: '#20141A',
    bg: ['#3A1B0E', '#0B0A0B'],
    hair: `<path class="hair" d="M120 18 C172 18 198 56 194 116 C186 92 178 74 160 64 C142 54 98 54 80 64 C62 74 54 92 46 116 C42 56 68 18 120 18 Z"/>
           <path class="hair-light" d="M104 26 C78 38 62 64 54 100 C56 56 74 30 104 26 Z"/>
           <path class="hair" d="M46 96 c-14 -22 -6 -48 10 -58 c-4 20 -2 40 6 56 Z"/>`,
    front: `<path class="brow-hair" d="M68 88 C82 76 104 80 114 92 C100 84 82 82 68 88 Z"/>
            <path class="brow-hair" d="M172 88 C158 76 136 80 126 92 C140 84 158 82 172 88 Z"/>
            <path class="tache" d="M86 158 C100 148 140 148 154 158 C146 170 94 170 86 158 Z"/>
            <path class="prop" d="M140 194 l74 -18 a9 9 0 0 1 4 18 l-74 18 Z"/>
            <path class="ember" d="M212 172 a11 11 0 1 1 6 20 a11 11 0 0 1 -6 -20 Z"/>
            <path class="prop-shine" d="M148 192 l58 -14 l2 6 l-58 14 Z"/>`,
  },
  // A deep hood and outsized cans. All week, no month.
  streak: {
    m: metrics({ w: 0.9, jaw: 0.72, top: 40, chin: 226, eyeRx: 11, eyeRy: 5, browTilt: 10, eyeX: 26, mouthW: 18, noseW: 4, noseL: 24 }),
    skin: '#B0805F', shade: '#6C4630', light: '#E3B98C', cloth: '#4A2537', clothShade: '#22101B', ink: '#1E1018',
    bg: ['#3D1030', '#0A080B'],
    behind: `<path class="hood" d="M120 -14 C190 -14 232 46 226 126 C223 170 210 214 192 248 L48 248 C30 214 17 170 14 126 C8 46 50 -14 120 -14 Z"/>`,
    hair: `<path class="hood-inner" fill-rule="evenodd" d="M120 4 C180 4 214 54 209 124 C206 160 196 196 182 224 L58 224 C44 196 34 160 31 124 C26 54 60 4 120 4 Z M120 32 a76 98 0 1 0 0.1 0 Z"/>
           <path class="hood-rim" d="M196 36 c22 30 30 76 25 128 c-2 -56 -14 -98 -39 -134 Z"/>`,
    front: `<path class="mask" d="M56 142 C84 134 156 134 184 142 C182 186 158 218 120 218 C82 218 58 186 56 142 Z"/>
            <path class="mask-rim" d="M184 142 c-2 44 -26 76 -64 76 c30 -12 50 -42 54 -74 Z"/>
            <path class="mask-fold" d="M60 150 C88 142 152 142 180 150 L178 160 C150 152 90 152 62 160 Z"/>
            <path class="prop" d="M12 92 h34 v106 H12 a12 12 0 0 1 -12 -12 v-82 a12 12 0 0 1 12 -12 Z"/>
            <path class="prop" d="M228 92 h-34 v106 h34 a12 12 0 0 0 12 -12 v-82 a12 12 0 0 0 -12 -12 Z"/>
            <path class="prop-shine" d="M18 100 h14 v90 h-14 Z"/>
            <path class="band" d="M6 84 C20 32 68 6 120 6 C172 6 220 32 234 84"/>`,
  },
  // Round glasses, a neat part, a buttoned collar. Nothing to hide.
  realdeal: {
    m: metrics({ w: 1, jaw: 0.98, top: 44, chin: 214, eyeRx: 9.5, eyeRy: 9, browTilt: 2, mouthW: 19, noseW: 4.5, noseL: 24 }),
    skin: '#C79B72', shade: '#845B3C', light: '#F2D6B0', cloth: '#2A3A44', clothShade: '#16222A', ink: '#171A1E',
    bg: ['#08382A', '#070A0A'],
    hair: `<path class="hair" d="M120 22 C168 22 194 56 192 106 C182 86 170 74 152 68 C132 61 96 62 80 70 C64 78 54 90 48 106 C46 56 72 22 120 22 Z"/>
           <path class="hair-light" d="M110 28 C86 38 68 60 58 92 C60 54 80 32 110 28 Z"/>
           <path class="hair" d="M126 24 c26 6 44 24 52 48 c-20 -22 -40 -36 -60 -42 Z"/>`,
    front: `<circle class="lens" cx="92" cy="120" r="27"/>
            <circle class="lens" cx="148" cy="120" r="27"/>
            <path class="frame" d="M119 118 h2 M65 112 L48 104 M175 112 L192 104"/>
            <path class="glare" d="M76 106 l18 -11 l7 8 l-18 11 Z"/>
            <path class="glare" d="M132 106 l18 -11 l7 8 l-18 11 Z"/>
            <path class="collar" d="M84 226 L120 272 L156 226 L120 244 Z"/>`,
  },
  // Hood, stubble, a cup that never gets cold. Four hundred trades a week.
  grinder: {
    m: metrics({ w: 0.94, jaw: 1.04, top: 34, chin: 230, eyeRx: 11, eyeRy: 5, browTilt: -3, mouthW: 27, noseW: 5.5, noseL: 34 }),
    skin: '#A57E60', shade: '#654833', light: '#D9B58C', cloth: '#272B33', clothShade: '#14171C', ink: '#1A1418',
    bg: ['#3A2A06', '#09090A'],
    behind: `<path class="hood" d="M120 -10 C186 -10 226 48 221 124 C218 166 206 210 189 244 L51 244 C34 210 22 166 19 124 C14 48 54 -10 120 -10 Z"/>`,
    hair: `<path class="hood-inner" fill-rule="evenodd" d="M120 8 C178 8 210 56 205 122 C202 158 192 194 179 222 L61 222 C48 194 38 158 35 122 C30 56 62 8 120 8 Z M120 34 a74 96 0 1 0 0.1 0 Z"/>
           <path class="hood-rim" d="M192 40 c21 30 28 74 23 124 c-2 -54 -13 -94 -37 -130 Z"/>
           <path class="stubble" d="M70 166 C86 208 154 208 170 166 C168 208 144 226 120 226 C96 226 72 208 70 166 Z"/>`,
    front: `<path class="prop" d="M168 246 h54 l-8 74 h-38 Z"/>
            <path class="prop-shine" d="M176 254 h12 l-6 60 h-10 Z"/>
            <path class="steam" d="M184 238 c-10 -16 5 -24 -5 -40 M206 238 c-10 -16 5 -24 -5 -40"/>`,
  },
  // A wide bucket brim and a heavy chain. Half a million people watching.
  unipcs: {
    m: metrics({ w: 1.14, jaw: 1.06, top: 46, chin: 216, eyeRx: 12.5, eyeRy: 11, browTilt: 1, eyeX: 32, mouthW: 16, noseW: 5, noseL: 22 }),
    skin: '#C09168', shade: '#7E5B3C', light: '#EFD0A6', cloth: '#312A48', clothShade: '#191530', ink: '#1C1622',
    bg: ['#2A1A5E', '#09080E'],
    hair: `<path class="hat" d="M36 86 C36 30 74 -2 120 -2 C166 -2 204 30 204 86 Z"/>
           <path class="hat-light" d="M58 74 C62 30 88 8 118 4 C92 14 70 38 64 78 Z"/>
           <path class="hat-brim" d="M4 84 h232 c9 0 15 8 12 17 l-7 22 c-3 9 -9 12 -18 12 H17 c-9 0 -15 -3 -18 -12 l-7 -22 c-3 -9 3 -17 12 -17 Z"/>
           <path class="hat-rim" d="M212 88 c8 2 12 10 10 17 l-7 22 c-3 8 -8 11 -16 11 c10 -14 14 -33 13 -50 Z"/>`,
    front: `<path class="chain" d="M78 224 C94 282 146 282 162 224"/>
            <circle class="pendant" cx="120" cy="272" r="16"/>`,
  },
  // A shaved dome and a very high collar. Sits extremely still.
  monk: {
    m: metrics({ w: 0.88, jaw: 0.82, top: 30, chin: 220, eyeRx: 12, eyeRy: 3.6, browTilt: 0, mouthW: 15, noseW: 4, noseL: 30 }),
    skin: '#BA9068', shade: '#7A553A', light: '#E9CBA4', cloth: '#1D3440', clothShade: '#0F1D26', ink: '#141A1F',
    bg: ['#063845', '#07090B'],
    hair: `<path class="scalp-light" d="M120 44 C152 44 176 68 184 106 C166 80 146 68 120 68 C94 68 74 80 56 106 C64 68 88 44 120 44 Z"/>`,
    front: `<path class="collar" d="M28 214 C56 180 184 180 212 214 L200 276 C172 226 68 226 40 276 Z"/>
            <path class="collar-fold" d="M60 202 C88 186 152 186 180 202 L172 216 C146 202 94 202 68 216 Z"/>
            <path class="collar-rim" d="M182 226 c11 5 16 13 18 22 l-10 44 c0 -23 -5 -46 -8 -66 Z"/>
            <path class="bead" d="M96 224 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 Z"/>
            <path class="bead" d="M124 224 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 Z"/>`,
  },
  // A beanie with a pom. Twenty four million of it is still in the bags.
  frank: {
    m: metrics({ w: 1.12, jaw: 1.22, top: 44, chin: 218, eyeRx: 8, eyeRy: 8, browTilt: 7, eyeX: 30, mouthW: 32, noseW: 6, noseL: 26 }),
    skin: '#C79D74', shade: '#875F40', light: '#F2D5AE', cloth: '#453B23', clothShade: '#221C10', ink: '#1E1812',
    bg: ['#3D3208', '#0A0908'],
    hair: `<path class="beanie" d="M40 96 C40 36 76 4 120 4 C164 4 200 36 200 96 Z"/>
           <path class="beanie-light" d="M60 84 C64 40 90 14 116 10 C90 22 72 48 66 88 Z"/>
           <path class="beanie-band" d="M36 92 h168 v36 c0 8 -5 13 -13 13 H49 c-8 0 -13 -5 -13 -13 Z"/>
           <path class="beanie-rim" d="M196 92 h8 v36 c0 8 -5 13 -13 13 h-8 c8 -12 12 -30 13 -49 Z"/>
           <circle class="pom" cx="120" cy="10" r="20"/>`,
    front: '',
  },
  // Cap turned back, cans round the neck. Every entry gets broadcast.
  orangie: {
    m: metrics({ w: 0.98, jaw: 0.88, top: 42, chin: 212, eyeRx: 10.5, eyeRy: 6.5, browTilt: 4, eyeX: 30, mouthW: 20, noseW: 4.5, noseL: 22 }),
    skin: '#C59A72', shade: '#83603E', light: '#F0D2AA', cloth: '#4A3218', clothShade: '#28190D', ink: '#1E1711',
    bg: ['#47230A', '#0A0908'],
    hair: `<path class="cap" d="M40 92 C40 34 76 2 120 2 C164 2 200 34 200 92 Z"/>
           <path class="cap-light" d="M60 80 C64 38 90 14 116 8 C90 20 72 44 66 84 Z"/>
           <path class="cap-band" d="M38 88 h164 v26 H38 Z"/>
           <path class="cap-back" d="M196 58 h34 c10 0 15 8 13 17 l-6 22 c-2 9 -8 13 -17 13 h-24 Z"/>
           <circle class="cap-button" cx="120" cy="6" r="9"/>`,
    front: `<path class="prop" d="M28 224 h26 v52 H28 a8 8 0 0 1 -8 -8 v-36 a8 8 0 0 1 8 -8 Z"/>
            <path class="prop" d="M212 224 h-26 v52 h26 a8 8 0 0 0 8 -8 v-36 a8 8 0 0 0 -8 -8 Z"/>
            <path class="band" d="M26 230 C44 194 196 194 214 230"/>`,
  },
  // Hair in every direction, a grin, one crayon behind the ear. Eats what it draws.
  crayon: {
    m: metrics({ w: 1.02, jaw: 0.9, top: 44, chin: 218, eyeRx: 11, eyeRy: 9, browTilt: 12, eyeX: 30, mouthW: 36, noseW: 4.5, noseL: 22 }),
    skin: '#C9A07A', shade: '#87603F', light: '#F3D8B4', cloth: '#2F4A2A', clothShade: '#172614', ink: '#1A1A14',
    bg: ['#3B3D0A', '#0A0A08'],
    hair: `<path class="hair" d="M120 20 C150 6 176 22 186 44 L206 34 L192 66 C200 84 198 104 192 118 C180 90 168 74 150 66 C130 58 100 58 82 66 C64 74 54 92 46 118 C40 100 40 80 50 62 L32 40 L58 46 C70 24 96 14 120 20 Z"/>
           <path class="hair" d="M96 22 L104 -6 L118 20 Z M136 20 L152 -4 L152 24 Z M64 42 L48 22 L74 34 Z"/>
           <path class="hair-light" d="M108 26 C86 34 68 56 58 94 C60 56 78 32 108 26 Z"/>`,
    front: `<path class="prop" d="M186 106 l30 -70 l14 6 l-30 70 Z"/>
            <path class="ember" d="M216 36 l8 -18 l6 24 Z"/>
            <path class="prop-shine" d="M192 104 l26 -60 l4 2 l-26 60 Z"/>`,
  },
  // A widow's peak like an arrowhead and a V-neck. Everything about him points down.
  veeman: {
    m: metrics({ w: 0.96, jaw: 0.94, top: 42, chin: 220, eyeRx: 10, eyeRy: 6, browTilt: 6, eyeX: 28, mouthW: 22, noseW: 5, noseL: 28 }),
    skin: '#B98D66', shade: '#77563A', light: '#E8C79E', cloth: '#1F3B3F', clothShade: '#0F2023', ink: '#141C1E',
    bg: ['#063A3A', '#07090A'],
    hair: `<path class="hair" d="M120 24 C170 24 196 58 192 112 C184 88 172 72 154 66 L120 92 L86 66 C68 72 56 88 48 112 C44 58 70 24 120 24 Z"/>
           <path class="hair-light" d="M106 30 C82 40 66 62 56 96 C58 58 76 34 106 30 Z"/>
           <path class="hair" d="M188 96 c10 -22 6 -48 -8 -60 c4 22 4 42 0 60 Z"/>`,
    front: `<path class="collar" d="M64 226 L120 296 L176 226 L166 220 L120 270 L74 220 Z"/>
            <path class="collar-fold" d="M120 270 L166 220 L156 216 L120 256 L84 216 L74 220 Z"/>`,
  },
  // Square rims, a hairline in retreat, a tie knotted tight. Reads the footnotes.
  econoar: {
    m: metrics({ w: 1.04, jaw: 1.1, top: 46, chin: 222, eyeRx: 9, eyeRy: 7.5, browTilt: -4, eyeX: 29, mouthW: 18, noseW: 5.5, noseL: 30 }),
    skin: '#C39A78', shade: '#805C40', light: '#EFD3B0', cloth: '#2C3140', clothShade: '#151824', ink: '#191A20',
    bg: ['#0C3A20', '#07090A'],
    hair: `<path class="hair" d="M48 116 C44 76 56 50 80 40 C88 60 84 84 78 104 C70 106 58 110 48 116 Z"/>
           <path class="hair" d="M192 116 C196 76 184 50 160 40 C152 60 156 84 162 104 C170 106 182 110 192 116 Z"/>
           <path class="hair-light" d="M60 106 C58 78 66 58 78 48 C74 66 72 86 68 102 Z"/>`,
    front: `<rect class="lens" x="64" y="102" width="50" height="38" rx="6"/>
            <rect class="lens" x="126" y="102" width="50" height="38" rx="6"/>
            <path class="frame" d="M114 118 h12 M64 116 L48 108 M176 116 L192 108"/>
            <path class="glare" d="M70 108 l16 -4 l4 8 l-16 4 Z"/>
            <path class="glare" d="M132 108 l16 -4 l4 8 l-16 4 Z"/>
            <path class="collar" d="M70 224 L120 262 L170 224 L160 218 L120 246 L80 218 Z"/>
            <path class="prop" d="M110 244 h20 l6 12 l-16 64 l-16 -64 Z"/>
            <path class="prop-shine" d="M116 258 h8 l-4 44 Z"/>`,
  },
  // A hoodie with cat ears and a bell on the drawstring. Not a nice cat.
  nicecat: {
    m: metrics({ w: 0.92, jaw: 0.8, top: 40, chin: 216, eyeRx: 12, eyeRy: 10, browTilt: 8, eyeX: 27, mouthW: 14, noseW: 4, noseL: 20 }),
    skin: '#D2A98A', shade: '#8E674D', light: '#F5DDC4', cloth: '#4A1F3F', clothShade: '#260F21', ink: '#1E1220',
    bg: ['#3A0F3A', '#0A080B'],
    behind: `<path class="hood" d="M120 -12 C188 -12 230 46 224 126 C221 168 208 212 190 246 L50 246 C32 212 19 168 16 126 C10 46 52 -12 120 -12 Z"/>
             <path class="hood" d="M26 74 L18 18 L74 30 Z"/>
             <path class="hood" d="M214 74 L222 18 L166 30 Z"/>
             <path class="hood-inner" d="M32 64 L28 30 L62 36 Z"/>
             <path class="hood-inner" d="M208 64 L212 30 L178 36 Z"/>`,
    hair: `<path class="hood-inner" fill-rule="evenodd" d="M120 6 C180 6 214 56 209 124 C206 160 196 196 182 224 L58 224 C44 196 34 160 31 124 C26 56 60 6 120 6 Z M120 34 a76 98 0 1 0 0.1 0 Z"/>
           <path class="hood-rim" d="M196 38 c22 30 30 76 25 128 c-2 -56 -14 -98 -39 -134 Z"/>`,
    front: `<path class="band" d="M74 230 C94 262 146 262 166 230"/>
            <circle class="pendant" cx="120" cy="258" r="12"/>`,
  },
};

const bust = (key, c) => {
  const m = c.m;
  // The headwear art is drawn against a default skull, so it is scaled and shifted by
  // the same numbers the head is: a wide head gets a wide hat.
  const fit = art => (art
    ? `<g transform="translate(120 ${m.top - 40}) scale(${m.w} 1) translate(-120 0)">${art}</g>`
    : '');
  const nw = 21 * m.jaw;
  return `
<defs>
  <linearGradient id="bg-${key}" x1="0" y1="0" x2="0.5" y2="1">
    <stop offset="0" stop-color="${c.bg[0]}"/><stop offset="1" stop-color="${c.bg[1]}"/>
  </linearGradient>
  <radialGradient id="pool-${key}" cx="0.5" cy="0.58" r="0.62">
    <stop offset="0" stop-color="currentColor" stop-opacity=".46"/>
    <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect class="p-bg" x="-40" y="-40" width="320" height="400" fill="url(#bg-${key})"/>
<ellipse cx="120" cy="150" rx="150" ry="170" fill="url(#pool-${key})"/>
${fit(c.behind)}
<path class="torso" d="${TORSO}"/>
<path class="torso-shade" d="${TORSO_SHADE}"/>
<path class="torso-rim" d="${TORSO_RIM}"/>
<path class="neck" d="M${120 - nw} ${m.chin - 46} h${nw * 2} v46 c0 13 ${-nw * 2} 13 ${-nw * 2} 0 Z"/>
<path class="neck-shade" d="M${120 - nw} ${m.chin - 46} h${nw * 2} v16 c${-nw * 0.66} 12 ${-nw * 1.34} 12 ${-nw * 2} 0 Z"/>
${headGroup(key, m)}
${fit(c.hair)}
${facesFor(m)}
${fit(c.front)}`;
};

/**
 * PENNY, the mark (portrait key 'meridian'). Same lighting rules, a different species: hard planes, one wide
 * lens band instead of eyes, and a glow it casts on itself. Five moods, because the
 * desk has five things it can feel about a pitch.
 */
const MERIDIAN = `
<defs>
  <linearGradient id="bg-meridian" x1="0" y1="0" x2="0.45" y2="1">
    <stop offset="0" stop-color="#121D2A"/><stop offset="1" stop-color="#06080B"/>
  </linearGradient>
  <radialGradient id="pool-meridian" cx="0.5" cy="0.5" r="0.66">
    <stop offset="0" stop-color="currentColor" stop-opacity=".36"/>
    <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="lens-meridian" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="currentColor" stop-opacity=".95"/>
    <stop offset="1" stop-color="currentColor" stop-opacity=".3"/>
  </linearGradient>
</defs>
<rect class="p-bg" x="-40" y="-40" width="320" height="400" fill="url(#bg-meridian)"/>
<ellipse cx="120" cy="140" rx="150" ry="170" fill="url(#pool-meridian)"/>
<path class="m-shoulder" d="M-8 320 C-8 248 50 218 120 218 C190 218 248 248 248 320 Z"/>
<path class="m-shoulder-shade" d="M120 218 C190 218 248 248 248 320 L166 320 C162 268 144 236 120 218 Z"/>
<path class="m-shoulder-rim" d="M204 320 C200 270 178 238 152 222 C190 228 228 258 236 320 Z"/>
<path class="m-collar" d="M92 220 L120 276 L148 220 L120 236 Z"/>
<rect class="m-neck" x="102" y="176" width="36" height="48" rx="6"/>
<path class="m-mast" d="M116 26 h8 v-22 h-8 Z"/>
<circle class="m-beacon" cx="120" cy="-2" r="10"/>
<path class="m-head" d="M38 26 h164 a16 16 0 0 1 16 16 v140 a16 16 0 0 1 -16 16 H38 a16 16 0 0 1 -16 -16 V42 a16 16 0 0 1 16 -16 Z"/>
<path class="m-head-shade" d="M150 26 h52 a16 16 0 0 1 16 16 v140 a16 16 0 0 1 -16 16 h-52 Z"/>
<path class="m-head-rim" d="M212 48 v128 a14 14 0 0 1 -8 12 c5 -46 5 -106 0 -152 a14 14 0 0 1 8 12 Z"/>
<rect class="m-screen" x="40" y="42" width="160" height="108" rx="10"/>
<rect class="m-visor" x="50" y="82" width="140" height="30" rx="15" fill="url(#lens-meridian)"/>
<rect class="m-jaw" x="62" y="164" width="116" height="12" rx="6"/>
<g class="m x-neutral">
  <rect class="m-pip" x="78" y="90" width="34" height="15" rx="7.5"/>
  <rect class="m-pip" x="128" y="90" width="34" height="15" rx="7.5"/>
</g>
<g class="m x-intrigued">
  <circle class="m-pip" cx="95" cy="97" r="10"/>
  <circle class="m-pip" cx="145" cy="97" r="13"/>
  <path class="m-line" d="M124 64 L170 54"/>
</g>
<g class="m x-suspicious">
  <rect class="m-pip" x="76" y="94" width="38" height="8" rx="4"/>
  <rect class="m-pip" x="126" y="94" width="38" height="8" rx="4"/>
  <path class="m-line" d="M68 66 L114 82"/>
  <path class="m-line" d="M172 66 L126 82"/>
</g>
<g class="m x-sold">
  <path class="m-line" d="M76 104 Q95 74 114 104"/>
  <path class="m-line" d="M126 104 Q145 74 164 104"/>
  <path class="m-fill" d="M84 128 Q120 168 156 128 Z"/>
</g>
<g class="m x-caught">
  <path class="m-line" d="M78 84 L110 114 M110 84 L78 114"/>
  <path class="m-line" d="M130 84 L162 114 M162 84 L130 114"/>
  <rect class="m-alarm" x="40" y="42" width="160" height="108" rx="10"/>
</g>
<rect class="m-scan" x="40" y="42" width="160" height="108" rx="10"/>`;

export const PORTRAIT_KEYS = [...Object.keys(CAST), 'meridian'];

/**
 * One portrait as SVG markup. `mood` picks the expression group and `crop` picks the
 * framing. `accent` becomes `currentColor`, which the floor pool, the rim light and
 * PENNY's lens all read from.
 */
export function portraitSvg(key, { mood = 'idle', accent = '#FFB020', title = '', crop = 'bust', cls = '' } = {}) {
  const meridian = key === 'meridian';
  const c = CAST[key];
  if (!meridian && !c) return '';
  const style = meridian
    ? `color:${accent}`
    : `color:${accent};--skin:${c.skin};--skin-shade:${c.shade};--skin-light:${c.light};--cloth:${c.cloth};--cloth-shade:${c.clothShade};--ink:${c.ink}`;
  return `<svg class="bust ${cls}" viewBox="${CROPS[crop] ?? CROPS.bust}" data-x="${mood}"
    preserveAspectRatio="xMidYMid slice" style="${style}" role="img" aria-label="${title}"
    >${meridian ? MERIDIAN : bust(key, c)}</svg>`;
}

/** Paint a portrait into a host element without touching the rest of the DOM. */
export function drawPortrait(host, key, options) {
  if (!host) return null;
  host.innerHTML = portraitSvg(key, options);
  return host.firstElementChild;
}
