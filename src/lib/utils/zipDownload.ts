export type ZipEntryInput = {
  filename: string;
  blob: Blob;
  modifiedAt?: Date;
};

const textEncoder = new TextEncoder();
let crcTable: Uint32Array | null = null;

export async function createZipBlob(entries: ZipEntryInput[]): Promise<Blob> {
  const localParts: ArrayBuffer[] = [];
  const centralParts: ArrayBuffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = await entry.blob.arrayBuffer();
    const filename = textEncoder.encode(safeZipPath(entry.filename));
    const crc = crc32(new Uint8Array(data));
    const { date, time } = dosDateTime(entry.modifiedAt ?? new Date());
    const localHeader = localFileHeader(filename, crc, data.byteLength, time, date);
    const centralHeader = centralDirectoryHeader(filename, crc, data.byteLength, time, date, offset);

    localParts.push(arrayBufferPart(localHeader), data);
    centralParts.push(arrayBufferPart(centralHeader));
    offset += localHeader.byteLength + data.byteLength;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const end = endOfCentralDirectory(entries.length, centralSize, offset);
  return new Blob([...localParts, ...centralParts, arrayBufferPart(end)], { type: 'application/zip' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function localFileHeader(filename: Uint8Array, crc: number, size: number, time: number, date: number): Uint8Array {
  const header = new Uint8Array(30 + filename.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, filename.byteLength, true);
  view.setUint16(28, 0, true);
  header.set(filename, 30);
  return header;
}

function centralDirectoryHeader(
  filename: Uint8Array,
  crc: number,
  size: number,
  time: number,
  date: number,
  offset: number
): Uint8Array {
  const header = new Uint8Array(46 + filename.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, filename.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  header.set(filename, 46);
  return header;
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Uint8Array {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return header;
}

function crc32(data: Uint8Array): number {
  const table = crcTable ?? (crcTable = buildCrcTable());
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function dosDateTime(dateValue: Date): { date: number; time: number } {
  const year = Math.max(1980, dateValue.getFullYear());
  const month = dateValue.getMonth() + 1;
  const day = dateValue.getDate();
  const hours = dateValue.getHours();
  const minutes = dateValue.getMinutes();
  const seconds = Math.floor(dateValue.getSeconds() / 2);
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds
  };
}

function safeZipPath(filename: string): string {
  return filename.replace(/^[/\\]+/, '').replace(/\\/g, '/').replace(/\.\.(\/|$)/g, '');
}

function arrayBufferPart(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
