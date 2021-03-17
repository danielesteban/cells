import Generator from './core/generator.js';
import Renderer from './core/renderer.js';
import SimulationJS from './simulation/simulationJS.js';
import SimulationWASM from './simulation/simulationWASM.js';

// Setup
const Simulation = window.WebAssembly && location.hash.substr(1) !== 'disablewasm' ? (
  SimulationWASM
) : (
  SimulationJS
);
const { types } = Simulation;
const renderer = new Renderer({
  shader: `
    uniform sampler2D color;
    uniform sampler2D light;
    void main(void) {
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
    }
  `,
  tools: [
    {
      name: 'RANDOM',
      action: () => {
        if (!simulation.hasLoaded) {
          return;
        }
        renderer.clear();
        Generator({
          types,
          cells: simulation.cells.buffer,
          water: {
            state: simulation.water.state.buffer,
            step: simulation.water.step.buffer,
          },
          color: simulation.color.buffer,
          cellIndex: simulation.cellIndex.bind(simulation),
          input,
          width: renderer.width,
          height: renderer.height,
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

const { debug, input } = renderer;
const actions = {
  // These map to mouse buttons
  erase: 0x02,
  paint: 0x00,
};
let color;
let light;

const simulation = new Simulation({
  wasm: '/simulation/simulation.wasm',
  width: renderer.width,
  height: renderer.height,
  onLoad: ({
    cells: { buffer: cells },
    color: { buffer: colorBuffer },
    light: { buffer: lightBuffer },
  }) => {
    color = renderer.addTexture({
      id: 'color',
      buffer: colorBuffer,
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
    });
    for (let i = 0, l = color.buffer.length; i < l; i += 3) {
      if (color.buffer[i] || color.buffer[i + 1] || color.buffer[i + 2]) {
        cells[i / 3] = types.clay;
      }
    }
    light = renderer.addTexture({
      id: 'light',
      buffer: lightBuffer,
      format: 'luminance',
    });
  },
});

renderer.onClear = () => {
  if (!simulation.hasLoaded) {
    return;
  }
  simulation.cells.buffer.fill(0);
  simulation.water.state.buffer.fill(0);
  simulation.water.step.buffer.fill(0);
};

// Main loop
let lastFrameTime = performance.now();
const animate = () => {
  requestAnimationFrame(animate);

  const frameTime = performance.now();
  const delta = Math.min((frameTime - lastFrameTime) / 1000, 1 / 30);
  lastFrameTime = frameTime;

  if (!simulation.hasLoaded) {
    return;
  }

  const steps = Math.floor(500 * delta);
  for (let step = 0; step < steps; step += 1) {
    // Process Input
    if (input.action === actions.erase || input.action === actions.paint) {
      input.brushOffsets.forEach((offset) => {
        if (Math.random() > 0.5) {
          return;
        }
        const index = simulation.cellIndex(input.x + offset.x, input.y + offset.y);
        if (index === -1) {
          return;
        }
        if (
          simulation.cells.buffer[index] === types.clay
          || simulation.cells.buffer[index] === types.light
          || input.type === types.clay
          || input.type === types.light
        ) {
          light.needsUpdate = true;
        }
        if (input.action === actions.erase || input.type === types.air) {
          simulation.cells.buffer[index] = types.air;
          simulation.water.state.buffer[index] = simulation.water.step.buffer[index] = 0;
          return;
        }
        switch (input.type) {
          case types.clay:
          case types.sand:
          case types.light: {
            simulation.cells.buffer[index] = input.type;
            simulation.water.state.buffer[index] = simulation.water.step.buffer[index] = 0;
            const { r, g, b, l } = input.colors[input.type];
            color.buffer.set([
              Math.floor(r + (Math.random() - 0.5) * input.noise * 2 * l),
              Math.floor(g + (Math.random() - 0.5) * input.noise * 2 * l),
              Math.floor(b + (Math.random() - 0.5) * input.noise * 2 * l),
            ], index * 3);
            break;
          }
          case types.water:
            simulation.cells.buffer[index] = types.air;
            simulation.water.state.buffer[index] = simulation.water.step.buffer[index] = 0.5;
            break;
        }
      });
    }

    // Step simulation
    simulation.step();
  }

  // Update textures
  color.needsUpdate = true;
  simulation.updateColor(input.colors[types.air], input.colors[types.water]);
  if (light.needsUpdate) {
    simulation.updateLight();
  }

  // Render
  renderer.render();
  debug.innerText = `${Math.floor(performance.now() - frameTime)}ms`;
};
requestAnimationFrame(animate);
