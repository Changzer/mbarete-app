import { test } from "node:test";
import assert from "node:assert/strict";
import {
  binarize,
  findFinderPatterns,
  isFinderRatio,
  qrBounds,
  type FinderPattern,
} from "./find-qr";

/** A bitmap of 1 (ink) and 0 (paper), the shape the finder scan consumes. */
function bitmap(width: number, height: number) {
  const data = new Uint8Array(width * height);
  return {
    data,
    width,
    height,
    fillRect(x: number, y: number, w: number, h: number, value: number) {
      for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) {
        for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) {
          data[yy * width + xx] = value;
        }
      }
    },
  };
}

/**
 * Draws a finder pattern: 7x7 modules, a dark ring around a light ring around
 * a 3x3 dark core — the shape that reads 1:1:3:1:1 through its middle.
 */
function drawFinder(
  bmp: ReturnType<typeof bitmap>,
  left: number,
  top: number,
  moduleSize: number,
) {
  const m = moduleSize;
  bmp.fillRect(left, top, m * 7, m * 7, 1);
  bmp.fillRect(left + m, top + m, m * 5, m * 5, 0);
  bmp.fillRect(left + m * 2, top + m * 2, m * 3, m * 3, 1);
}

/** Three finders laid out as a QR's corners, with the quiet zone around them. */
function qrLikeBitmap(moduleSize: number, modulesAcross = 33, margin = 40) {
  const side = moduleSize * modulesAcross;
  const bmp = bitmap(side + margin * 2, side + margin * 2);
  drawFinder(bmp, margin, margin, moduleSize);
  drawFinder(bmp, margin + side - moduleSize * 7, margin, moduleSize);
  drawFinder(bmp, margin, margin + side - moduleSize * 7, moduleSize);
  return bmp;
}

test("the 1:1:3:1:1 run ratio identifies a finder pattern", () => {
  assert.equal(isFinderRatio([1, 1, 3, 1, 1]), true);
  assert.equal(isFinderRatio([4, 4, 12, 4, 4]), true);
  assert.equal(isFinderRatio([10, 10, 30, 10, 10]), true);
});

test("run ratios tolerate the stretching a tilted card introduces", () => {
  // A perspective view lengthens some runs and shortens others; within about
  // half a module either way it is still the same eye.
  assert.equal(isFinderRatio([9, 11, 30, 11, 9]), true);
  assert.equal(isFinderRatio([11, 10, 28, 10, 11]), true);
});

test("run ratios reject what is not a finder pattern", () => {
  assert.equal(isFinderRatio([1, 1, 1, 1, 1]), false, "no wide middle");
  assert.equal(isFinderRatio([10, 10, 10, 10, 10]), false);
  assert.equal(isFinderRatio([1, 1, 9, 1, 1]), false, "middle far too wide");
  assert.equal(isFinderRatio([0, 1, 3, 1, 1]), false, "an empty run is not a run");
  assert.equal(isFinderRatio([1, 1, 1, 1, 0]), false);
});

test("three finder patterns are found in a QR-shaped bitmap", () => {
  const m = 6;
  const bmp = qrLikeBitmap(m);
  const patterns = findFinderPatterns(bmp.data, bmp.width, bmp.height);
  assert.equal(patterns.length, 3);
  for (const p of patterns) {
    // Each centre should sit 3.5 modules inside its corner, and the scan
    // should have measured the module size it was drawn at.
    assert.ok(Math.abs(p.moduleSize - m) < 1.5, `module size ${p.moduleSize}`);
    assert.ok(p.hits >= 2, "a real eye is crossed by several scan lines");
  }
});

test("the bounds cover the whole code, not just the three eyes", () => {
  const m = 6;
  const modules = 33;
  const margin = 40;
  const bmp = qrLikeBitmap(m, modules, margin);
  const bounds = qrBounds(findFinderPatterns(bmp.data, bmp.width, bmp.height));
  assert.ok(bounds, "expected bounds");

  // The code spans `modules` modules starting at `margin`; the box must
  // contain all of it, with a quiet zone, without swallowing the whole image.
  assert.ok(bounds.x < margin, `left edge ${bounds.x} should clear the code`);
  assert.ok(bounds.y < margin, `top edge ${bounds.y} should clear the code`);
  assert.ok(bounds.x + bounds.width > margin + m * modules, "right edge");
  assert.ok(bounds.y + bounds.height > margin + m * modules, "bottom edge");
  assert.ok(bounds.width < bmp.width * 1.5, "not wildly oversized");
  const aspect = bounds.width / bounds.height;
  assert.ok(aspect > 0.9 && aspect < 1.1, `a QR is square, got aspect ${aspect}`);
});

test("bounds need three patterns", () => {
  const one: FinderPattern[] = [{ x: 10, y: 10, moduleSize: 4, hits: 5 }];
  assert.equal(qrBounds([]), null);
  assert.equal(qrBounds(one), null);
  assert.equal(qrBounds([...one, { x: 90, y: 10, moduleSize: 4, hits: 5 }]), null);
});

test("three patterns in a line are not a QR", () => {
  // Collinear eyes have no right angle, so they cannot be a code's corners —
  // this is the check that keeps repeating background detail from inventing one.
  const line: FinderPattern[] = [
    { x: 10, y: 10, moduleSize: 4, hits: 5 },
    { x: 60, y: 10, moduleSize: 4, hits: 5 },
    { x: 110, y: 10, moduleSize: 4, hits: 5 },
  ];
  assert.equal(qrBounds(line), null);
});

test("patterns of wildly different sizes are not one code", () => {
  const mixed: FinderPattern[] = [
    { x: 10, y: 10, moduleSize: 2, hits: 5 },
    { x: 200, y: 10, moduleSize: 20, hits: 5 },
    { x: 10, y: 200, moduleSize: 9, hits: 5 },
  ];
  assert.equal(qrBounds(mixed), null);
});

test("blank and noisy bitmaps yield no patterns", () => {
  const blank = bitmap(200, 200);
  assert.deepEqual(findFinderPatterns(blank.data, blank.width, blank.height), []);

  const stripes = bitmap(200, 200);
  for (let x = 0; x < 200; x += 4) stripes.fillRect(x, 0, 2, 200, 1);
  assert.equal(qrBounds(findFinderPatterns(stripes.data, stripes.width, stripes.height)), null);
});

test("binarizing separates ink from paper under uneven light", () => {
  // A page lit brightly on one side and dimly on the other: a single global
  // cutoff loses one half, a local one keeps both.
  const width = 120;
  const height = 40;
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const light = 60 + (x / width) * 180; // paper, dark left to bright right
      const ink = light * 0.35; // ink is always well below its local paper
      const isInk = Math.floor(x / 10) % 2 === 0;
      gray[y * width + x] = Math.round(isInk ? ink : light);
    }
  }
  const binary = binarize(gray, width, height);
  // Sample the middle of the first ink stripe and the first paper stripe on
  // each side of the image; both sides must come out right.
  assert.equal(binary[20 * width + 5], 1, "ink on the dim side");
  assert.equal(binary[20 * width + 15], 0, "paper on the dim side");
  assert.equal(binary[20 * width + 105], 1, "ink on the bright side");
  assert.equal(binary[20 * width + 115], 0, "paper on the bright side");
});
