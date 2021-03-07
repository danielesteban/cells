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
const types = {
  air: 0x00,
  clay: 0x01,
  sand: 0x02,
  water: 0x03,
};
const actions = {
  // These map to mouse buttons
  erase: 0x02,
  paint: 0x00,
};
const air = new Uint8ClampedArray(4);
const cell = new Uint8ClampedArray(4);
const test = (x, y) => {
  if (x < 0 || x >= renderer.width || y < 0 || y >= renderer.height) {
    // Out of bounds
    return -1;
  }
  const index = renderer.index(x, y);
  const type = renderer.pixels.data[index + 3]; // The type is stored in the alpha channel
  return type === types.air ? index : false;
};

const water = {
  state: new Float32Array(renderer.width * renderer.height),
  step: new Float32Array(renderer.width * renderer.height),
};
const massIndex = (x, y) => {
  const { width, height } = renderer;
  return (height - 1 - y) * width + x;
};
const maxMass = 1.0; // The un-pressurized mass of a full water cell
const maxCompress = 0.02; // How much excess water a cell can store, compared to the cell above it
const minFlow = 0.1;
const getStableState = (total_mass) => {
  if (total_mass <= 1) {
    return 1;
  } else if (total_mass < 2 * maxMass + maxCompress) {
    return (maxMass ** 2 + total_mass * maxCompress) / (maxMass + maxCompress);
  }
  return (total_mass + maxCompress) / 2;
};

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
        const index = renderer.index(px, py);
        switch (input.action) {
          case actions.erase:
            pixels.data.set(air, index);
            break;
          case actions.paint:
            switch (input.type) {
              case types.clay:
                const l = 0x33 + (Math.random() * 0x33);
                pixels.data.set([
                  l + (Math.random() * 0x33),
                  l + (Math.random() * 0x33),
                  l - (Math.random() * 0x33),
                  input.type,
                ], index);
                water.state[index / 4] = water.step[index / 4] = 0;
                break;
              case types.sand:
                if (Math.random() > 0.3) {
                  pixels.data.set([
                    0x55 + (Math.random() * 0x55),
                    0x55 + (Math.random() * 0x55),
                    0,
                    input.type,
                  ], index);
                } else {
                  pixels.data.set([
                    0x55 + (Math.random() * 0x55),
                    0x55 + (Math.random() * 0x55),
                    0x55 + (Math.random() * 0x55),
                    input.type,
                  ], index);
                }
                water.state[index / 4] = water.step[index / 4] = 0;
                break;
              case types.water:
                pixels.data.set(air, index);
                water.state[index / 4] = water.step[index / 4] = 0.5;
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
          const index = renderer.index(x, y);
          if (pixels.data[index + 3] === types.sand) {
            const target = (
              test(x, y - 1)
              || test(x - nx, y - 1)
              || test(x + nx, y - 1)
              || test(x + nx * 2, y - 1)
              || test(x - nx * 2, y - 1)
            );
            if (target !== false) {
              if (target >= 0) {
                // Swap pixel with target position
                cell.set(pixels.data.subarray(target, target + 4));
                pixels.data.copyWithin(target, index, index + 4);
                pixels.data.set(cell, index);
                water.state[index / 4] = water.step[index / 4] = water.state[target / 4];
                water.state[target / 4] = water.step[target / 4] = 0;
              } else {
                // Destroy cell
                pixels.data.set(air, index);
              }
            }
          }
        }
      }
    }

    // Simulate water
    for (let x = 1; x < (width - 1); x += 1) {
      for (let y = 1; y < (height - 1); y += 1) {
        if (pixels.data[renderer.index(x, y) + 3] !== types.air) {
          continue;
        }

        let remainingMass = water.state[massIndex(x, y)];
        if (remainingMass <= 0) {
          continue;
        }

        if (pixels.data[renderer.index(x, y - 1) + 3] === types.air) {
          let flow = (
            getStableState(remainingMass + water.state[massIndex(x, y - 1)])
            - water.state[massIndex(x, y - 1)]
          );
          flow = Math.min(Math.max(flow > minFlow ? flow * 0.5 : flow, 0), 1, remainingMass);
          water.step[massIndex(x, y)] -= flow;
          water.step[massIndex(x, y - 1)] += flow;
          remainingMass -= flow;
        }

        if (remainingMass <= 0) {
          continue;
        }

        if (pixels.data[renderer.index(x - 1, y) + 3] === types.air) {
          let flow = (water.state[massIndex(x, y)] - water.state[massIndex(x - 1, y)]) / 4;
          flow = Math.min(Math.max(flow > minFlow ? flow * 0.5 : flow, 0), remainingMass);
          water.step[massIndex(x, y)] -= flow;
          water.step[massIndex(x - 1, y)] += flow;
          remainingMass -= flow;
        }

        if (remainingMass <= 0) {
          continue;
        }

        if (pixels.data[renderer.index(x + 1, y) + 3] === types.air) {
          let flow = (water.state[massIndex(x, y)] - water.state[massIndex(x + 1, y)]) / 4;
          flow = Math.min(Math.max(flow > minFlow ? flow * 0.5 : flow, 0), remainingMass);
          water.step[massIndex(x, y)] -= flow;
          water.step[massIndex(x + 1, y)] += flow;
          remainingMass -= flow;
        }

        if (remainingMass <= 0) {
          continue;
        }

        if (pixels.data[renderer.index(x, y + 1) + 3] === types.air) {
          let flow = remainingMass - getStableState(remainingMass + water.state[massIndex(x, y + 1)]);
          flow = Math.min(Math.max(flow > minFlow ? flow * 0.5 : flow, 0), 1, remainingMass);
          water.step[massIndex(x, y)] -= flow;
          water.step[massIndex(x, y + 1)] += flow;
        }
      }
    }

    // Remove water at the edges
    for (let x = 0; x < width; x += 1) {
      water.step[massIndex(x, 0)] = 0;
      water.step[massIndex(x, height - 1)] = 0;
    }
    for (let y = 0; y < height; y += 1) {
      water.step[massIndex(0, y)] = 0;
      water.step[massIndex(width - 1, y)] = 0;
    }

    // Copy the new mass values into the state array
    water.state.set(water.step);
  }

  // Update air/water pixels
  for (let x = 0; x < width; x += 1) {
    for(let y = 0; y < height; y += 1) {
      const index = renderer.index(x, y);
      if (pixels.data[index + 3] === types.air) {
        const m = water.state[massIndex(x, y)];
        const hasWater = m >= 0.001;
        pixels.data[index] = hasWater ? 0x22 : 0;
        pixels.data[index + 1] = hasWater ? 0x44 * (2 - Math.min(Math.max(m, 1), 1.25)) : 0;
        pixels.data[index + 2] = hasWater ? 0x88 * (2 - Math.min(Math.max(m, 1), 1.25)) : 0;
      }
    }
  }

  // Render
  renderer.render();
  renderer.debug.innerText = `${Math.floor(performance.now() - frameTime)}ms`;
};
requestAnimationFrame(animate);
