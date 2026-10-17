// "Fotos" de ejemplo generadas como SVG: la preview no incluye imágenes de clientes.
// Cada escena se recorta con `object-fit: cover`, así que sirve para cualquier proporción.

const svg = (body: string) =>
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice">${body}</svg>`,
  );

const scenes: Array<() => string> = [
  // Atardecer en el río
  () =>
    svg(`<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a3c"/><stop offset=".55" stop-color="#ffc45c"/><stop offset="1" stop-color="#fff0b8"/></linearGradient></defs>
    <rect width="300" height="400" fill="url(#a)"/><circle cx="150" cy="215" r="48" fill="#fff6cf"/>
    <rect y="240" width="300" height="160" fill="#2d5b7a"/><rect x="90" y="250" width="120" height="6" rx="3" fill="#fff0b8" opacity=".8"/>
    <rect x="110" y="266" width="80" height="5" rx="2.5" fill="#fff0b8" opacity=".6"/><rect x="125" y="282" width="50" height="4" rx="2" fill="#fff0b8" opacity=".4"/>
    <path d="M0 240 L60 205 L120 240Z M170 240 L240 195 L300 240Z" fill="#1f3d54"/>`),
  // Montañas y lago
  () =>
    svg(`<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6db3e8"/><stop offset="1" stop-color="#d8efff"/></linearGradient></defs>
    <rect width="300" height="400" fill="url(#a)"/><path d="M0 250 L90 120 L150 200 L210 100 L300 250Z" fill="#5b6fa8"/>
    <path d="M90 120 L112 152 L98 148 L88 160 L76 146Z M210 100 L236 142 L220 138 L208 152 L196 136Z" fill="#fff"/>
    <rect y="250" width="300" height="150" fill="#3f8fb0"/><path d="M0 250 L90 120 L150 200 L210 100 L300 250Z" fill="#5b6fa8" opacity=".35" transform="translate(0 500) scale(1 -1)"/>`),
  // Campo de flores
  () =>
    svg(`<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd6f5"/><stop offset="1" stop-color="#eaf7ff"/></linearGradient></defs>
    <rect width="300" height="400" fill="url(#a)"/><ellipse cx="80" cy="330" rx="260" ry="120" fill="#5aa84b"/><ellipse cx="250" cy="360" rx="220" ry="110" fill="#3f8f3b"/>
    <rect x="210" y="170" width="14" height="110" fill="#6b4a2b"/><circle cx="217" cy="150" r="52" fill="#2f7a35"/>
    ${[...Array(18)].map((_, i) => `<circle cx="${20 + ((i * 53) % 270)}" cy="${300 + ((i * 37) % 90)}" r="6" fill="${['#ffd23f', '#ff5d73', '#fff', '#ff9f1c'][i % 4]}"/>`).join('')}`),
  // Retrato
  () =>
    svg(`<rect width="300" height="400" fill="#f2d08a"/><circle cx="150" cy="170" r="70" fill="#f2d08a" opacity=".0"/>
    <path d="M30 400 C40 300 110 285 150 285 C190 285 260 300 270 400Z" fill="#c4423a"/><rect x="132" y="250" width="36" height="50" fill="#e8b48f"/>
    <circle cx="150" cy="195" r="62" fill="#efc1a0"/><path d="M86 190 C80 120 140 100 170 112 C210 120 220 160 214 192 C200 150 150 140 120 150 C102 156 92 172 86 190Z" fill="#3b2a20"/>
    <circle cx="128" cy="200" r="5" fill="#2b1d16"/><circle cx="172" cy="200" r="5" fill="#2b1d16"/><path d="M130 224 Q150 240 170 224" stroke="#9a3b30" stroke-width="5" fill="none" stroke-linecap="round"/>`),
  // Cumpleaños
  () =>
    svg(`<rect width="300" height="400" fill="#3a1f5c"/>
    ${[...Array(34)].map((_, i) => `<rect x="${(i * 47) % 300}" y="${(i * 71) % 260}" width="9" height="9" rx="2" fill="${['#ffc914', '#ff5d73', '#55d6be', '#fff'][i % 4]}" transform="rotate(${i * 25} ${(i * 47) % 300} ${(i * 71) % 260})"/>`).join('')}
    <rect x="70" y="260" width="160" height="80" rx="10" fill="#ff8fab"/><rect x="70" y="260" width="160" height="22" rx="10" fill="#fff"/>
    <rect x="100" y="215" width="100" height="50" rx="8" fill="#ffd6e0"/><rect x="146" y="180" width="8" height="38" fill="#ffc914"/><path d="M150 150 Q160 168 150 178 Q140 168 150 150Z" fill="#ff9f1c"/>`),
  // Ciudad de noche
  () =>
    svg(`<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1b3d"/><stop offset="1" stop-color="#3a3f7a"/></linearGradient></defs>
    <rect width="300" height="400" fill="url(#a)"/><circle cx="235" cy="85" r="26" fill="#fff6cf"/>
    ${[
      [10, 230, 60],
      [70, 190, 50],
      [118, 250, 56],
      [170, 170, 58],
      [226, 215, 64],
    ]
      .map(
        ([x, y, w]) =>
          `<rect x="${x}" y="${y}" width="${w}" height="${400 - y}" fill="#141a33"/>${[...Array(12)].map((_, k) => `<rect x="${x + 8 + (k % 3) * 16}" y="${y + 12 + Math.floor(k / 3) * 26}" width="8" height="12" fill="${k % 5 === 0 ? '#3a3f7a' : '#ffc914'}"/>`).join('')}`,
      )
      .join('')}`),
  // Foto antigua (sepia)
  () =>
    svg(`<defs><radialGradient id="v" cx=".5" cy=".5" r=".75"><stop offset=".5" stop-color="#d9bf93" stop-opacity="0"/><stop offset="1" stop-color="#5a3f1d" stop-opacity=".7"/></radialGradient></defs>
    <rect width="300" height="400" fill="#d9bf93"/><rect x="40" y="300" width="220" height="12" fill="#a8895a" opacity=".5"/>
    <circle cx="115" cy="170" r="30" fill="#8a6a3f"/><path d="M70 330 C70 250 90 215 115 215 C140 215 160 250 160 330Z" fill="#6b4f2c"/>
    <circle cx="190" cy="190" r="24" fill="#8a6a3f"/><path d="M155 330 C155 265 172 233 190 233 C208 233 228 265 228 330Z" fill="#7d5d36"/>
    <rect width="300" height="400" fill="url(#v)"/><path d="M0 120 L300 160" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>`),
  // Playa
  () =>
    svg(`<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#37b6ff"/><stop offset="1" stop-color="#bff0ff"/></linearGradient></defs>
    <rect width="300" height="400" fill="url(#a)"/><circle cx="240" cy="70" r="34" fill="#fff59d"/>
    <rect y="210" width="300" height="70" fill="#1f95d6"/><path d="M0 235 Q40 220 80 235 T160 235 T240 235 T320 235" stroke="#fff" stroke-width="4" fill="none" opacity=".7"/>
    <rect y="280" width="300" height="120" fill="#f2dca3"/><rect x="146" y="250" width="6" height="110" fill="#6b4a2b"/>
    <path d="M70 255 Q150 170 230 255Z" fill="#ff5d73"/><path d="M110 255 Q150 200 190 255Z" fill="#fff" opacity=".85"/>`),
  // Otoño
  () =>
    svg(`<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#ffe3a8"/></linearGradient></defs>
    <rect width="300" height="400" fill="url(#a)"/><rect y="320" width="300" height="80" fill="#c26a2b"/>
    ${[40, 130, 215, 280].map((x, i) => `<rect x="${x - 7}" y="${190 + i * 8}" width="14" height="140" fill="#5a3a1f"/><circle cx="${x}" cy="${170 + i * 8}" r="${48 - i * 3}" fill="${['#d9541e', '#f08a24', '#c93b1c', '#e8a21c'][i]}"/>`).join('')}`),
  // Globos
  () =>
    svg(`<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fd0ff"/><stop offset="1" stop-color="#e5f7ff"/></linearGradient></defs>
    <rect width="300" height="400" fill="url(#a)"/>
    ${[
      [70, 150, '#ff5d73'],
      [150, 110, '#ffc914'],
      [225, 160, '#55d6be'],
      [110, 230, '#9b5de5'],
      [195, 245, '#ff9f1c'],
    ]
      .map(
        ([x, y, c]) =>
          `<path d="M${x} ${Number(y) + 62} Q${Number(x) + 6} ${Number(y) + 130} ${Number(x) - 4} ${Number(y) + 190}" stroke="#555" stroke-width="2" fill="none"/><ellipse cx="${x}" cy="${y}" rx="40" ry="50" fill="${c}"/><ellipse cx="${Number(x) - 12}" cy="${Number(y) - 18}" rx="8" ry="13" fill="#fff" opacity=".45"/>`,
      )
      .join('')}`),
];

export const SAMPLE_COUNT = scenes.length;
const cache = new Map<number, string>();

export function samplePhoto(i: number): string {
  const k = ((i % SAMPLE_COUNT) + SAMPLE_COUNT) % SAMPLE_COUNT;
  let v = cache.get(k);
  if (!v) {
    v = scenes[k]();
    cache.set(k, v);
  }
  return v;
}
