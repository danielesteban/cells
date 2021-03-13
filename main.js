import Generator from './generator.js';
import Renderer from './renderer.js';

// Setup
const types = {
  air: 0x00,
  clay: 0x01,
  light: 0x02,
  sand: 0x03,
  water: 0x04,
};
const renderer = new Renderer({
  shader: `
    float luminance = (
      texture2D(light, uv - pixel).x
      + texture2D(light, uv + vec2(0, -pixel.y)).x
      + texture2D(light, uv + vec2(pixel.x, -pixel.y)).x
      + texture2D(light, uv + vec2(-pixel.x, 0)).x
      + texture2D(light, uv).x
      + texture2D(light, uv + vec2(pixel.x, 0)).x
      + texture2D(light, uv + vec2(-pixel.x, pixel.y)).x
      + texture2D(light, uv + vec2(0, pixel.y)).x
      + texture2D(light, uv + pixel).x
    ) / 9.0;
    luminance *= luminance;
    vec3 col = texture2D(color, uv).xyz;
    if (luminance > 0.0) {
      vec3 blur = (
        texture2D(color, uv + pixel).xyz
        + texture2D(color, uv - pixel).xyz
        + texture2D(color, uv + vec2(pixel.x, -pixel.y)).xyz
        + texture2D(color, uv + vec2(-pixel.x, pixel.y)).xyz
      ) / 4.0;
      col = mix(col, blur, luminance * 0.5);
    }
    col = blendSoftLight(col, vec3(0.5 + luminance * 0.5));
    gl_FragColor = vec4(col, 1.0);
  `,
  textures: [
    {
      id: 'color',
      format: 'rgb',
      image: ({ ctx, width, height, isMobile }) => {
        ctx.shadowBlur = 2;
        ctx.shadowColor = '#333';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#eee';
        ctx.font = '700 18px monospace';
        ctx.fillText('CELLS', width * 0.5, height * 0.2);
        ctx.fillStyle = '#666';
        ctx.font = '700 13px monospace';
        ctx.fillText('dani@gatunes © 2021', width * 0.5, height * 0.3);
        ctx.fillStyle = '#ccc';
        ctx.font = '700 10px monospace';
        if (isMobile) {
          ctx.fillText('Tap to Paint', width * 0.5, height * 0.7);
          return;
        }
        [
          'Left click: Paint',
          'Right click: Erase',
          '1-4: Select cell type',
          'Esc: Clear canvas',
        ].forEach((text, i) => {
          ctx.fillText(text, width * 0.5, height * (0.6 + i * 0.075));
        });
      },
    },
    {
      id: 'light',
      format: 'luminance',
    },
  ],
  tools: [
    {
      name: 'RANDOM',
      action: () => {
        renderer.clear();
        Generator({
          types,
          cells,
          water,
          color,
          light,
          input,
          width,
          height,
          cellIndex,
        });
      },
    },
  ],
  types: [
    { id: types.clay, name: 'CLAY', color: { r: 0x33, g: 0x22, b: 0x11 } },
    { id: types.light, name: 'LIGHT', color: { r: 0x99, g: 0x99, b: 0x88 } },
    { id: types.sand, name: 'SAND', color: { r: 0x66, g: 0x66, b: 0x00 } },
    { id: types.water, name: 'WATER', color: { r: 0x44, g: 0x11, b: 0x66 } },
    { id: types.air, name: 'AIR', color: { r: 0x11, g: 0x22, b: 0x33 } },
  ],
});
const {
  debug,
  input,
  width,
  height,
} = renderer;

const color = renderer.textures.find(({ id }) => (id === 'color'));
const light = renderer.textures.find(({ id }) => (id === 'light'));
const cells = new Uint8ClampedArray(width * height);
for (let i = 0, l = color.buffer.length; i < l; i += 3) {
  if (color.buffer[i] || color.buffer[i + 1] || color.buffer[i + 2]) {
    cells[i / 3] = types.clay;
  }
}
const water = {
  state: new Float32Array(width * height),
  step: new Float32Array(width * height),
};
renderer.onClear = () => {
  cells.fill(0);
  water.state.fill(0);
  water.step.fill(0);
};

const actions = {
  // These map to mouse buttons
  erase: 0x02,
  paint: 0x00,
};
const neighbors = [
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];
const noise = new Uint8ClampedArray(width * height);
noise.forEach((v, i) => {
  noise[i] = Math.floor(0xFF * (0.8 + ((Math.random() - 0.5) * 0.02)));
});
const pixel = new Uint8ClampedArray(3);

