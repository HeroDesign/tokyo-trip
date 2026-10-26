/**
 * Just enough EXIF for the photo map: when and where a JPEG was taken, which
 * way up it is, and its pixel size. Pure Node, no dependencies, so the ingest
 * step can run on the laptop the photos land on.
 *
 * Also strips metadata from a JPEG so the published copies carry no GPS
 * track, serial numbers or thumbnails. ICC colour profiles (APP2) are kept so
 * colours stay right; EXIF (APP1), XMP (APP1) and IPTC (APP13) go.
 */

const SOI = 0xffd8;
const APP1 = 0xffe1;
const APP13 = 0xffed;
const SOS = 0xffda;
const SOF_MARKERS = new Set([0xffc0, 0xffc1, 0xffc2, 0xffc3, 0xffc5, 0xffc6, 0xffc7, 0xffc9, 0xffca, 0xffcb, 0xffcd, 0xffce, 0xffcf]);

const TAG = {
  ORIENTATION: 0x0112,
  EXIF_IFD: 0x8769,
  GPS_IFD: 0x8825,
  DATE_TIME_ORIGINAL: 0x9003,
  OFFSET_TIME_ORIGINAL: 0x9011,
  SUBSEC_TIME_ORIGINAL: 0x9291,
  GPS_LAT_REF: 0x0001,
  GPS_LAT: 0x0002,
  GPS_LNG_REF: 0x0003,
  GPS_LNG: 0x0004,
};

export const isJpeg = (buf) => buf.length > 4 && buf.readUInt16BE(0) === SOI;

/** Walk the segments before the image data. */
function* segments(buf) {
  let offset = 2;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return;
    const marker = buf.readUInt16BE(offset);
    if (marker === SOS) return;
    const length = buf.readUInt16BE(offset + 2);
    yield { marker, offset, length, start: offset + 4, end: offset + 2 + length };
    offset += 2 + length;
  }
}

function readIfd(buf, tiff, offset, little) {
  const u16 = (at) => (little ? buf.readUInt16LE(at) : buf.readUInt16BE(at));
  const u32 = (at) => (little ? buf.readUInt32LE(at) : buf.readUInt32BE(at));
  const entries = new Map();
  if (tiff + offset + 2 > buf.length) return entries;
  const count = u16(tiff + offset);
  for (let i = 0; i < count; i++) {
    const at = tiff + offset + 2 + i * 12;
    if (at + 12 > buf.length) break;
    const tag = u16(at);
    const type = u16(at + 2);
    const n = u32(at + 4);
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] ?? 1;
    const valueAt = n * size <= 4 ? at + 8 : tiff + u32(at + 8);
    if (valueAt + n * size > buf.length) continue;
    let value;
    if (type === 2) value = buf.toString('latin1', valueAt, valueAt + n).replace(/\0+$/, '');
    else if (type === 3) value = Array.from({ length: n }, (_, k) => u16(valueAt + k * 2));
    else if (type === 4) value = Array.from({ length: n }, (_, k) => u32(valueAt + k * 4));
    else if (type === 5) value = Array.from({ length: n }, (_, k) => u32(valueAt + k * 8) / (u32(valueAt + k * 8 + 4) || 1));
    else continue;
    entries.set(tag, value);
  }
  return entries;
}

const dms = ([d = 0, m = 0, s = 0], ref) => (d + m / 60 + s / 3600) * (/[SW]/i.test(ref ?? '') ? -1 : 1);

/**
 * @returns {{ taken: string|null, coords: [number, number]|null, orientation: number, width: number, height: number }}
 * `taken` is ISO 8601 with the camera's own offset when it recorded one, else
 * `defaultOffset` (Japan has no DST, so +09:00 is right for the whole trip).
 */
export function readExif(buf, { defaultOffset = '+09:00' } = {}) {
  const out = { taken: null, coords: null, orientation: 1, width: 0, height: 0 };
  if (!isJpeg(buf)) return out;

  for (const seg of segments(buf)) {
    if (SOF_MARKERS.has(seg.marker) && !out.width) {
      out.height = buf.readUInt16BE(seg.start + 1);
      out.width = buf.readUInt16BE(seg.start + 3);
    }
    if (seg.marker !== APP1 || buf.toString('latin1', seg.start, seg.start + 6) !== 'Exif\0\0') continue;

    const tiff = seg.start + 6;
    const little = buf.toString('latin1', tiff, tiff + 2) === 'II';
    const u32 = (at) => (little ? buf.readUInt32LE(at) : buf.readUInt32BE(at));
    const ifd0 = readIfd(buf, tiff, u32(tiff + 4), little);
    out.orientation = ifd0.get(TAG.ORIENTATION)?.[0] ?? 1;

    const exifOffset = ifd0.get(TAG.EXIF_IFD)?.[0];
    if (exifOffset) {
      const exif = readIfd(buf, tiff, exifOffset, little);
      const stamp = exif.get(TAG.DATE_TIME_ORIGINAL);
      const m = stamp && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(stamp);
      if (m) {
        const offset = /^[+-]\d{2}:\d{2}$/.test(exif.get(TAG.OFFSET_TIME_ORIGINAL) ?? '')
          ? exif.get(TAG.OFFSET_TIME_ORIGINAL)
          : defaultOffset;
        out.taken = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset}`;
      }
    }

    const gpsOffset = ifd0.get(TAG.GPS_IFD)?.[0];
    if (gpsOffset) {
      const gps = readIfd(buf, tiff, gpsOffset, little);
      const lat = gps.get(TAG.GPS_LAT);
      const lng = gps.get(TAG.GPS_LNG);
      if (lat && lng) {
        const coords = [dms(lat, gps.get(TAG.GPS_LAT_REF)), dms(lng, gps.get(TAG.GPS_LNG_REF))];
        if (coords.every(Number.isFinite) && (coords[0] !== 0 || coords[1] !== 0)) {
          out.coords = coords.map((v) => Math.round(v * 1e6) / 1e6);
        }
      }
    }
  }
  // Orientation 5-8 are the rotated ones: the stored width is the displayed height.
  if (out.orientation >= 5) [out.width, out.height] = [out.height, out.width];
  return out;
}

/** The same JPEG without EXIF, XMP or IPTC. Pixels untouched. */
export function stripMetadata(buf) {
  if (!isJpeg(buf)) return buf;
  const keep = [buf.subarray(0, 2)];
  let cursor = 2;
  for (const seg of segments(buf)) {
    const drop = seg.marker === APP1 || seg.marker === APP13;
    if (drop) {
      keep.push(buf.subarray(cursor, seg.offset));
      cursor = seg.end;
    }
  }
  keep.push(buf.subarray(cursor));
  return Buffer.concat(keep);
}

/** True when the buffer still carries an EXIF block (used to verify a strip). */
export function hasExif(buf) {
  if (!isJpeg(buf)) return false;
  for (const seg of segments(buf)) {
    if (seg.marker === APP1 && buf.toString('latin1', seg.start, seg.start + 6) === 'Exif\0\0') return true;
  }
  return false;
}
