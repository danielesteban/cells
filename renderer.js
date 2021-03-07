class Renderer {
  constructor({
    width,
    height,
    dom,
    onClear,
    pixels,
  }) {        
    // UI
    const ui = document.getElementById('ui');
    const updateUI = () => buttons.forEach((b, i) => {
      b.className = this.input.type === i + 1 ? 'active' : '';
    });
    const buttons = ['CLAY', 'SAND', 'WATER'].map((text, i) => {
      const button = document.createElement('button');
      button.innerText = `${i + 1}: ${text}`;
      button.addEventListener('click', () => {
        this.input.type = i + 1;
        updateUI();
      });
      ui.appendChild(button);
      return button;
    });
    this.debug = document.createElement('div');
    ui.appendChild(this.debug);
    const clear = document.createElement('button');
    clear.innerText = 'CLEAR';
    clear.addEventListener('click', () => {
      clearPixels();
    });
    ui.appendChild(clear);

    // Setup rasterizer & upscaler
    this.rasterizer = document.createElement('canvas');
    {
      const ctx = this.rasterizer.getContext('2d', { alpha: false });
      this.rasterizer.width = width;
      this.rasterizer.height = height;
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      pixels({ ctx, width, height });
      ctx.restore();
      this.pixels = ctx.getImageData(0, 0, width, height);
      this.rasterizerContext = ctx;
    }
    this.upscaler = document.createElement('canvas');
    this.upscalerContext = this.upscaler.getContext('2d', { alpha: false });
    this.aspect = width / height;
    this.width = width;
    this.height = height;

    dom.appendChild(this.upscaler);
    dom.appendChild(ui);
    this.resize();
    window.addEventListener('resize', this.resize.bind(this));

    const clearPixels = () => {
      for (let i = 0, l = this.pixels.data.length; i < l; i += 4) {
        this.pixels.data.set([0, 0, 0], i);
      }
      onClear();
    };

    // Input mapping
    this.input = { action: false, touch: false, type: 0x01, x: 0, y: 0 };
    updateUI();
    window.addEventListener('blur', () => {
      this.input.action = false;
      this.input.touch = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', ({ keyCode, repeat }) => {
      if (repeat) return;
      if (keyCode === 27) {
        clearPixels();
      } else if (keyCode >= 49 && keyCode <= 51) {
        this.input.type = keyCode - 48;
        updateUI();
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
    } = this;
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight - 30,
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
}

export default Renderer;