const cellIndex = (x, y) => {
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

const floodLight = (queue) => {
  const next = [];
  queue.forEach(({ x, y }) => {
    const index = cellIndex(x, y);
    const level = light.buffer[index];
    neighbors.forEach((offset) => {
      const nx = x + offset.x;
      const ny = y + offset.y;
      const nl = Math.max(level - 2, 0);
      const neighbor = cellIndex(nx, ny);
      if (
        neighbor === -1
        || cells[neighbor] === types.clay
        || light.buffer[neighbor] >= nl
      ) {
        return;
      }
      light.buffer[neighbor] = nl;
      next.push({ x: nx, y: ny });
    });
  });
  queue.length = 0;
  if (next.length) {
    floodLight(next);
  }
};

const maxMass = 1.0; // The un-pressurized mass of a full water cell
const maxCompress = 0.02; // How much excess water a cell can store, compared to the cell above it
const minMass = 0.001;
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

const waterOutline = (x, y) => {
  const index = cellIndex(x, y);
  if (index === -1) return 0;
  if (cells[index] !== types.air) return 0.75; 
  if (water.state[index] < minMass) return 1.25; 
  return 0;
};

// Main loop
let lastFrameTime = performance.now();
let simulationStep = 0;
const animate = () => {
  requestAnimationFrame(animate);

  const frameTime = performance.now();
  const delta = Math.min((frameTime - lastFrameTime) / 1000, 1 / 30);
  lastFrameTime = frameTime;

  const steps = Math.floor(500 * delta);
  for (let s = 0; s < steps; s += 1, simulationStep += 1) {
    // Process Input
    if (input.action !== false) {
      input.brushOffsets.forEach((offset) => {
        if (Math.random() > 0.5) {
          return;
        }
        const index = cellIndex(input.x + offset.x, input.y + offset.y);
        if (index === -1) {
          return;
        }
        if (
          cells[index] === types.clay || cells[index] === types.light
          || input.type === types.clay || input.type === types.light
        ) {
          light.needsUpdate = true;
        }
        if (input.action === actions.erase || input.type === types.air) {
          cells[index] = types.air;
          water.state[index] = water.step[index] = 0;
          return;
        }
        switch (input.type) {
          case types.clay:
          case types.sand:
          case types.light: {
            cells[index] = input.type;
            water.state[index] = water.step[index] = 0;
            const { r, g, b, l } = input.colors[input.type];
            color.buffer.set([
              Math.floor(r + (Math.random() - 0.5) * input.noise * 2 * l),
              Math.floor(g + (Math.random() - 0.5) * input.noise * 2 * l),
              Math.floor(b + (Math.random() - 0.5) * input.noise * 2 * l),
            ], index * 3);
            break;
          }
          case types.water:
            cells[index] = types.air;
            water.state[index] = water.step[index] = 0.5;
            break;
        }
      });
    }

    // Simulate sand
    if (simulationStep % 2 === 0) {
      const s = simulationStep % 4 === 0;
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
            water.state[index] = water.step[index] = Math.min(water.state[target], maxMass);
            water.state[target] = water.step[target] = 0;
            color.buffer.copyWithin(target * 3, index * 3, (index * 3) + 3);
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

  let lightQueue;
  if (light.needsUpdate) {
    // Clear light texture
    light.buffer.fill(0);
    lightQueue = [];
  }

  const airColor = input.colors[types.air];
  const waterColor = input.colors[types.water];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = cellIndex(x, y);

      // Queue lights for propagation
      if (light.needsUpdate && cells[index] === types.light) {
        light.buffer[index] = 0xFF;
        lightQueue.push({ x, y });
      }
  
      // Update air/water pixels
      if (cells[index] === types.air) {
        // Incomplete: Move this to the GPU
        // This loop should just flag the water cells.
        // If the shader receives the cells as a texture and the water color as a uniform,
        // the rest of this logic could be in the fragment shader.
        const n = noise[index] / 0xFF;
        pixel[0] = Math.floor(airColor.r * n);
        pixel[1] = Math.floor(airColor.g * n);
        pixel[2] = Math.floor(airColor.b * n);
        const mass = water.state[index];
        if (mass >= minMass) {
          const light = (2 - Math.min(Math.max(mass, 1), 1.25)) * (
            Math.max(waterOutline(x - 1, y), waterOutline(x + 1, y))
            || waterOutline(x, y - 1)
            || waterOutline(x, y + 1)
            || 1
          );
          pixel[0] = Math.floor((pixel[0] + waterColor.r * light) / 2);
          pixel[1] = Math.floor((pixel[1] + waterColor.g * light) / 2);
          pixel[2] = Math.floor((pixel[2] + waterColor.b * light) / 2);
        }
        color.buffer.set(pixel, index * 3);
      }
    }
  }

  // Propagate light
  if (light.needsUpdate) {
    floodLight(lightQueue);
  }

  // Render
  color.needsUpdate = true;
  renderer.render();
  debug.innerText = `${Math.floor(performance.now() - frameTime)}ms`;
};
requestAnimationFrame(animate);
