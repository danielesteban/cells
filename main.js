import Renderer from './renderer.js';

// Setup
const renderer = new Renderer({
  ...(navigator.userAgent.includes('Mobile') ? {
    width: 140,
    height: 260,
  } : {
    width: 320,
    height: 240,
  }),
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
      '1-3: Select cell type',
      'Esc: Clear canvas',
    ].forEach((text, i) => {
      ctx.fillText(text, width * 0.5, height * (0.6 + i * 0.075));
    });
  },
});

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
const air = new Uint8ClampedArray(3);
const cell = new Uint8ClampedArray(3);
const cells = new Uint8ClampedArray(renderer.width * renderer.height);
const water = {
  state: new Float32Array(renderer.width * renderer.height),
  step: new Float32Array(renderer.width * renderer.height),
};

const cellIndex = (x, y) => {
  const { width, height } = renderer;
  return (height - 1 - y) * width + x;
};
const test = (x, y) => {
  if (x < 0 || x >= renderer.width || y < 0 || y >= renderer.height) {
    // Out of bounds
    return -1;
  }
  const index = cellIndex(x, y);
  const type = cells[index];
  return type === types.air ? index : false;
};

const maxMass = 1.0; // The un-pressurized mass of a full water cell
const maxCompress = 0.02; // How much excess water a cell can store, compared to the cell above it
const minFlow = 0.1;
const getStableState = (totalMass) => {
  if (totalMass <= 1) {
    return 1;
  } else if (totalMass < 2 * maxMass + maxCompress) {
    return (maxMass ** 2 + totalMass * maxCompress) / (maxMass + maxCompress);
  }
  return (totalMass + maxCompress) / 2;
};

renderer.onClear = () => {
  cells.fill(0);
  water.state.fill(0);
  water.step.set(water.state);
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
      for (let i = 0; i < 6; i += 1) {
        const px = Math.min(Math.max(Math.floor(input.x + (Math.random() - 0.5) * 5), 0), width - 1);
        const py = Math.min(Math.max(Math.floor(input.y + (Math.random() - 0.5) * 5), 0), height - 1);
        const index = cellIndex(px, py);
        switch (input.action) {
          case actions.erase:
            cells[index] = types.air;
            pixels.data.set(air, index * 4);
            break;
          case actions.paint:
            switch (input.type) {
              case types.clay:
                cells[index] = input.type;
                water.state[index] = water.step[index] = 0;
                const l = 0x33 + (Math.random() * 0x33);
                pixels.data.set([
                  l + (Math.random() * 0x33),
                  l + (Math.random() * 0x33),
                  l - (Math.random() * 0x33),
                ], index * 4);
                break;
              case types.sand:
                cells[index] = input.type;
                water.state[index] = water.step[index] = 0;
                if (Math.random() > 0.3) {
                  pixels.data.set([
                    0x55 + (Math.random() * 0x55),
                    0x55 + (Math.random() * 0x55),
                    0,
                  ], index * 4);
                } else {
                  pixels.data.set([
                    0x55 + (Math.random() * 0x55),
                    0x55 + (Math.random() * 0x55),
                    0x55 + (Math.random() * 0x55),
                  ], index * 4);
                }
                break;
              case types.water:
                cells[index] = types.air;
                water.state[index] = water.step[index] = 0.5;
                pixels.data.set(air, index * 4);
                break;
            }
            break;
        }
      }
    }

    // Simulate sand
    if (step % 4 === 0) {
      const s = step % 8 === 0;
      const nx = s ? 1 : -1;
      for (let y = 0; y < height; y += 1) {
        for (let sx = 0; sx < width; sx += 1) {
          const x = s ? sx : (width - 1 - sx);
          const index = cellIndex(x, y);
          if (cells[index] !== types.sand) {
            continue;
          }
          const target = (
            test(x, y - 1)
            || test(x - nx, y - 1)
            || test(x + nx, y - 1)
            || test(x + nx * 2, y - 1)
            || test(x - nx * 2, y - 1)
          );
          if (target !== false) {
            if (target >= 0) {
              // Swap cell with target position
              cells[index] = cells[target];
              cells[target] = types.sand;
              water.state[index] = water.step[index] = water.state[target];
              water.state[target] = water.step[target] = 0;
              cell.set(pixels.data.subarray(target * 4, (target * 4) + 3));
              pixels.data.copyWithin(target * 4, index * 4, (index * 4) + 3);
              pixels.data.set(cell, index * 4);
            } else {
              // Destroy cell
              cells[index] = types.air;
              pixels.data.set(air, index * 4);
            }
          }
        }
      }
    }

    // Simulate water
    for (let x = 1; x < (width - 1); x += 1) {
      for (let y = 1; y < (height - 1); y += 1) {
        const index = cellIndex(x, y);
        if (cells[index] !== types.air) {
          continue;
        }
        let remainingMass = water.state[index];
        for (let n = 0; remainingMass > 0 && n < 4; n += 1) {
          let neighbor;
          switch (n) {
            case 0:
              neighbor = cellIndex(x, y - 1);
              break;
            case 1:
              neighbor = cellIndex(x - 1, y);
              break;
            case 2:
              neighbor = cellIndex(x + 1, y);
              break;
            case 3:
              neighbor = cellIndex(x, y + 1);
              break;
          }
          if (cells[neighbor] !== types.air) {
            continue;
          }
          let flow;
          switch (n) {
            case 0:
              flow = (
                getStableState(remainingMass + water.state[neighbor])
                - water.state[neighbor]
              );
              break;
            case 1:
            case 2:
              // Equalize the amount of water between neighbors
              flow = (water.state[index] - water.state[neighbor]) / 4;
              break;
            case 3:
              // Only compressed water flows upwards
              flow = remainingMass - getStableState(remainingMass + water.state[neighbor]);
              break;
          }
          flow = Math.min(Math.max(flow > minFlow ? flow * 0.5 : flow, 0), 1, remainingMass);
          water.step[index] -= flow;
          water.step[neighbor] += flow;
          remainingMass -= flow;
        }
      }
    }

    // Remove water at the edges
    for (let x = 0; x < width; x += 1) {
      water.step[cellIndex(x, 0)] = 0;
      water.step[cellIndex(x, height - 1)] = 0;
    }
    for (let y = 0; y < height; y += 1) {
      water.step[cellIndex(0, y)] = 0;
      water.step[cellIndex(width - 1, y)] = 0;
    }

    // Copy the new mass values into the state array
    water.state.set(water.step);
  }

  // Update air/water pixels
  for (let i = 0; i < (width * height); i += 1) {
    if (cells[i] !== types.air) {
      continue;
    }
    const m = water.state[i];
    if (m >= 0.001) {
      pixels.data.set([
        0x22,
        0x44 * (2 - Math.min(Math.max(m, 1), 1.25)),
        0x88 * (2 - Math.min(Math.max(m, 1), 1.25)),
      ], i * 4);
    } else {
      pixels.data.set(air, i * 4);
    }
  }

  // Render
  renderer.render();
  renderer.debug.innerText = `${Math.floor(performance.now() - frameTime)}ms`;
};
requestAnimationFrame(animate);
