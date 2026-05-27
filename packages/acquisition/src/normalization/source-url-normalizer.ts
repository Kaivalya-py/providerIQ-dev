export function canonicalizeSourceUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.searchParams.delete('hl');
    return parsed.toString();
  } catch {
    return url;
  }
}
