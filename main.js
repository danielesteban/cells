import Renderer from './renderer.js';

// Setup
const actions = {
  // These map to mouse buttons
  erase: 0x02,
  paint: 0x00,
};
const types = {
  air: 0x00,
  clay: 0x01,
  sand: 0x02,
  water: 0x03,
};
const renderer = new Renderer({
  dom: document.getElementById('renderer'),
  pixels: ({ ctx, width, height }) => {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#339';
    ctx.font = '700 18px monospace';
    ctx.fillText('CELLS', width * 0.5, height * 0.2);
    ctx.fillStyle = '#aaa';
    ctx.font = '700 13px monospace';
    ctx.fillText('dani@gatunes © 2021', width * 0.5, height * 0.3);
    ctx.fillStyle = '#eee';
    ctx.font = '700 10px monospace';
    [
      'Left click: Paint',
      'Right click: Erase',
      '1-4: Select cell type',
      'Esc: Clear canvas',
    ].forEach((text, i) => {
      ctx.fillText(text, width * 0.5, height * (0.6 + i * 0.075));
    });
  },
  types: [
    { id: types.clay, name: 'CLAY', color: { r: 0x66, g: 0x66, b: 0x33 } },
    { id: types.sand, name: 'SAND', color: { r: 0x66, g: 0x66, b: 0x00 } },
    { id: types.water, name: 'WATER', color: { r: 0x22, g: 0x44, b: 0x88 } },
    { id: types.air, name: 'AIR', color: { r: 0, g: 0, b: 0 } },
  ],
});

const cells = new Uint8ClampedArray(renderer.width * renderer.height);
const water = {
  state: new Float32Array(renderer.width * renderer.height),
  step: new Float32Array(renderer.width * renderer.height),
};
const pixel = new Uint8ClampedArray(3);
const neighbors = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];

const maxMass = 1.0; // The un-pressurized mass of a full water cell
const maxCompress = 0.02; // How much excess water a cell can store, compared to the cell above it
const getStableState = (totalMass) => {
  // This function is used to compute how water should be split among two vertically adjacent cells.
  // It returns the amount of water that should be in the bottom cell.
  if (totalMass <= 1) {
    return 1;
  }
  if (totalMass < maxMass * 2 + maxCompress) {
    return (maxMass ** 2 + totalMass * maxCompress) / (maxMass + maxCompress);
  }
  return (totalMass + maxCompress) / 2;
};

const cellIndex = (x, y) => {
  const { width, height } = renderer;
  if (x < 0 || x >= width || y < 0 || y >= height) {
    // Out of bounds
    return -1;
  }
  return (height - 1 - y) * width + x;
};
const testCell = (x, y) => {
  const index = cellIndex(x, y);
  return (index === -1 || cells[index] === types.air) ? index : false;
};

renderer.onClear = () => {
  cells.fill(0);
  water.state.fill(0);
  water.step.fill(0);
};
for (let i = 0, l = renderer.pixels.data.length; i < l; i += 4) {
  if (
    renderer.pixels.data[i] !== 0
    || renderer.pixels.data[i + 1] !== 0
    || renderer.pixels.data[i + 2] !== 0
  ) {
    cells[i / 4] = types.clay;
  }
}

