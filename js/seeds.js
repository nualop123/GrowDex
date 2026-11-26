/* Item pictures.
   If js/icons.js exists (made by tools/make_icons.py from your own game files),
   its pictures are used. Otherwise each item gets a drawn seed whose colours
   and pattern come from a hash of its name, so the same item always looks the same.
   A colour in the name (Red Crystal, Silk Bolt - Aqua) colours the seed. */
(function () {
  'use strict';
  let uid = 0;
  const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const BODY = 'M32 10C46 10 52 25 52 37C52 49 43 55 32 55S12 49 12 37C12 25 18 10 32 10Z';
  const PATTERNS = [
    '<circle cx="24" cy="30" r="5"/><circle cx="40" cy="38" r="6"/><circle cx="28" cy="47" r="4"/>',
    '<path d="M0 40L40 0h10L0 50zM10 64L64 10v10L20 64z"/>',
    '<rect x="0" y="38" width="64" height="30"/>',
    '<path d="M10 30q11-10 22 0t22 0v8q-11-10-22 0t-22 0z"/>'
  ];
  const SPROUT = '<path d="M32 12C30 4 22 2 16 4c2 7 9 10 16 8z" fill="#5cc23a" stroke="#2c6e18" stroke-width="2"/><path d="M33 12c2-7 9-9 15-7-2 7-9 9-15 7z" fill="#7ad655" stroke="#2c6e18" stroke-width="2"/>';
  const COLOURS = {
    red: [0, 70, 50], green: [120, 55, 42], blue: [218, 72, 52], white: [210, 15, 90], black: [230, 10, 22],
    aqua: [185, 70, 50], cyan: [185, 70, 50], teal: [178, 60, 36], grey: [220, 6, 58], gray: [220, 6, 58],
    silver: [215, 12, 72], purple: [275, 55, 52], violet: [275, 55, 52], pink: [330, 80, 70], magenta: [310, 70, 52],
    yellow: [50, 90, 55], orange: [28, 90, 54], brown: [25, 45, 36], gold: [44, 85, 52], golden: [44, 85, 52],
    emerald: [150, 65, 38], lime: [90, 70, 48], autumn: [22, 70, 45], pineapple: [52, 85, 52]
  };
  const COLOUR_RE = new RegExp('\\b(' + Object.keys(COLOURS).join('|') + ')\\b', 'i');
  const EGG = '<svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="57" rx="15" ry="4" fill="rgba(0,0,0,.2)"/><path d="M32 6C44 6 52 26 52 38C52 50 43 56 32 56S12 50 12 38C12 26 20 6 32 6Z" fill="#ffd6ec" stroke="#b05a8a" stroke-width="2.5"/><path d="M14 34l6-5 6 5 6-5 6 5 6-5 6 5" fill="none" stroke="#7fd3f0" stroke-width="4"/><path d="M13 43l6-4 6 4 6-4 6 4 6-4 7 4" fill="none" stroke="#fff27a" stroke-width="4"/><ellipse cx="24" cy="20" rx="4" ry="7" fill="#fff" opacity=".6" transform="rotate(20 24 20)"/></svg>';

  window.GS_SEED = function (name, sprout) {
    const icons = window.GS_ICONS;
    if (icons && icons[name]) return `<img class="pic" src="${icons[name]}" alt="">`;
    if (name === 'Magic Egg') return EGG;
    const h = hash(name), id = 'gs' + (uid++), p = (h >>> 18) % 4, m = COLOUR_RE.exec(name);
    const [h1, s1, l1] = m ? COLOURS[m[1].toLowerCase()] : [h % 360, 62, 50];
    const h2 = m ? h1 : (h >>> 9) % 360, l2 = m ? Math.min(92, l1 + 16) : 62, edge = Math.max(10, l1 - 28);
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><clipPath id="${id}"><path d="${BODY}"/></clipPath></defs>` +
      `<ellipse cx="32" cy="58" rx="16" ry="4" fill="rgba(0,0,0,.22)"/><path d="${BODY}" fill="hsl(${h1} ${s1}% ${l1}%)"/>` +
      `<g clip-path="url(#${id})" fill="hsl(${h2} ${m ? s1 : 75}% ${l2}%)">${PATTERNS[p]}</g>` +
      `<path d="${BODY}" fill="none" stroke="hsl(${h1} ${Math.min(s1, 55)}% ${edge}%)" stroke-width="2.5"/>` +
      `<ellipse cx="24" cy="24" rx="4" ry="8" fill="#fff" opacity=".5" transform="rotate(25 24 24)"/>${sprout ? SPROUT : ''}</svg>`;
  };
})();
