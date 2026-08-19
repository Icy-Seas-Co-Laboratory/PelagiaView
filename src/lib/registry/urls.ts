export function withBase(base: string, path: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(path) || /^(?:data|blob):/i.test(path)) return path;
  if (base === '.' || base === './') return `./${path.replace(/^\/+/, '')}`;
  const normalizedBase = base && base !== '/' ? `/${base.replace(/^\/+|\/+$/g, '')}` : '';
  return `${normalizedBase}/${path.replace(/^\/+/, '')}`;
}
