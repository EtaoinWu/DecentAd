export function generic_min<T>(
  op: (lhs: T, rhs: T) => boolean,
): (a: T, ...b: T[]) => T {
  return (a: T, ...b: T[]): T => {
    let opt = a;
    for (const x of b) {
      if (op(x, opt)) {
        opt = x;
      }
    }
    return opt;
  };
}

export const max: <T>(a: T, ...b: T[]) => T = generic_min((lhs, rhs) =>
  lhs > rhs
);

export const min: <T>(a: T, ...b: T[]) => T = generic_min((lhs, rhs) =>
  lhs < rhs
);
