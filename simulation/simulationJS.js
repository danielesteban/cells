class SimulationJS {
  constructor({
    width,
    height,
    onLoad,
  }) {
    this.width = width;
    this.height = height;
    this.simulationStep = 0;
    this.allocate();
    if (onLoad) {
      onLoad(this);
    }
    this.hasLoaded = true;
  }
  
  allocate() {
    const { width, height } = this;
    const size = width * height;
    this.cells = { buffer: new Uint8ClampedArray(size) };
    this.color = { buffer: new Uint8ClampedArray(size * 3) };
    this.light = { buffer: new Uint8ClampedArray(size) };
    this.neighbors = { buffer: new Int32Array(size * 4) };
    {
      const neighbors = [
        { x: 0, y: -1 },
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = this.cellIndex(x, y) * 4;
          neighbors.forEach((n, i) => {
            this.neighbors.buffer[index + i] = this.cellIndex(x + n.x, y + n.y);
          });
        }
      }
    }
    this.noise = { buffer: new Uint8ClampedArray(size) };
    {
      for (let i = 0; i < size; i += 1) {
        this.noise.buffer[i] = Math.floor(0xFF * (0.8 + ((Math.random() - 0.5) * 0.02)));
      }
    }
    this.water = {
      state: { buffer: new Float32Array(size) },
      step: { buffer: new Float32Array(size) },
    };
  }

  cellIndex(x, y) {
    const { width, height } = this;
    if (x < 0 || x >= width || y < 0 || y >= height) {
      // Out of bounds
      return -1;
    }
    return (height - 1 - y) * width + x;
  }

  static getStableState(totalMass) {
    // This function is used to compute how water should be split among two vertically adjacent cells.
    // It returns the amount of water that should be in the bottom cell.
    const { maxCompress, maxMass } = SimulationJS;
    if (totalMass <= 1) {
      return 1;
    }
    if (totalMass < maxMass * 2 + maxCompress) {
      return (maxMass ** 2 + totalMass * maxCompress) / (maxMass + maxCompress);
    }
    return (totalMass + maxCompress) / 2;
  }  

  step() {
    this.simulateSand();
    this.simulateWater();
    this.simulationStep += 1;
  }

  simulateSand() {
    const { types } = SimulationJS;
    const {
      simulationStep: step,
      cells: { buffer: cells },
      color: { buffer: color },
      water: {
        state: { buffer: waterState },
        step: { buffer: waterStep },
      },
      width,
      height,
    } = this;
    if (step % 2 !== 0) {
      return;
    }
    const s = step % 4 === 0;
    const nx = s ? 1 : -1;
    for (let y = 0; y < height; y += 1) {
      for (let sx = 0; sx < width; sx += 1) {
        const x = s ? sx : (width - 1 - sx);
        const index = this.cellIndex(x, y);
        if (cells[index] !== types.sand) {
          continue;
        }
        let target = this.cellIndex(x, y - 1);
        if (target !== -1 && cells[target] !== 0) {
          target = this.cellIndex(x - nx, y - 1);
          if (target !== -1 && cells[target] !== 0) {
            target = this.cellIndex(x + nx, y - 1);
            if (target !== -1 && cells[target] !== 0) {
              continue;
            }
          }
        }
        if (target === -1) {
          // Destroy cell
          cells[index] = types.air;
        } else {
          // Swap cell with target position
          cells[index] = cells[target];
          cells[target] = types.sand;
          waterState[index] = waterStep[index] = Math.min(waterState[target], 1);
          waterState[target] = waterStep[target] = 0;
          color.copyWithin(target * 3, index * 3, (index * 3) + 3);
        }
      }
    }
  }

  simulateWater() {
    const { getStableState, types } = SimulationJS;
    const {
      cells: { buffer: cells },
      neighbors: { buffer: neighbors },
      water: {
        state: { buffer: state },
        step: { buffer: step },
      },
      width,
      height,
    } = this;
    for (let index = 0, nIndex = 0; index < (width * height); index += 1, nIndex += 4) {
      if (cells[index] !== types.air) {
        continue;
      }
      const mass = state[index];
      for (let remainingMass = mass, n = 0; remainingMass > 0 && n < 4; n += 1) {
        const neighbor = neighbors[nIndex + n];
        if (neighbor !== -1 && cells[neighbor] !== types.air) {
          continue;
        }
        const neighborMass = neighbor !== -1 ? state[neighbor] : 0;
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
        step[index] -= flow;
        if (neighbor !== -1) {
          step[neighbor] += flow;
        }
        remainingMass -= flow;
      }
    }
    state.set(step);
  }

  waterOutline(index) {
    const { minMass, types } = SimulationJS;
    const {
      cells: { buffer: cells },
      water: { state: { buffer: state } },
    } = this;
    if (index === -1) return 0;
    if (cells[index] !== types.air) return 0.75; 
    if (state[index] < minMass) return 1.25; 
    return 0;
  }

  updateColor(airColor, waterColor) {
    const { minMass, types } = SimulationJS;
    const {
      cells: { buffer: cells },
      color: { buffer: color },
      neighbors: { buffer: neighbors },
      noise: { buffer: noise },
      water: {
        state: { buffer: state },
        step: { buffer: step },
      },
      width,
      height,
    } = this;
    const pixel = new Uint8ClampedArray(3);
    for (let index = 0, nIndex = 0; index < (width * height); index += 1, nIndex += 4) {
      if (cells[index] === types.air) {
        const n = noise[index] / 0xFF;
        pixel[0] = Math.floor(airColor.r * n);
        pixel[1] = Math.floor(airColor.g * n);
        pixel[2] = Math.floor(airColor.b * n);
        const mass = state[index];
        if (mass >= minMass) {
          const light = (2 - Math.min(Math.max(mass, 1), 1.25)) * (
            Math.max(this.waterOutline(neighbors[nIndex + 1]), this.waterOutline(neighbors[nIndex + 2]))
            || this.waterOutline(neighbors[nIndex])
            || this.waterOutline(neighbors[nIndex + 3])
            || 1
          );
          pixel[0] = Math.floor((pixel[0] + waterColor.r * light) / 2);
          pixel[1] = Math.floor((pixel[1] + waterColor.g * light) / 2);
          pixel[2] = Math.floor((pixel[2] + waterColor.b * light) / 2);
        }
        color.set(pixel, index * 3);
      }
    }
  }

  floodLight(queue) {
    const { types } = SimulationJS;
    const {
      cells: { buffer: cells },
      light: { buffer: light },
      neighbors: { buffer: neighbors },
    } = this;
    const next = [];
    queue.forEach((index) => {
      const level = light[index];
      const nl = Math.max(level - 2, 0);
      for (let n = 0; n < 4; n += 1) {
        const neighbor = neighbors[index * 4 + n];
        if (
          neighbor === -1
          || cells[neighbor] === types.clay
          || light[neighbor] >= nl
        ) {
          continue;
        }
        light[neighbor] = nl;
        next.push(neighbor);
      }
    });
    queue.length = 0;
    if (next.length) {
      this.floodLight(next);
    }
  }

  updateLight() {
    const { types } = SimulationJS;
    const {
      cells: { buffer: cells },
      light: { buffer: light },
      width,
      height,
    } = this;
    light.fill(0);
    let queue = [];
    for (let index = 0; index < (width * height); index += 1) {
      if (cells[index] === types.light) {
        light[index] = 0xFF;
        queue.push(index);
      }
    }
    this.floodLight(queue);
  }
}

SimulationJS.maxMass = 1.0; // The un-pressurized mass of a full water cell
SimulationJS.maxCompress = 0.02; // How much excess water a cell can store, compared to the cell above it
SimulationJS.minMass = 0.001; // Ignore cells that are almost dry

SimulationJS.types = {
  air: 0x00,
  clay: 0x01,
  light: 0x02,
  sand: 0x03,
  water: 0x04,
};

export default SimulationJS;
