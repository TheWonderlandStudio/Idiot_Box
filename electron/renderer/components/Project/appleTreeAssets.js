// Apple tree doodle assets, original artwork for the forest theme greeting mark.
// The gray and color trees share one geometry so the hover crossfade stays aligned.

const svgUrl = (body) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(body);

const treeSvg = (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none" stroke-linecap="round" stroke-linejoin="round">
<path d="M 14 84 C 30 81 66 81 82 84" stroke="${p.ground}" stroke-width="3"/>
<path d="M 22 84 C 21 80 20 78 18 76 M 26 84 C 26 79 27 77 28 75 M 70 84 C 71 80 72 78 74 76" stroke="${p.ground}" stroke-width="2.4"/>
<path d="M 44 60 C 45 68 44 76 41 84 L 55 84 C 52 76 51 68 52 60 C 49 62 47 62 44 60 Z" fill="${p.trunkFill}" stroke="${p.trunk}" stroke-width="3"/>
<path d="M 45 70 C 40 67 36 63 34 59 M 51 70 C 56 67 60 63 62 59" stroke="${p.trunk}" stroke-width="2.6"/>
<path d="M 47 68 C 47 73 46 77 45 80" stroke="${p.trunk}" stroke-width="1.6" opacity="0.7"/>
<path d="M 48 12 C 56 11 62 14 66 20 C 72 24 75 30 74 38 C 73 46 70 52 64 56 C 58 61 53 63 48 62 C 42 63 36 60 30 56 C 24 51 21 45 22 38 C 23 30 25 24 30 20 C 34 15 40 13 48 12 Z" fill="${p.canopyFill}" stroke="${p.canopy}" stroke-width="3"/>
<path d="M 33 28 C 37 24 43 23 47 26 M 55 40 C 60 37 65 38 68 42" stroke="${p.canopy}" stroke-width="1.8" opacity="0.6"/>
<g stroke="${p.apple}" stroke-width="2.4">
<circle cx="38" cy="32" r="4" fill="${p.appleFill}"/>
<circle cx="58" cy="28" r="4" fill="${p.appleFill}"/>
<circle cx="60" cy="46" r="4" fill="${p.appleFill}"/>
<circle cx="44" cy="50" r="4" fill="${p.appleFill}"/>
</g>
<path d="M 38 28 C 38 26 39 25 40 24 M 58 24 C 58 22 59 21 60 20 M 60 42 C 60 40 61 39 62 38 M 44 46 C 44 44 45 43 46 42" stroke="${p.apple}" stroke-width="1.8"/>
<path d="M 40 24 C 42 22 44 22 45 24 C 44 26 42 26 40 24 Z M 62 38 C 64 36 66 36 67 38 C 66 40 64 40 62 38 Z" fill="${p.leafFill}" stroke="${p.leaf}" stroke-width="1.6"/>
<circle cx="70" cy="80" r="3.5" fill="${p.appleFill}" stroke="${p.apple}" stroke-width="2.2"/>
<path d="M 70 76 C 70 74 71 73 72 72" stroke="${p.apple}" stroke-width="1.6"/>
<path d="M 78 18 C 80 16 82 16 83 18 C 82 20 80 20 78 18 Z" fill="${p.leafFill}" stroke="${p.leaf}" stroke-width="1.6"/>
<circle cx="16" cy="20" r="1.5" fill="${p.ground}"/>
</svg>`;

const stampSvg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none" stroke="${s}" stroke-linecap="round" stroke-linejoin="round">
<path d="M 48 6 C 70 5 90 24 90 48 C 90 71 70 90 48 90 C 26 90 6 71 6 48 C 6 25 26 7 48 6 Z" stroke-width="3"/>
<circle cx="48" cy="48" r="38" stroke-width="1.5" opacity="0.55"/>
<path d="M 48 26 C 55 25 61 29 62 35 C 67 38 67 45 63 48 C 64 54 58 58 52 56 C 48 60 42 59 39 55 C 33 56 29 50 31 45 C 28 40 31 34 36 33 C 38 28 43 26 48 26 Z" stroke-width="2.6"/>
<path d="M 45 56 C 46 62 45 66 43 70 L 53 70 C 51 66 50 62 51 56 C 49 58 47 58 45 56 Z" stroke-width="2.4"/>
<circle cx="42" cy="40" r="2.6" fill="${s}" stroke="none"/>
<circle cx="55" cy="44" r="2.6" fill="${s}" stroke="none"/>
<path d="M 32 72 C 42 70 54 70 64 72" stroke-width="2.4"/>
</svg>`;

export const appleTreeIllustration = svgUrl(treeSvg({
  ground: "#d7ddd6",
  trunk: "#d7ddd6",
  trunkFill: "none",
  canopy: "#d7ddd6",
  canopyFill: "none",
  apple: "#e6ebe5",
  appleFill: "none",
  leaf: "#d7ddd6",
  leafFill: "none",
}));

export const appleTreeIllustrationColor = svgUrl(treeSvg({
  ground: "#cfe0cb",
  trunk: "#47291a",
  trunkFill: "#96613c",
  canopy: "#1c3a29",
  canopyFill: "#63b077",
  apple: "#7e2417",
  appleFill: "#e2543e",
  leaf: "#1c3a29",
  leafFill: "#8fd19b",
}));

export const appleTreeStampGray = svgUrl(stampSvg("#a8b0a8"));