export function const_2nd<T, U>(t: T): (u: U) => T {
  return (_: U) => t;
}

export function const_resolve<T, U>(t: T): (u: U) => Promise<T> {
  return (_: U) => Promise.resolve(t);
}
