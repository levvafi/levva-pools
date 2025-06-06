import { Fp96One, SECONDS_IN_YEAR_X96, WHOLE_ONE } from './types';
import { fp96FromRatio, powTaylor } from './math';

export function calcAccruedRateContext(args: { interestRate: bigint; fee: bigint; secondsPassed: number }): {
  interestRateX96: bigint;
  feeDt: bigint;
} {
  const interestRateX96 = (args.interestRate * Fp96One) / WHOLE_ONE;
  const feeX96 = (args.fee * Fp96One) / WHOLE_ONE;
  const onePlusFee = (feeX96 * Fp96One) / SECONDS_IN_YEAR_X96 + Fp96One;
  const feeDt = powTaylor(onePlusFee, args.secondsPassed);

  return {
    interestRateX96,
    feeDt,
  };
}

export function calcBaseCoeffs(args: {
  baseDebtCoeffX96: bigint;
  baseCollateralCoeffX96: bigint;
  baseDelevCoeffX96: bigint;
  discountedBaseDebt: bigint;
  discountedBaseCollateral: bigint;
  discountedQuoteDebt: bigint;
  interestRateX96: bigint;
  systemLeverageShortX96: bigint;
  secondsPassed: number;
  feeDt: bigint;
}): {
  baseCollateralCoeffX96: bigint;
  baseDelevCoeffX96: bigint;
  baseDebtCoeffX96: bigint;
} {
  const realBaseDebtPrev = (args.baseDebtCoeffX96 * args.discountedBaseDebt) / Fp96One;
  const onePlusIRshort = (args.interestRateX96 * args.systemLeverageShortX96) / SECONDS_IN_YEAR_X96 + Fp96One;
  const accruedRateDt = powTaylor(onePlusIRshort, args.secondsPassed);
  const baseDebtCoeffMul = (accruedRateDt * args.feeDt) / Fp96One;

  const realBaseCollateral =
    (args.baseCollateralCoeffX96 * args.discountedBaseCollateral) / Fp96One -
    (args.baseDelevCoeffX96 * args.discountedQuoteDebt) / Fp96One;

  const factor = Fp96One + fp96FromRatio(((accruedRateDt - Fp96One) * realBaseDebtPrev) / Fp96One, realBaseCollateral);

  return {
    baseCollateralCoeffX96: (args.baseCollateralCoeffX96 * factor) / Fp96One,
    baseDelevCoeffX96: (args.baseDelevCoeffX96 * factor) / Fp96One,
    baseDebtCoeffX96: (args.baseDebtCoeffX96 * baseDebtCoeffMul) / Fp96One,
  };
}

export function calcQuoteCoeffs(args: {
  quoteCollateralCoeffX96: bigint;
  quoteDebtCoeffX96: bigint;
  quoteDelevCoeffX96: bigint;
  discountedQuoteCollateral: bigint;
  discountedQuoteDebt: bigint;
  discountedBaseDebt: bigint;
  interestRateX96: bigint;
  systemLeverageLongX96: bigint;
  secondsPassed: number;
  feeDt: bigint;
}): {
  quoteCollateralCoeffX96: bigint;
  quoteDelevCoeffX96: bigint;
  quoteDebtCoeffX96: bigint;
} {
  const realQuoteDebtPrev = (args.quoteDebtCoeffX96 * args.discountedQuoteDebt) / Fp96One;
  const onePlusIRLong = (args.interestRateX96 * args.systemLeverageLongX96) / SECONDS_IN_YEAR_X96 + Fp96One;
  const accruedRateDt = powTaylor(onePlusIRLong, args.secondsPassed);
  const quoteDebtCoeffMul = (accruedRateDt * args.feeDt) / Fp96One;

  const realQuoteCollateral =
    (args.quoteCollateralCoeffX96 * args.discountedQuoteCollateral) / Fp96One -
    (args.quoteDelevCoeffX96 * args.discountedBaseDebt) / Fp96One;

  const factor =
    Fp96One + fp96FromRatio(((accruedRateDt - Fp96One) * realQuoteDebtPrev) / Fp96One, realQuoteCollateral);

  return {
    quoteCollateralCoeffX96: (args.quoteCollateralCoeffX96 * factor) / Fp96One,
    quoteDelevCoeffX96: (args.quoteDelevCoeffX96 * factor) / Fp96One,
    quoteDebtCoeffX96: (args.quoteDebtCoeffX96 * quoteDebtCoeffMul) / Fp96One,
  };
}
