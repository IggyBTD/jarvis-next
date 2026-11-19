// A small zip reader (deflate or stored, no zip64, no encryption): enough to unpack the bundle the server builds, with no unzip
// program needed. Names that could leave the target folder are refused.
import zlib from 'node:zlib';

export function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip directory');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (/^([a-z]:|[\\/])/i.test(name) || name.split(/[\\/]/).includes('..') || name.includes('\0')) throw new Error(`unsafe name in zip: ${name}`);
    const lnlen = buf.readUInt16LE(off + 26);
    const lxlen = buf.readUInt16LE(off + 28);
    const raw = buf.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? raw : null;
    if (!data) throw new Error(`unsupported compression in ${name}`);
    if (zlib.crc32(data) !== crc) throw new Error(`checksum mismatch in ${name}`);
    files.push({ name, data });
  }
  return files;
}
