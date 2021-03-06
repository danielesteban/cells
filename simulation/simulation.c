static const float maxMass = 1.0f; // The un-pressurized mass of a full water cell
static const float maxCompress = 0.02f; // How much excess water a cell can store, compared to the cell above it
static const float minMass = 0.001f; // Ignore cells that are almost dry
static const float getStableState(const float totalMass) {
  // This function is used to compute how water should be split among two vertically adjacent cells.
  // It returns the amount of water that should be in the bottom cell.
  if (totalMass <= 1) {
    return 1;
  }
  if (totalMass < maxMass * 2.0f + maxCompress) {
    return (maxMass * maxMass + totalMass * maxCompress) / (maxMass + maxCompress);
  }
  return (totalMass + maxCompress) / 2.0f;
}

const int cellIndex(const unsigned int width, const unsigned int height, const int x, const int y) {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    // Out of bounds
    return -1;
  }
  return (height - 1 - y) * width + x;
}

void simulateSand(
  const unsigned int width,
  const unsigned int height,
  const unsigned int step,
  const unsigned char type,
  unsigned char *cells,
  unsigned char *color,
  float *waterState,
  float *waterStep
) {
  if (step % 2 != 0) {
    return;
  }
  int target;
  const int nx = step % 4 == 0 ? 1 : -1;
  for (unsigned int y = 0; y < height; y += 1) {
    for (unsigned int sx = 0; sx < width; sx += 1) {
      const unsigned int x = nx == 1 ? sx : (width - 1 - sx);
      const int index = cellIndex(width, height, x, y);
      if (cells[index] != type) {
        continue;
      }
      target = cellIndex(width, height, x, y - 1);
      if (target != -1 && cells[target] != 0) {
        target = cellIndex(width, height, x - nx, y - 1);
        if (target != -1 && cells[target] != 0) {
          target = cellIndex(width, height, x + nx, y - 1);
          if (target != -1 && cells[target] != 0) {
            continue;
          }
        }
      }
      if (target == -1) {
        // Destroy cell
        cells[index] = 0;
      } else {
        // Swap cell with target position
        cells[index] = cells[target];
        cells[target] = 3;
        waterState[index] = waterStep[index] = waterState[target] < 1.0f ? waterState[target] : 1.0f;
        waterState[target] = waterStep[target] = 0;
        color[target * 3] = color[index * 3];
        color[target * 3 + 1] = color[index * 3 + 1];
        color[target * 3 + 2] = color[index * 3 + 2];
      }
    }
  }
}

void simulateWater(
  const unsigned int size,
  const unsigned char *cells,
  const int *neighbors,
  const float *state,
  float *step
) {
  float flow, remainingMass;
  for (unsigned int index = 0, nIndex = 0; index < size; index++, nIndex += 4) {
    if (cells[index] != 0) {
      continue;
    }
    const float mass = state[index];
    remainingMass = mass;
    for (unsigned int n = 0; remainingMass > 0 && n < 4; n += 1) {
      const int neighbor = neighbors[nIndex + n];
      if (neighbor != -1 && cells[neighbor] != 0) {
        continue;
      }
      const float neighborMass = neighbor != -1 ? state[neighbor] : 0;
      switch (n) {
        case 0: // Down
          flow = getStableState(remainingMass + neighborMass) - neighborMass;
          break;
        case 1: // Left
        case 2: // Right
          // Equalize the amount of water between neighbors
          flow = (mass - neighborMass) / 4.0f;
          break;
        case 3: // Up
          // Only compressed water flows upwards
          flow = remainingMass - getStableState(remainingMass + neighborMass);
          break;
      }
      if (flow < 0.0f) flow = 0.0f;
      if (flow > 0.1f) flow *= 0.5f;
      if (flow > remainingMass) flow = remainingMass;
      if (flow > 1.0f) flow = 1.0f;
      step[index] -= flow;
      if (neighbor != -1) {
        step[neighbor] += flow;
      }
      remainingMass -= flow;
    }
  }
}

static const float waterOutline(
  const unsigned char *cells,
  const float *state,
  const int index
) {
  if (index == -1) return 0.0f;
  if (cells[index] != 0) return 0.75f; 
  if (state[index] < minMass) return 1.25f; 
  return 0.0f;
}

void updateColor(
  const unsigned int airColor,
  const unsigned int waterColor,
  const unsigned int size,
  const unsigned char *cells,
  unsigned char *color,
  const int *neighbors,
  const unsigned char *noise,
  const float *state
) {
  unsigned char r, g, b;
  float mass, light;
  for (unsigned int index = 0, nIndex = 0; index < size; index++, nIndex += 4) {
    if (cells[index] == 0) {
      const float n = noise[index] / 255.0f;
      r = ((airColor >> 16) & 0xFF) * n;
      g = ((airColor >> 8) & 0xFF) * n;
      b = (airColor & 0xFF) * n;
      mass = state[index];
      if (mass >= minMass) {
        const float outlineL = waterOutline(cells, state, neighbors[nIndex + 1]);
        const float outlineR = waterOutline(cells, state, neighbors[nIndex + 2]);
        light = outlineL > outlineR ? outlineL : outlineR;
        if (light == 0.0f) {
          light = waterOutline(cells, state, neighbors[nIndex]);
          if (light == 0.0f) {
            light = waterOutline(cells, state, neighbors[nIndex + 3]);
            if (light == 0.0f) {
              light = 1;
            }
          }
        }
        if (mass < 1.0f) mass = 1.0f;
        if (mass > 1.25f) mass = 1.25f;
        mass = (2.0f - mass) * light;
        r = (r + ((waterColor >> 16) & 0xFF) * mass) / 2.0f;
        g = (g + ((waterColor >> 8) & 0xFF) * mass) / 2.0f;
        b = (b + (waterColor & 0xFF) * mass) / 2.0f;
      }
      color[index * 3] = r;
      color[index * 3 + 1] = g;
      color[index * 3 + 2] = b;
    }
  }
}

static void floodLight(
  const unsigned char *cells,
  unsigned char *light,
  const int *neighbors,
  unsigned int *queue,
  const unsigned int size,
  unsigned int *next
) {
  unsigned int nextLength = 0;
  for (unsigned int i = 0; i < size; i++) {
    const unsigned int index = queue[i];
    const unsigned char level = light[index];
    const unsigned char nl = level <= 2 ? 0 : level - 2;
    for (unsigned int n = 0; n < 4; n += 1) {
      const int neighbor = neighbors[index * 4 + n];
      if (
        neighbor == -1
        || cells[neighbor] == 1
        || light[neighbor] >= nl
      ) {
        continue;
      }
      light[neighbor] = nl;
      next[nextLength++] = neighbor;
    }
  }
  if (nextLength > 0) {
    floodLight(cells, light, neighbors, next, nextLength, queue);
  }
}

void updateLight(
  const unsigned int size,
  const unsigned char type,
  const unsigned char *cells,
  unsigned char *light,
  const int *neighbors,
  unsigned int *queueA,
  unsigned int *queueB
) {
  unsigned int queueLength = 0;
  for (unsigned int index = 0; index < size; index++) {
    if (cells[index] != type) {
      continue;
    }
    light[index] = 0xFF;
    queueA[queueLength++] = index;
  }
  floodLight(cells, light, neighbors, queueA, queueLength, queueB);
}