// Main loop
let lastFrameTime = performance.now();
const animate = () => {
  requestAnimationFrame(animate);

  const frameTime = performance.now();
  const delta = Math.min((frameTime - lastFrameTime) / 1000, 1 / 30);
  lastFrameTime = frameTime;

  const steps = Math.floor(200 * delta) * 2;
  const { input, pixels, width, height } = renderer;
  for (let step = 0; step < steps; step += 1) {
    // Process Input
    if (input.action !== false) {
      input.brushOffsets.forEach(({ x, y }) => {
        if (Math.random() >= 0.5) {
          return;
        }
        const index = cellIndex(
          Math.min(Math.max(input.x + x, 0), width - 1),
          Math.min(Math.max(input.y + y, 0), height - 1)
        );
        if (input.type === types.air || input.action === actions.erase) {
          cells[index] = types.air;
          if (input.action === actions.paint) {
            water.state[index] = water.step[index] = 0;
          }
        } else {
          switch (input.type) {
            case types.clay:
            case types.sand: {
              const color = input.colors[input.type];
              cells[index] = input.type;
              water.state[index] = water.step[index] = 0;
              pixels.data.set([
                color.r + (Math.random() - 0.5) * input.noise * 2 * color.l,
                color.g + (Math.random() - 0.5) * input.noise * 2 * color.l,
                color.b + (Math.random() - 0.5) * input.noise * 2 * color.l,
              ], index * 4);
              break;
            }
            case types.water:
              cells[index] = types.air;
              water.state[index] = water.step[index] = 0.5;
              break;
          }
        }
      });
    }

    // Simulate sand
    if (step % 2 === 0) {
      const s = step % 4 === 0;
      const nx = s ? 1 : -1;
      for (let y = 0; y < height; y += 1) {
        for (let sx = 0; sx < width; sx += 1) {
          const x = s ? sx : (width - 1 - sx);
          const index = cellIndex(x, y);
          if (cells[index] !== types.sand) {
            continue;
          }
          const target = (
            testCell(x, y - 1)
            || testCell(x - nx, y - 1)
            || testCell(x + nx, y - 1)
            || testCell(x + nx * 2, y - 1)
            || testCell(x - nx * 2, y - 1)
          );
          if (target === false) {
            continue;
          }
          if (target === -1) {
            // Destroy cell
            cells[index] = types.air;
          } else {
            // Swap cell with target position
            cells[index] = cells[target];
            cells[target] = types.sand;
            water.state[index] = water.step[index] = water.state[target];
            water.state[target] = water.step[target] = 0;
            pixel.set(pixels.data.subarray(target * 4, (target * 4) + 3));
            pixels.data.copyWithin(target * 4, index * 4, (index * 4) + 3);
            pixels.data.set(pixel, index * 4);
          }
        }
      }
    }

    // Simulate water
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = cellIndex(x, y);
        if (cells[index] !== types.air) {
          continue;
        }
        const mass = water.state[index];
        for (let remainingMass = mass, n = 0; remainingMass > 0 && n < 4; n += 1) {
          const neighbor = cellIndex(x + neighbors[n].x, y + neighbors[n].y);
          if (neighbor !== -1 && cells[neighbor] !== types.air) {
            continue;
          }
          const neighborMass = neighbor !== -1 ? water.state[neighbor] : 0;
          let flow;
          switch (n) {
            case 0: // Down
              flow = getStableState(remainingMass + neighborMass) - neighborMass;
              break;
            case 1: // Left
            case 2: // Right
              // Equalize the amount of water between neighbors
              flow = (mass - neighborMass) / 4;
              break;
            case 3: // Up
              // Only compressed water flows upwards
              flow = remainingMass - getStableState(remainingMass + neighborMass);
              break;
          }
          flow = Math.min(Math.max(flow > 0.1 ? flow * 0.5 : flow, 0), remainingMass, 1);
          water.step[index] -= flow;
          if (neighbor !== -1) {
            water.step[neighbor] += flow;
          }
          remainingMass -= flow;
        }
      }
    }
    water.state.set(water.step);
  }

  // Update air/water pixels
  const airColor = input.colors[types.air];
  const waterColor = input.colors[types.water];
  pixel.set([airColor.r, airColor.g, airColor.b]);
  for (let i = 0; i < (width * height); i += 1) {
    if (cells[i] !== types.air) {
      continue;
    }
    const mass = water.state[i];
    if (mass >= 0.001) {
      const l = (2 - Math.min(Math.max(mass, 1), 1.25));
      pixels.data.set([
        waterColor.r * l,
        waterColor.g * l,
        waterColor.b * l,
      ], i * 4);
    } else {
      pixels.data.set(pixel, i * 4);
    }
  }

  // Render
  renderer.render();
  renderer.debug.innerText = `${Math.floor(performance.now() - frameTime)}ms`;
};
requestAnimationFrame(animate);
