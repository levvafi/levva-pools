export const FP96 = {
  one: 2n ** 96n,
};

export const FP48 = {
  one: 2n ** 48n,
};

// 365.25 * 24 * 60 * 60 * 2 ** 96
export const secondsInYearX96 = BigInt('2500250661360148260042022567123353600');

export function pow(self: bigint, exponent: bigint): bigint {
  let result = FP96.one;
  while (exponent > 0n) {
    if ((exponent & 1n) == 1n) {
      result = (result * self) / FP96.one;
    }
    self = (self * self) / FP96.one;
    exponent = exponent >> 1n;
  }

  return result;
}

export function powTaylor(self: bigint, exponent: bigint): bigint {
  const x = self - FP96.one;
  if (x >= FP96.one) {
    throw new Error(`x can't be greater than FP.one, series diverges`);
  }

  let resultX96 = FP96.one;
  let multiplier: bigint;
  let term = FP96.one;

  const steps = exponent < 3n ? exponent : 3n;
  for (let i = 0n; i != steps; ++i) {
    multiplier = ((exponent - i) * x) / (i + 1n);
    term = (term * multiplier) / FP96.one;
    resultX96 = resultX96 + term;
  }

  return resultX96;
}

export function toHumanString(fp96Value: bigint): string {
  return (fp96Value / FP96.one).toString();
}

export function fp48ToHumanString(fp10Value: bigint): string {
  return (fp10Value / FP48.one).toString();
}
