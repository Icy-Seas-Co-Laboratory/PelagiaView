export type CodecAvailability = Record<string, boolean | undefined>;

const CODEC_ALIASES: Record<string, string> = {
  jpeg: 'jpg',
  jpeg_xl: 'jxl',
  jpegxl: 'jxl',
  image_jxl: 'jxl',
  jpeg_xs: 'jxs',
  jpegxs: 'jxs',
  image_jxs: 'jxs',
  zstandard: 'zstd'
};

export function normalizeCodec(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, '_');
  return CODEC_ALIASES[normalized] ?? normalized;
}

export function uniqueCodecOptions(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const codec = normalizeCodec(value);
    if (!codec || seen.has(codec)) continue;
    seen.add(codec);
    result.push(codec);
  }
  return result;
}

export function codecAvailable(availability: CodecAvailability, codec: string): boolean {
  const normalized = normalizeCodec(codec);
  if (normalized === 'auto') return true;
  const value = availability[normalized] ?? availability[codec];
  return value !== false;
}

export function firstAvailableCodec(options: string[], availability: CodecAvailability, fallback: string): string {
  return uniqueCodecOptions(options).find((codec) => codecAvailable(availability, codec)) ?? fallback;
}

export function ensureAvailableCodec(
  codec: string,
  options: string[],
  availability: CodecAvailability,
  fallback: string
): string {
  const normalized = normalizeCodec(codec);
  return codecAvailable(availability, normalized)
    ? normalized
    : firstAvailableCodec(options, availability, fallback);
}

export function codecUnavailableTitle(availability: CodecAvailability, codec: string): string | undefined {
  return codecAvailable(availability, codec) ? undefined : `${codec} is not available in this Pelagia server environment.`;
}
