/**
 * Locating a QR code in a photo — without decoding it.
 *
 * Decoding is the wrong job here. The payload of a WeChat contact QR is an
 * opaque URL only WeChat can resolve, so the app never reads it: all that is
 * wanted is the pixels, cropped out and handed back to the person to scan.
 * And decoding is much the harder task — a decoder has to resolve every
 * module, so a card held at an angle (jsQR gives up around a 15° tilt, which
 * is an ordinary way to hold a card in front of a phone) fails outright, even
 * though WeChat itself reads that same code off the screen without complaint.
 *
 * Finding is far more forgiving. A QR carries three finder patterns — the big
 * square eyes at three of its corners — and each one is, along any line
 * through its middle, a run of dark:light:dark:light:dark in a 1:1:3:1:1
 * ratio. That ratio is what a perspective view leaves intact: it survives
 * tilt, rotation, blur and uneven lighting long past the point where the
 * modules themselves stop resolving. Three eyes are enough to bound the code,
 * which is all a crop needs.
 *
 * This is the classic scan used by every QR reader (ZXing's finder), reduced
 * to the locating half.
 */

export type FinderPattern = {
  /** Centre of the finder pattern, in pixels of the buffer it was found in. */
  x: number;
  y: number;
  /** Width of one QR module there, in the same pixels. */
  moduleSize: number;
  /** How many scan lines agreed on this centre; more is stronger evidence. */
  hits: number;
};

export type QrBounds = { x: number; y: number; width: number; height: number };

/** Side of the local window used to threshold, in pixels. */
const BLOCK = 24;
/** Below this spread a block is flat — all paper or all ink — and takes the
 *  neighbourhood's level instead, so paper grain is not read as modules. */
const MIN_CONTRAST = 24;

/**
 * Greyscale to black/white using a local threshold.
 *
 * A single global cutoff loses the code under the uneven light of a market
 * stall — a glare across one half of the card is enough. Comparing each pixel
 * against the average of its own neighbourhood keeps both halves readable.
 *
 * Returns one byte per pixel: 1 for dark (ink), 0 for light (paper).
 */
export function binarize(gray: Uint8Array, width: number, height: number): Uint8Array {
  const cols = Math.max(1, Math.ceil(width / BLOCK));
  const rows = Math.max(1, Math.ceil(height / BLOCK));
  const means = new Float32Array(cols * rows);
  const mins = new Float32Array(cols * rows);
  const maxs = new Float32Array(cols * rows);

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let sum = 0;
      let count = 0;
      let min = 255;
      let max = 0;
      const yEnd = Math.min(height, (by + 1) * BLOCK);
      const xEnd = Math.min(width, (bx + 1) * BLOCK);
      for (let y = by * BLOCK; y < yEnd; y++) {
        for (let x = bx * BLOCK; x < xEnd; x++) {
          const v = gray[y * width + x];
          sum += v;
          count++;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      const i = by * cols + bx;
      means[i] = count ? sum / count : 128;
      mins[i] = min;
      maxs[i] = max;
    }
  }

  // Smooth each block's cutoff over its neighbours, so a block that happens to
  // sit entirely inside one dark module does not threshold against itself.
  const cutoffs = new Float32Array(cols * rows);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const i = by * cols + bx;
      if (maxs[i] - mins[i] >= MIN_CONTRAST) {
        cutoffs[i] = (mins[i] + maxs[i]) / 2;
        continue;
      }
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx;
          const ny = by + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          sum += means[ny * cols + nx];
          count++;
        }
      }
      cutoffs[i] = count ? sum / count : means[i];
    }
  }

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const by = Math.min(rows - 1, (y / BLOCK) | 0);
    for (let x = 0; x < width; x++) {
      const bx = Math.min(cols - 1, (x / BLOCK) | 0);
      out[y * width + x] = gray[y * width + x] < cutoffs[by * cols + bx] ? 1 : 0;
    }
  }
  return out;
}

/**
 * Do five consecutive runs read as a finder pattern's 1:1:3:1:1?
 *
 * Exported because it is the whole idea in one function, and the tolerances
 * are the difference between finding a tilted code and inventing one that
 * isn't there.
 */
