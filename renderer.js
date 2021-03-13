// The purpose of this class is to abstract out all the boilerplate from the main file
// Setting up the UI and the rendering context and handling all the input
// Exporting just a simple api to render a bunch of pixels

class Renderer {
  constructor({
    shader,
    textures,
    tools,
    types,
  }) {
    const dom = document.getElementById('renderer');
    const isMobile = navigator.userAgent.includes('Mobile');
    const width = isMobile ? 160 : 320;
    const height = 240;
    this.aspect = width / height;
    this.width = width;
    this.height = height;
    this.input = {
      action: false,
      brush: 0.24,
      colors: [],
      noise: 0.5,
      touch: false,
      x: 0,
      y: 0,
    };

    // Setup rendering context
    this.canvas = document.createElement('canvas');
    {
      const hints = {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      };
      this.context = (
        this.canvas.getContext('webgl', hints)
        || this.canvas.getContext('experimental-webgl', hints)
      );
      const GL = this.context;

      const vertex = GL.createShader(GL.VERTEX_SHADER);
      GL.shaderSource(vertex, `
        precision mediump float;
        attribute vec2 position;
        varying vec2 uv;
        void main(void) {
          gl_Position = vec4(position, 0.0, 1.0);
          uv = (position * vec2(0.5, -0.5) + vec2(0.5));
        }
      `);
      GL.compileShader(vertex);
      const fragment = GL.createShader(GL.FRAGMENT_SHADER);
      GL.shaderSource(fragment, `
        precision mediump float;
        varying vec2 uv;
        uniform vec2 pixel;
        ${textures.map(({ id }) => (`uniform sampler2D ${id};`)).join('\n')}
        vec3 blendSoftLight(vec3 base, vec3 blend) {
          return mix(
            sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend), 
            2.0 * base * blend + base * base * (1.0 - 2.0 * blend), 
            step(base, vec3(0.5))
          );
        }
        void main(void) {
          ${shader}
        }
      `);
      GL.compileShader(fragment);
      const program = GL.createProgram();
      GL.attachShader(program, vertex);
      GL.attachShader(program, fragment);
      GL.linkProgram(program);
      GL.useProgram(program);
      GL.uniform2fv(GL.getUniformLocation(program, 'pixel'), new Float32Array([1 / width, 1 / height]));
      this.program = program;

      {
        const buffer = GL.createBuffer();
        GL.bindBuffer(GL.ARRAY_BUFFER, buffer);
        GL.bufferData(GL.ARRAY_BUFFER, new Float32Array([
          -1, -1,    1, -1,    1, 1, 
          1, 1,     -1, 1,    -1, -1, 
        ]), GL.STATIC_DRAW);
        const attribute = GL.getAttribLocation(program, 'position')
        GL.vertexAttribPointer(attribute, 2, GL.FLOAT, 0, 0, 0);
        GL.enableVertexAttribArray(attribute);
      }

      this.textures = textures.map(({ id, format, image }, unit) => {
        const texture = GL.createTexture();
        GL.bindTexture(GL.TEXTURE_2D, texture);
        let buffer;
        switch (format) {
          case 'rgb':
            format = GL.RGB;
            buffer = new Uint8ClampedArray(width * height * 3);
            if (image) {
              // Rasterize initial image
              const rasterizer = document.createElement('canvas');
              const ctx = rasterizer.getContext('2d');
              rasterizer.width = width;
              rasterizer.height = height;
              ctx.clearRect(0, 0, width, height);
              image({ ctx, width, height, isMobile });
              const { data } = ctx.getImageData(0, 0, width, height);
              for (let i = 0, c = 0, l = data.length; i < l; i += 4, c += 3) {
                const a = data[i + 3] / 0xFF;
                buffer.set([
                  Math.floor(data[i] * a),
                  Math.floor(data[i + 1] * a),
                  Math.floor(data[i + 2] * a),
                ], c);
              }
            }
            break;
          case 'luminance':
            format = GL.LUMINANCE;
            buffer = new Uint8ClampedArray(width * height);
            break;
        }
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.NEAREST);
        GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.NEAREST);
        GL.texImage2D(GL.TEXTURE_2D, 0, format, width, height, 0, format, GL.UNSIGNED_BYTE, buffer);
        GL.uniform1i(GL.getUniformLocation(program, id), unit);
        return {
          id,
          buffer,
          format,
          needsUpdate: true,
          texture,
          unit: GL[`TEXTURE${unit}`],
        }
      });
    }
    dom.appendChild(this.canvas);

    // UI
    const ui = document.createElement('div');
    ui.id = 'ui';
    if (isMobile) {
      ui.className = 'mobile';
    }
    const uiGroups = [...Array(3)].map(() => {
      const group = document.createElement('div');
      ui.appendChild(group);
      return group;
    });
    const buttons = types.map(({ id, name, color }) => {
      color.l = (color.r + color.g + color.b) / 3;
      this.input.colors[id] = color;

      const input = document.createElement('input');
      input.type = 'color';
      input.value = (
        `#${('000000' + (color.r << 16 ^ color.g << 8 ^ color.b << 0).toString(16)).slice(-6)}`
      );
      input.addEventListener('input', () => {
        color.r = parseInt(input.value.substr(1, 2), 16);
        color.g = parseInt(input.value.substr(3, 2), 16);
        color.b = parseInt(input.value.substr(5, 2), 16);
        color.l = (color.r + color.g + color.b) / 3;
      });

      const button = document.createElement('button');
      button.appendChild(input);
      button.appendChild(document.createTextNode(name));
      button.addEventListener('click', () => setType(id));
      uiGroups[0].appendChild(button);

      return button;
    });
    const setBrush = (brush) => {
      this.input.brush = brush;
      const scaled = 2 + Math.floor(8 * brush) * 2;
      const center = scaled * 0.5;
      const radius = scaled * 0.4;
      this.input.brushOffsets = [...Array(scaled ** 2)]
        .map((v, i) => ({ x: Math.floor(i % scaled), y: Math.floor(i / scaled) }))
        .reduce((offsets, { x, y }) => {
          x -= center;
          y -= center;
          if (Math.sqrt(((x + 0.5) ** 2) + ((y + 0.5) ** 2)) < radius) {
            offsets.push({ x, y });
          }
          return offsets;
        }, []);
    };
    setBrush(this.input.brush);
    const setType = (type) => {
      this.input.type = type;
      buttons.forEach((b, i) => {
        b.className = type === types[i].id ? 'active' : '';
      });
    };
    setType(types[0].id);
    [
      { id: 'brush', name: 'Brush' },
      { id: 'noise', name: 'Noise' },
    ].forEach(({ id, name }) => {
      const div = document.createElement('div');
      const label = document.createElement('label');
      label.innerText = name;
      div.appendChild(label);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = 0;
      input.max = 1;
      input.step = 0.01;
      input.value = this.input[id];
      input.addEventListener('input', () => {
        const value = parseFloat(input.value);
        if (id === 'brush') {
          setBrush(value);
        } else {
          this.input[id] = value;
        }
      });
      div.appendChild(input);
      uiGroups[1].appendChild(div);
    });
    this.debug = document.createElement('div');
    this.debug.id = 'debug';
    uiGroups[2].appendChild(this.debug);
    this.downloader = document.createElement('a');
    this.downloader.style.display = 'none';
    dom.appendChild(this.downloader);
    const snap = document.createElement('button');
    snap.innerText = 'SNAP';
    snap.addEventListener('click', this.snap.bind(this));
    uiGroups[2].appendChild(snap);
    (tools || []).forEach(({ name, action }) => {
      const tool = document.createElement('button');
      tool.innerText = name;
      tool.addEventListener('click', action);
      uiGroups[2].appendChild(tool);
    });
    const clear = document.createElement('button');
    clear.innerText = 'CLEAR';
    clear.addEventListener('click', this.clear.bind(this));
    uiGroups[2].appendChild(clear);
    dom.appendChild(ui);
    this.ui = ui;

    this.resize();
    window.addEventListener('resize', this.resize.bind(this));

    // Input mapping
    window.addEventListener('blur', () => {
      this.input.action = false;
      this.input.touch = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    const maxTypeKeyCode = 49 + types.length;
    document.addEventListener('keydown', ({ keyCode, repeat }) => {
      if (repeat) return;
      if (keyCode === 27) {
        this.clear();
      } else if (keyCode >= 49 && keyCode < maxTypeKeyCode) {
        setType(types[keyCode - 49].id);
      }
    });
    const updatePointer = (e) => {
      const { bounds } = this;
      this.input.x = Math.round((Math.min(Math.max(e.pageX - bounds.x, 0), bounds.width) / bounds.width) * (width - 1));
      this.input.y = Math.round((1 - (Math.min(Math.max(e.pageY - bounds.y, 0), bounds.height) / bounds.height)) * (height - 1));
    };
    this.canvas.addEventListener('mousedown', (e) => {
      this.input.action = e.button;
      updatePointer(e);
    });
    document.addEventListener('mousemove', updatePointer);
    document.addEventListener('mouseup', () => {
      this.input.action = false;
    });

    // Emulate mouse on mobile
    this.canvas.addEventListener('touchstart', (e) => {
      if (this.input.touch !== false) {
        return;
      }
      e.preventDefault();
      const [touch] = e.touches;
      this.input.action = 0;
      this.input.touch = touch.indentifier;
      updatePointer(touch);
    });
    document.addEventListener('touchmove', (e) => {
      if (this.input.touch === false) {
        return;
      }
      let touch;
      for (let i = 0, l = e.touches.length; i < l; i += 1) {
        if (e.touches[i].indentifier === this.input.touch) {
          touch = e.touches[i];
          break;
        }
      }
      if (touch) {
        updatePointer(touch);
      }
    });
    document.addEventListener('touchend', (e) => {
      if (this.input.touch === false) {
        return;
      }
      for (let i = 0, l = e.touches.length; i < l; i += 1) {
        if (e.touches[i].indentifier === this.input.touch) {
          return;
        }
      }
      this.input.action = false;
      this.input.touch = false;
    });
  }

  clear() {
    const { onClear, textures } = this;
    textures.forEach((texture) => {
      texture.buffer.fill(0);
      texture.needsUpdate = true;
    });
    if (onClear) {
      onClear();
    }
  }

  render() {
    const {
      canvas,
      context: GL,
      textures,
      width,
      height,
    } = this;
    textures.forEach((data) => {
      if (data.needsUpdate) {
        data.needsUpdate = false;
        const { buffer, format, texture, unit } = data;
        GL.activeTexture(unit);
        GL.bindTexture(GL.TEXTURE_2D, texture);
        GL.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, width, height, format, GL.UNSIGNED_BYTE, buffer);
      }
    });
    GL.drawArrays(GL.TRIANGLES, 0, 6);
  }

  resize() {
    const {
      canvas,
      context: GL,
      ui,
      aspect,
      width,
      height,
    } = this;
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight - ui.getBoundingClientRect().height,
    };
    let scale;
    if ((viewport.width / viewport.height) > aspect) {
      scale = viewport.height / height;
    } else {
      scale = viewport.width / width;
    }
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
    GL.viewport(0, 0, GL.drawingBufferWidth, GL.drawingBufferHeight);
    this.bounds = canvas.getBoundingClientRect();
  }

  snap() {
    const {
      canvas,
      context: GL,
      downloader,
      width,
      height,
    } = this;
    const scale = 8;
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
    GL.viewport(0, 0, GL.drawingBufferWidth, GL.drawingBufferHeight);
    this.render();
    canvas.toBlob((blob) => {
      downloader.download = `Cells-${Date.now()}.png`;
      downloader.href = URL.createObjectURL(blob);
      downloader.click();
    });
    this.resize();
  }
}

export default Renderer;
