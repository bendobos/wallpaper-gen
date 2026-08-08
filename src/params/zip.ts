/**
 * Minimal ZIP writer, store method only.
 *
 * No compression on purpose: every file that goes in here is already a PNG,
 * JPEG or WebP, so deflate would spend real time to save nothing. That also
 * makes the whole format about seventy lines with no dependency — the
 * alternative was pulling in a compression library to not compress anything.
 *
 * A batch export is delivered as one archive rather than as N downloads because
 * browsers throttle or silently block repeated automatic downloads, and a
 * folder of wallpapers is what you wanted anyway.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** CRC-32, table built once on first use. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * MS-DOS date and time, which is what the format stores.
 *
 * Years run from 1980 and seconds have two-second resolution — the odd
 * encoding is the format's, not ours.
 */
function dosDateTime(d: Date): { date: number; time: number } {
  return {
    date: (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

class ByteWriter {
  private parts: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array) {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  /** Little-endian, which is the only byte order the format uses. */
  u16(v: number) {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }

  u32(v: number) {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }

  blob(type: string): Blob {
    return new Blob(this.parts as BlobPart[], { type });
  }
}

export function createZip(entries: ZipEntry[], now = new Date()): Blob {
  const { date, time } = dosDateTime(now);
  const encoder = new TextEncoder();
  const out = new ByteWriter();
  const central: Array<{ name: Uint8Array; crc: number; size: number; offset: number }> = [];

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const offset = out.length;

    out.u32(0x04034b50); // local file header
    out.u16(20); // version needed
    // Bit 11 marks the name as UTF-8, which matters as soon as a preset name
    // carries an umlaut.
    out.u16(0x0800);
    out.u16(0); // method 0 = stored
    out.u16(time);
    out.u16(date);
    out.u32(crc);
    out.u32(entry.data.length); // compressed size
    out.u32(entry.data.length); // uncompressed size
    out.u16(name.length);
    out.u16(0); // extra field length
    out.push(name);
    out.push(entry.data);

    central.push({ name, crc, size: entry.data.length, offset });
  }

  const centralStart = out.length;
  for (const e of central) {
    out.u32(0x02014b50); // central directory header
    out.u16(20); // version made by
    out.u16(20); // version needed
    out.u16(0x0800);
    out.u16(0);
    out.u16(time);
    out.u16(date);
    out.u32(e.crc);
    out.u32(e.size);
    out.u32(e.size);
    out.u16(e.name.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk number
    out.u16(0); // internal attributes
    out.u32(0); // external attributes
    out.u32(e.offset);
    out.push(e.name);
  }

  // Captured before the trailer starts, or its own bytes would be counted as
  // part of the directory it is describing.
  const centralSize = out.length - centralStart;

  out.u32(0x06054b50); // end of central directory
  out.u16(0); // this disk
  out.u16(0); // disk with central directory
  out.u16(central.length);
  out.u16(central.length);
  out.u32(centralSize);
  out.u32(centralStart);
  out.u16(0); // comment length

  return out.blob('application/zip');
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}