export function isFinderRatio(counts: ArrayLike<number>): boolean {
  let total = 0;
  for (let i = 0; i < 5; i++) {
    if (counts[i] === 0) return false;
    total += counts[i];
  }
  if (total < 7) return false;
  const moduleSize = total / 7;
  // Half a module of slack per run. Perspective stretches the runs unevenly,
  // and this is what lets a tilted eye still register.
  const slack = moduleSize / 2;
  return (
    Math.abs(moduleSize - counts[0]) < slack &&
    Math.abs(moduleSize - counts[1]) < slack &&
    Math.abs(3 * moduleSize - counts[2]) < 3 * slack &&
    Math.abs(moduleSize - counts[3]) < slack &&
    Math.abs(moduleSize - counts[4]) < slack
  );
}

/** Centre of the middle (3-module) run, counting back from the run's end. */
function crossCentre(counts: ArrayLike<number>, end: number): number {
  return end - counts[4] - counts[3] - counts[2] / 2;
}

/**
 * Walks one line of the bitmap and reports the centre of every 1:1:3:1:1 it
 * crosses. `at` reads a pixel at position i along the line, so the same scan
 * serves both rows and columns.
 */
function scanLine(
  at: (i: number) => number,
  length: number,
  onHit: (centre: number, moduleSize: number) => void,
): void {
  const counts = [0, 0, 0, 0, 0];
  let state = 0;
  for (let i = 0; i < length; i++) {
    const dark = at(i) === 1;
    if (dark) {
      // A light run ends an odd state; a dark pixel either continues the
      // current dark run or opens the next one.
      if ((state & 1) === 1) state++;
      counts[state]++;
    } else {
      if ((state & 1) === 0) {
        if (state === 4) {
          // Five runs are complete. Either it is a finder, or shuffle the
          // window along by two runs and keep looking from this light run.
          if (isFinderRatio(counts)) {
            onHit(crossCentre(counts, i), (counts[0] + counts[1] + counts[2] + counts[3] + counts[4]) / 7);
          }
          counts[0] = counts[2];
          counts[1] = counts[3];
          counts[2] = counts[4];
          counts[3] = 1;
          counts[4] = 0;
          state = 3;
          continue;
        }
        state++;
      }
      counts[state]++;
    }
  }
  // A pattern finishing flush with the edge of the line still counts.
  if (state === 4 && isFinderRatio(counts)) {
    onHit(crossCentre(counts, length), (counts[0] + counts[1] + counts[2] + counts[3] + counts[4]) / 7);
  }
}

/** Confirms a row hit by looking for the same ratio down the column through it. */
function confirmVertically(
  binary: Uint8Array,
  width: number,
  height: number,
  centreX: number,
  centreY: number,
  moduleSize: number,
): number | null {
  const x = Math.round(centreX);
  if (x < 0 || x >= width) return null;
  let best: number | null = null;
  let bestDistance = Infinity;
  scanLine(
    (i) => binary[i * width + x],
    height,
    (centre, size) => {
      // Only the crossing that lines up with this row hit, and agrees on how
      // big a module is, belongs to the same eye.
      if (size > moduleSize * 1.6 || size < moduleSize / 1.6) return;
      const distance = Math.abs(centre - centreY);
      if (distance < bestDistance && distance < moduleSize * 3.5) {
        bestDistance = distance;
        best = centre;
      }
    },
  );
  return best;
}

/**
 * Every finder pattern the bitmap appears to contain.
 *
 * Rows are scanned for the ratio, each hit is confirmed down its column, and
 * hits that land on the same spot are merged — a real eye is crossed by many
 * rows, a coincidence in the background usually by one or two.
 */
export function findFinderPatterns(
  binary: Uint8Array,
  width: number,
  height: number,
): FinderPattern[] {
  const found: FinderPattern[] = [];
  // Every third row: an eye spans at least seven, so nothing is missed, and it
  // keeps the scan cheap enough to run on a phone.
  const step = 3;

  for (let y = 0; y < height; y += step) {
    scanLine(
      (i) => binary[y * width + i],
      width,
      (centreX, moduleSize) => {
        const centreY = confirmVertically(binary, width, height, centreX, y, moduleSize);
        if (centreY === null) return;
        for (const p of found) {
          if (
            Math.abs(p.x - centreX) <= p.moduleSize * 2 &&
            Math.abs(p.y - centreY) <= p.moduleSize * 2 &&
            p.moduleSize <= moduleSize * 1.6 &&
            moduleSize <= p.moduleSize * 1.6
          ) {
            // Running average, so a merged centre is steadier than any one row.
            p.x = (p.x * p.hits + centreX) / (p.hits + 1);
            p.y = (p.y * p.hits + centreY) / (p.hits + 1);
            p.moduleSize = (p.moduleSize * p.hits + moduleSize) / (p.hits + 1);
            p.hits++;
            return;
          }
        }
        found.push({ x: centreX, y: centreY, moduleSize, hits: 1 });
      },
    );
  }

  // One stray crossing is noise; a real eye is found by several rows.
  return found.filter((p) => p.hits >= 2);
}

