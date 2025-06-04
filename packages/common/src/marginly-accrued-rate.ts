import { BigNumber } from 'ethers';
import { Fp96One, SECONDS_IN_YEAR_X96, WHOLE_ONE } from './types';
import { fp96FromRatio, powTaylor } from './math';

export function calcAccruedRateContext(args: { interestRate: BigNumber; fee: BigNumber; secondsPassed: number }): {
  interestRateX96: BigNumber;
  feeDt: BigNumber;
} {
  const interestRateX96 = BigNumber.from(args.interestRate)*(Fp96One)/(WHOLE_ONE);
  const feeX96 = BigNumber.from(args.fee)*(Fp96One)/(WHOLE_ONE);
  const onePlusFee = feeX96*(Fp96One)/(SECONDS_IN_YEAR_X96).add(Fp96One);
  const feeDt = powTaylor(onePlusFee, args.secondsPassed);

  return {
    interestRateX96,
    feeDt,
  };
}

export function calcBaseCoeffs(args: {
  baseDebtCoeffX96: BigNumber;
  baseCollateralCoeffX96: BigNumber;
  baseDelevCoeffX96: BigNumber;
  discountedBaseDebt: BigNumber;
  discountedBaseCollateral: BigNumber;
  discountedQuoteDebt: BigNumber;
  interestRateX96: BigNumber;
  systemLeverageShortX96: BigNumber;
  secondsPassed: number;
  feeDt: BigNumber;
}): {
  baseCollateralCoeffX96: BigNumber;
  baseDelevCoeffX96: BigNumber;
  baseDebtCoeffX96: BigNumber;
} {
  const realBaseDebtPrev = args.baseDebtCoeffX96*(args.discountedBaseDebt)/(Fp96One);
  const onePlusIRshort = args.interestRateX96*(args.systemLeverageShortX96)/(SECONDS_IN_YEAR_X96).add(Fp96One);
  const accruedRateDt = powTaylor(onePlusIRshort, args.secondsPassed);
  const baseDebtCoeffMul = accruedRateDt*(args.feeDt)/(Fp96One);

  const realBaseCollateral = args.baseCollateralCoeffX96
    *(args.discountedBaseCollateral)
    /(Fp96One)
    -(args.baseDelevCoeffX96*(args.discountedQuoteDebt)/(Fp96One));

  const factor = Fp96One.add(
    fp96FromRatio(accruedRateDt-(Fp96One)*(realBaseDebtPrev)/(Fp96One), realBaseCollateral)
  );

  return {
    baseCollateralCoeffX96: args.baseCollateralCoeffX96*(factor)/(Fp96One),
    baseDelevCoeffX96: args.baseDelevCoeffX96*(factor)/(Fp96One),
    baseDebtCoeffX96: args.baseDebtCoeffX96*(baseDebtCoeffMul)/(Fp96One),
  };
}

export function calcQuoteCoeffs(args: {
  quoteCollateralCoeffX96: BigNumber;
  quoteDebtCoeffX96: BigNumber;
  quoteDelevCoeffX96: BigNumber;
  discountedQuoteCollateral: BigNumber;
  discountedQuoteDebt: BigNumber;
  discountedBaseDebt: BigNumber;
  interestRateX96: BigNumber;
  systemLevarageLongX96: BigNumber;
  secondsPassed: number;
  feeDt: BigNumber;
}): {
  quoteCollateralCoeffX96: BigNumber;
  quoteDelevCoeffX96: BigNumber;
  quoteDebtCoeffX96: BigNumber;
} {
  const realQuoteDebtPrev = args.quoteDebtCoeffX96*(args.discountedQuoteDebt)/(Fp96One);
  const onePlusIRLong = args.interestRateX96*(args.systemLevarageLongX96)/(SECONDS_IN_YEAR_X96).add(Fp96One);
  const accruedRateDt = powTaylor(onePlusIRLong, args.secondsPassed);
  const quoteDebtCoeffMul = accruedRateDt*(args.feeDt)/(Fp96One);

  const realQuoteCollateral = args.quoteCollateralCoeffX96
    *(args.discountedQuoteCollateral)
    /(Fp96One)
    -(args.quoteDelevCoeffX96*(args.discountedBaseDebt)/(Fp96One));

  const factor = Fp96One.add(
    fp96FromRatio(accruedRateDt-(Fp96One)*(realQuoteDebtPrev)/(Fp96One), realQuoteCollateral)
  );

  return {
    quoteCollateralCoeffX96: args.quoteCollateralCoeffX96*(factor)/(Fp96One),
    quoteDelevCoeffX96: args.quoteDelevCoeffX96*(factor)/(Fp96One),
    quoteDebtCoeffX96: args.quoteDebtCoeffX96*(quoteDebtCoeffMul)/(Fp96One),
  };
}
