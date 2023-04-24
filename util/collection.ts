export function remove_element<T>(haystack: T[], needle: T): T[] {
  const index = haystack.indexOf(needle);
  if (index === -1) {
    return haystack;
  }
  return [...haystack.slice(0, index), ...haystack.slice(index + 1)];
}
