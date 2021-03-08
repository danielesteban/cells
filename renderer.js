// The purpose of this class is to abstract out all the boilerplate from the main file
// Setting up the UI and the rendering context and handling all the input
// Exporting just a simple api to render an ImageData instance with a bunch of pixels

class Renderer {
  constructor({ dom, pixels, types }) {
    const isMobile = navigator.userAgent.includes('Mobile');
    const width = isMobile ? 160 : 320;
    const height = 240;
    this.aspect = width / height;
    this.width = width;
    this.height = height;
    this.input = {
      action: false,
      brush: 0.5,
      colors: [],
      noise: 0.5,
      touch: false,
      x: 0,
      y: 0,
    };

    // Setup rasterizer & upscaler
    this.rasterizer = document.createElement('canvas');
    {
      const ctx = this.rasterizer.getContext('2d', { alpha: false });
      this.rasterizer.width = width;
      this.rasterizer.height = height;
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      pixels({ ctx, width, height });
      ctx.restore();
      this.pixels = ctx.getImageData(0, 0, width, height);
      this.rasterizerContext = ctx;
    }
    this.upscaler = document.createElement('canvas');
    this.upscalerContext = this.upscaler.getContext('2d', { alpha: false });
    dom.appendChild(this.upscaler);

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
    const buttons = types.map(({ id, name, color }, i) => {
      const button = document.createElement('button');
      button.innerText = name;
      button.addEventListener('click', () => setType(id));
      uiGroups[0].appendChild(button);

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
      button.insertBefore(input, button.firstChild);
      color.l = (color.r + color.g + color.b) / 3;
      this.input.colors[id] = color;
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
      const { upscalerBounds: bounds } = this;
      this.input.x = Math.round((Math.min(Math.max(e.pageX - bounds.x, 0), bounds.width) / bounds.width) * (width - 1));
      this.input.y = Math.round((1 - (Math.min(Math.max(e.pageY - bounds.y, 0), bounds.height) / bounds.height)) * (height - 1));
    };
    this.upscaler.addEventListener('mousedown', (e) => {
      this.input.action = e.button;
      updatePointer(e);
    });
    document.addEventListener('mousemove', updatePointer);
    document.addEventListener('mouseup', () => {
      this.input.action = false;
    });

    // Emulate mouse on mobile
    this.upscaler.addEventListener('touchstart', (e) => {
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
    const { onClear, pixels } = this;
    for (let i = 0, l = pixels.data.length; i < l; i += 4) {
      pixels.data.set([0, 0, 0], i);
    }
    if (onClear) {
      onClear();
    }
  }

  render() {
    const {
      pixels,
      rasterizer,
      rasterizerContext,
      upscaler,
      upscalerContext,
      width,
      height,
    } = this;
    rasterizerContext.putImageData(pixels, 0, 0);
    upscalerContext.drawImage(rasterizer, 0, 0, width, height, 0, 0, upscaler.width, upscaler.height);
  }

  resize() {
    const {
      aspect,
      upscaler: canvas,
      upscalerContext: ctx,
      width,
      height,
      ui,
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
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'copy';
    this.upscalerBounds = canvas.getBoundingClientRect();
  }

  snap() {
    const {
      downloader,
      rasterizer,
      upscaler: canvas,
      upscalerContext: ctx,
      width,
      height,
    } = this;
    const scale = 8;
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(rasterizer, 0, 0, width, height, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      downloader.download = `Cells-${Date.now()}.png`;
      downloader.href = URL.createObjectURL(blob);
      downloader.click();
    });
    this.resize();
  }
}

export default Renderer;
