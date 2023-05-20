export function remove_element<T>(haystack: T[], needle: T): T[] {
  const index = haystack.indexOf(needle);
  if (index === -1) {
    return haystack;
  }
  return [...haystack.slice(0, index), ...haystack.slice(index + 1)];
}

export function fix_length<T>(arr: T[], length: number, filler: T): T[] {
  if (arr.length >= length) {
    return arr.slice(0, length);
  }
  return [...arr, ...Array(length - arr.length).fill(filler)];
}

export function aoo2ooa<T extends string, U>(
  ooa: Record<T, U>[],
): Record<T, U[]> {
  const keys = Object.keys(ooa[0]) as T[];
  return Object.fromEntries(
    keys.map((key: T) => [key, ooa.map((o) => o[key])]),
  ) as Record<T, U[]>;
}

export function ooa2aoo<T extends string, U>(
  ooa: Record<T, U[]>,
): Record<T, U>[] {
  const keys = Object.keys(ooa) as T[];
  return ooa[keys[0]].map((_, i) =>
    Object.fromEntries(
      keys.map((key: T) => [key, ooa[key][i]]),
    ) as Record<T, U>
  );
}
