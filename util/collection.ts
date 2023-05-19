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
