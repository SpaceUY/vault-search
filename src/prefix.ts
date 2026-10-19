export function normalizePrefix(prefix: string | undefined): string {
  if (prefix === undefined || prefix === "") return "";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}