function distance(a: FinderPattern, b: FinderPattern): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Scores how much like a QR's three eyes a triple is: they sit on a right
 * angle, the two short sides are equal, and all three are the same size.
 * Lower is better; null when the triple cannot be a QR at all.
 */
function tripleError(a: FinderPattern, b: FinderPattern, c: FinderPattern): number | null {
  const sides = [
    { d: distance(a, b), opposite: c },
    { d: distance(b, c), opposite: a },
    { d: distance(a, c), opposite: b },
  ].sort((p, q) => p.d - q.d);
  const [short1, short2, long] = sides;
  if (short1.d <= 0) return null;

  // The two legs should match, and the hypotenuse should be their diagonal.
  const legError = Math.abs(short1.d - short2.d) / short2.d;
  const diagonalError = Math.abs(long.d - Math.hypot(short1.d, short2.d)) / long.d;
  if (legError > 0.5 || diagonalError > 0.35) return null;

  const sizes = [a.moduleSize, b.moduleSize, c.moduleSize];
  const sizeError = (Math.max(...sizes) - Math.min(...sizes)) / Math.min(...sizes);
  if (sizeError > 1.0) return null;

  // A code smaller than this is either noise or too coarse to scan later.
  const moduleSize = (a.moduleSize + b.moduleSize + c.moduleSize) / 3;
  if (long.d < moduleSize * 10) return null;

  return legError + diagonalError + sizeError * 0.5;
}

/**
 * The area a QR occupies, from the finder patterns found in the same buffer.
 *
 * The three eyes sit at three corners; the fourth is where the parallelogram
 * closes. Their centres are 3.5 modules inside the code's edge, and a scanner
 * wants a quiet zone around it, so the box is grown by both.
 */
export function qrBounds(patterns: FinderPattern[]): QrBounds | null {
  if (patterns.length < 3) return null;

  // Strongest evidence first, and never more triples than is worth checking.
  const candidates = [...patterns].sort((a, b) => b.hits - a.hits).slice(0, 8);
  let best: { error: number; trio: FinderPattern[] } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      for (let k = j + 1; k < candidates.length; k++) {
        const error = tripleError(candidates[i], candidates[j], candidates[k]);
        if (error === null) continue;
        if (!best || error < best.error) {
          best = { error, trio: [candidates[i], candidates[j], candidates[k]] };
        }
      }
    }
  }
  if (!best) return null;

  const [a, b, c] = best.trio;
  // The corner opposite the longest side is the one at the right angle; the
  // other two are its neighbours, so the missing corner closes the shape.
  const pairs = [
    { d: distance(a, b), corner: c, ends: [a, b] },
    { d: distance(b, c), corner: a, ends: [b, c] },
    { d: distance(a, c), corner: b, ends: [a, c] },
  ].sort((p, q) => q.d - p.d);
  const { corner, ends } = pairs[0];
  const fourth = {
    x: ends[0].x + ends[1].x - corner.x,
    y: ends[0].y + ends[1].y - corner.y,
  };

  const xs = [a.x, b.x, c.x, fourth.x];
  const ys = [a.y, b.y, c.y, fourth.y];
  const moduleSize = (a.moduleSize + b.moduleSize + c.moduleSize) / 3;
  // 3.5 modules out to the code's edge, plus a 4-module quiet zone.
  const pad = moduleSize * 7.5;
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const width = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const height = Math.max(...ys) - Math.min(...ys) + pad * 2;

  // A QR is square; a box far from it means the eyes were not one code.
  const aspect = width / height;
  if (aspect < 0.55 || aspect > 1.8) return null;

  return { x, y, width, height };
}

/** Greyscale for the scan: the usual luma weights, which keep ink dark on any hue. */
export function toGrayscale(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  return gray;
}

/** Locates a QR in one frame of pixels. Coordinates are that frame's. */
export function locateQr(rgba: Uint8ClampedArray, width: number, height: number): QrBounds | null {
  const gray = toGrayscale(rgba, width, height);
  const binary = binarize(gray, width, height);
  return qrBounds(findFinderPatterns(binary, width, height));
}
