class SimulationWASM {
  constructor({
    width,
    height,
    url,
    onLoad,
  }) {
    this.width = width;
    this.height = height;
    this.simulationStep = 0;
    const pages = Math.ceil(
      (width * height * (
        1                                       // cell type
        + 3                                     // RGB color
        + 1                                     // light level
        + 4 * Int32Array.BYTES_PER_ELEMENT      // neighbors LUT
        + 1                                     // background noise
        + 2 * Int32Array.BYTES_PER_ELEMENT      // propagation queues
        + 2 * Float32Array.BYTES_PER_ELEMENT    // water state + step
      )) / 65536
    ) + 1;
    const memory = new WebAssembly.Memory({ initial: pages, maximum: pages });    
    fetch(url)
      .then((res) => res.arrayBuffer())
      .then((buffer) => (
        WebAssembly.instantiate(buffer, { env: { memory } })
      ))
      .then(({ instance }) => {
        this.cellIndex = (x, y) => instance.exports.cellIndex(this.width, this.height, x, y);
        this.allocate({ instance, memory });
        this._simulateSand = instance.exports.simulateSand;
        this._simulateWater = instance.exports.simulateWater;
        this._updateColor = instance.exports.updateColor;
        this._updateLight = instance.exports.updateLight;
        if (onLoad) {
          onLoad(this);
        }
        this.hasLoaded = true;
      })
      .catch((e) => console.error(e));
  }

  allocate({
    instance,
    memory,
  }) {
    const { width, height } = this;
    const size = width * height;
    let base = instance.exports.__heap_base;

    this.cells = {
      base,
      buffer: new Uint8ClampedArray(memory.buffer, base, size),
    };
    base += size;

    this.color = {
      base,
      buffer: new Uint8ClampedArray(memory.buffer, base, size * 3),
    };
    base += size * 3;

    this.light = {
      base,
      buffer: new Uint8ClampedArray(memory.buffer, base, size),
    };
    base += size;

    this.neighbors = {
      base,
      buffer: new Int32Array(memory.buffer, base, size * 4),
    };
    base += size * 4 * Int32Array.BYTES_PER_ELEMENT;
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

    this.noise = {
      base,
      buffer: new Uint8ClampedArray(memory.buffer, base, size),
    };
    base += size;
    {
      for (let i = 0; i < size; i += 1) {
        this.noise.buffer[i] = Math.floor(0xFF * (0.8 + ((Math.random() - 0.5) * 0.02)));
      }
    }

    this.queues = {
      a: {
        base,
        buffer: new Int32Array(memory.buffer, base, size),
      },
      b: {
        base: base + size * Int32Array.BYTES_PER_ELEMENT,
        buffer: new Int32Array(memory.buffer, base + size * Int32Array.BYTES_PER_ELEMENT, size),
      }
    };
    base += size * 2 * Int32Array.BYTES_PER_ELEMENT;

    this.water = {
      state: {
        base,
        buffer: new Float32Array(memory.buffer, base, size),
      },
      step: {
        base: base + size * Float32Array.BYTES_PER_ELEMENT,
        buffer: new Float32Array(memory.buffer, base + size * Float32Array.BYTES_PER_ELEMENT, size),
      },
    };
    base += size * 2 * Float32Array.BYTES_PER_ELEMENT;
  }

  step() {
    const { types } = SimulationWASM;
    const {
      simulationStep: step,
      cells,
      color,
      neighbors,
      water,
      width,
      height,
    } = this;
    this._simulateSand(
      width,
      height,
      step,
      types.sand,
      cells.base,
      color.base,
      water.state.base,
      water.step.base
    );
    this._simulateWater(
      width * height,
      cells.base,
      neighbors.base,
      water.state.base,
      water.step.base
    );
    water.state.buffer.set(water.step.buffer);
    this.simulationStep += 1;
  }

  updateColor(airColor, waterColor) {
    const {
      cells,
      color,
      neighbors,
      noise,
      water,
      width,
      height,
    } = this;
    this._updateColor(
      airColor.r << 16 ^ airColor.g << 8 ^ airColor.b,
      waterColor.r << 16 ^ waterColor.g << 8 ^ waterColor.b,
      width * height,
      cells.base,
      color.base,
      neighbors.base,
      noise.base,
      water.state.base
    );
  }

  updateLight() {
    const { types } = SimulationWASM;
    const {
      cells,
      light,
      neighbors,
      queues,
      width,
      height,
    } = this;
    light.buffer.fill(0);
    this._updateLight(
      width * height,
      types.light,
      cells.base,
      light.base,
      neighbors.base,
      queues.a.base,
      queues.b.base,
    );
  }
}

SimulationWASM.types = {
  air: 0x00,
  clay: 0x01,
  light: 0x02,
  sand: 0x03,
  water: 0x04,
};

export default SimulationWASM;
