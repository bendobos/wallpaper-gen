/**
 * Builds a gradient from the colours in an image.
 *
 * Median cut rather than k-means: it is deterministic, so the same photo always
 * gives the same ramp, and it is short enough to read. k-means would need a
 * seed, several iterations, and would still land somewhere slightly different
 * each run — for a control the user re-rolls by choosing a different picture,
 * that is all cost and no benefit.
 *
 * Unlike a custom matcap, the result is a plain gradient string, so it travels
 * in a share link like any other parameter.
 */

import { formatGradient, type Stop } from './gradient';

/** Long edge the source is scaled to before sampling. */
const SAMPLE_SIZE = 96;

interface Box {
  pixels: Uint8Array; // rgb triples
  count: number;
}

function channelRange(box: Box, channel: number): number {
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < box.count; i++) {
    const v = box.pixels[i * 3 + channel];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

function splitBox(box: Box): [Box, Box] {
  // Cut along whichever channel the box is widest in — the point of median cut.
  let channel = 0;
  let widest = -1;
  for (let c = 0; c < 3; c++) {
    const r = channelRange(box, c);
    if (r > widest) {
      widest = r;
      channel = c;
    }
  }

  const indices = Array.from({ length: box.count }, (_, i) => i);
  indices.sort((a, b) => box.pixels[a * 3 + channel] - box.pixels[b * 3 + channel]);

  const half = Math.floor(box.count / 2);
  const take = (from: number, to: number): Box => {
    const out = new Uint8Array((to - from) * 3);
    for (let i = from; i < to; i++) {
      const src = indices[i] * 3;
      out[(i - from) * 3] = box.pixels[src];
      out[(i - from) * 3 + 1] = box.pixels[src + 1];
      out[(i - from) * 3 + 2] = box.pixels[src + 2];
    }
    return { pixels: out, count: to - from };
  };

  return [take(0, half), take(half, box.count)];
}

function averageColour(box: Box): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < box.count; i++) {
    r += box.pixels[i * 3];
    g += box.pixels[i * 3 + 1];
    b += box.pixels[i * 3 + 2];
  }
  const n = Math.max(box.count, 1);
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

const hex = (c: [number, number, number]) =>
  c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');

const luma = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Percentile of pixels averaged into each end anchor. */
const ANCHOR_TAIL = 0.02;

/**
 * Mean colour of the darkest and brightest tails of the image.
 *
 * Averaged over a couple of percent rather than taken from the single extreme
 * pixel, so one blown highlight or compression artefact cannot decide where the
 * ramp ends.
 */
function luminanceAnchors(box: Box): [[number, number, number], [number, number, number]] {
  const order = Array.from({ length: box.count }, (_, i) => i).sort((a, b) => {
    const la = luma([box.pixels[a * 3], box.pixels[a * 3 + 1], box.pixels[a * 3 + 2]]);
    const lb = luma([box.pixels[b * 3], box.pixels[b * 3 + 1], box.pixels[b * 3 + 2]]);
    return la - lb;
  });

  const tail = Math.max(1, Math.round(box.count * ANCHOR_TAIL));
  const mean = (from: number, to: number): [number, number, number] => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = from; i < to; i++) {
      const o = order[i] * 3;
      r += box.pixels[o];
      g += box.pixels[o + 1];
      b += box.pixels[o + 2];
    }
    const n = Math.max(to - from, 1);
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  };

  return [mean(0, tail), mean(box.count - tail, box.count)];
}

/**
 * Extracts `count` representative colours and lays them out as a ramp.
 *
 * Sorted by luminance and spread evenly, because the gradient is indexed by
 * image brightness — a ramp whose stops are not monotonic in luminance would
 * make bright parts of the render darker than dim ones.
 */
export function paletteToGradient(image: ImageData, count = 5): string {
  const total = image.width * image.height;
  const pixels = new Uint8Array(total * 3);
  let kept = 0;

  for (let i = 0; i < total; i++) {
    // Skip near-transparent pixels: their colour is meaningless and averaging
    // it in drags the whole palette toward whatever the PNG happened to store.
    if (image.data[i * 4 + 3] < 128) continue;
    pixels[kept * 3] = image.data[i * 4];
    pixels[kept * 3 + 1] = image.data[i * 4 + 1];
    pixels[kept * 3 + 2] = image.data[i * 4 + 2];
    kept++;
  }
  if (kept === 0) return '0:000000,1:ffffff';

  const all: Box = { pixels: pixels.subarray(0, kept * 3), count: kept };

  // Anchor the ends to the image's actual extremes before quantising.
  //
  // Median cut cannot find them on its own: it splits a box at its median
  // pixel, so an image that is 94% mid-tone splits into two mid-tone halves and
  // a small highlight stays buried however many colours you ask for. Measured
  // on exactly that image, the palette came back as three copies of the same
  // brown with both extremes gone. Choosing which box to split differently does
  // not help — the median is the problem, not the selection.
  //
  // Percentiles rather than the single darkest and brightest pixel, so one
  // stuck sensor pixel or a JPEG artefact cannot set the end of the ramp.
  const [dark, bright] = luminanceAnchors(all);

  let boxes: Box[] = [all];
  const middles = Math.max(0, count - 2);
  while (boxes.length < Math.max(middles, 1)) {
    // Split whichever box holds the most pixels, so the middle of the ramp
    // follows where the image actually spends its area.
    let target = 0;
    for (let i = 1; i < boxes.length; i++) if (boxes[i].count > boxes[target].count) target = i;
    if (boxes[target].count < 2) break;
    const [a, b] = splitBox(boxes[target]);
    boxes = [...boxes.slice(0, target), a, b, ...boxes.slice(target + 1)];
  }

  // Keep only the quantised colours that genuinely sit between the anchors, so
  // the ramp stays monotonic in luminance — it is indexed by image brightness,
  // and a stop that dips backwards would make bright parts of the render
  // darker than dim ones.
  const inner = boxes
    .map(averageColour)
    .filter((c) => luma(c) > luma(dark) && luma(c) < luma(bright))
    .sort((a, b) => luma(a) - luma(b));

  const colours = [dark, ...inner, bright];
  const stops: Stop[] = colours.map((c, i) => ({
    pos: i / (colours.length - 1),
    hex: hex(c),
  }));

  return formatGradient(stops);
}

/** Decodes and downsamples an uploaded image to something worth scanning. */
export async function imageToPalette(source: Blob, count = 5): Promise<string> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = SAMPLE_SIZE / Math.max(bitmap.width, bitmap.height, 1);
    const w = Math.max(1, Math.round(bitmap.width * Math.min(1, scale)));
    const h = Math.max(1, Math.round(bitmap.height * Math.min(1, scale)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not read the image');
    ctx.drawImage(bitmap, 0, 0, w, h);
    return paletteToGradient(ctx.getImageData(0, 0, w, h), count);
  } finally {
    bitmap.close();
  }
}
