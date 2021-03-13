import 'https://cdn.jsdelivr.net/npm/simplex-noise@2.4.0/simplex-noise.js';

function Generator({
  types,
  cells,
  water,
  color,
  light,
  input,
  width,
  height,
  cellIndex,
}) {
  const noise = new SimplexNoise();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = cellIndex(x, y);
      const n = (
        noise.noise2D(x / 128, y / 128) * 0.6
        + noise.noise2D(x / 64, y / 32) * 0.3
        + noise.noise2D(x / 32, y / 32) * 0.1
        + noise.noise2D(x / 16, y / 16) * 0.1
      ) * 0.5 + 0.5;
      if (n > 0.475) {
        const type = n > 0.5 ? types.clay : types.sand;
        cells[index] = type;
        const { r, g, b, l } = input.colors[type];
        const light = type === types.clay ? (1.25 - n * 0.5) : 1;
        color.buffer.set([
          Math.floor((r + (Math.random() - 0.5) * input.noise * 2 * l) * light),
          Math.floor((g + (Math.random() - 0.5) * input.noise * 2 * l) * light),
          Math.floor((b + (Math.random() - 0.5) * input.noise * 2 * l) * light),
        ], index * 3);
      }
    }
  }
}

export default Generator;
