import { ethers } from 'hardhat';
import { HDNodeWallet } from 'ethers';
import { MarginlyPool } from '../../typechain-types';
import { expect } from 'chai';
import { TechnicalPositionOwner } from './fixtures';

export async function generateWallets(count: number): Promise<HDNodeWallet[]> {
  const wallets = [];
  for (let i = 0; i < count; i++) {
    let wallet = ethers.Wallet.createRandom();
    wallet = wallet.connect(ethers.provider);
    wallets.push(wallet);
  }

  return wallets;
}

export const PositionType = {
  Uninitialized: 0,
  Lend: 1,
  Short: 2,
  Long: 3,
};

export const MarginlyPoolMode = {
  Regular: 0,
  ShortEmergency: 1,
  LongEmergency: 2,
};

export const CallType = {
  DepositBase: 0,
  DepositQuote: 1,
  WithdrawBase: 2,
  WithdrawQuote: 3,
  Short: 4,
  Long: 5,
  ClosePosition: 6,
  Reinit: 7,
  ReceivePosition: 8,
  EmergencyWithdraw: 9,
};

export const FP96 = {
  Q96: 2 ** 96,
  one: 2n ** 96n,
};

export const FP48 = {
  Q48: 2n ** 48n,
};

export function convertNumberToFP96(num: number): { inner: bigint } {
  return { inner: BigInt(num * FP96.Q96) };
}

export function convertFP96ToNumber(fp: bigint): number {
  const tmp = fp / 2n ** 48n;
  return Number(tmp) / 2 ** 48;
}

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

export function calcLongSortKey(initialPrice: bigint, quoteAmount: bigint, baseAmount: bigint): bigint {
  const collateral = (initialPrice * baseAmount) / FP96.one;
  const debt = quoteAmount;

  return (debt * FP48.Q48) / collateral;
}

export function calcShortSortKey(initialPrice: bigint, quoteAmount: bigint, baseAmount: bigint): bigint {
  const collateral = quoteAmount;
  const debt = (initialPrice * baseAmount) / FP96.one;

  return (debt * FP48.Q48) / collateral;
}

export function calcLeverageShort(
  basePrice: bigint,
  quoteCollateralCoeff: bigint,
  baseDebtCoeff: bigint,
  quoteAmount: bigint,
  baseAmount: bigint
) {
  const collateral = ((quoteCollateralCoeff * quoteAmount) / FP96.one) * FP96.one;
  const debt = ((((baseDebtCoeff * basePrice) / FP96.one) * baseAmount) / FP96.one) * FP96.one;

  return (collateral * FP96.one) / (collateral - debt);
}

export function calcLeverageLong(
  basePrice: bigint,
  quoteDebtCoeff: bigint,
  baseCollateralCoeff: bigint,
  quoteAmount: bigint,
  baseAmount: bigint
) {
  const collateral = ((((baseCollateralCoeff * basePrice) / FP96.one) * baseAmount) / FP96.one) * FP96.one;
  const debt = ((quoteDebtCoeff * quoteAmount) / FP96.one) * FP96.one;

  return (collateral * FP96.one) / (collateral - debt);
}

export const paramsDefaultLeverageWithoutIr = {
  interestRate: 0,
  maxLeverage: 20,
  swapFee: 1000, // 0.1%
  fee: 0,
  mcSlippage: 50000, //5%
  positionMinAmount: 5, // 5 Wei
  quoteLimit: 1_000_000,
};

export const paramsLowLeverageWithoutIr = {
  interestRate: 0,
  maxLeverage: 19,
  swapFee: 1000, // 0.1%
  fee: 0,
  mcSlippage: 50000, //5%
  positionMinAmount: 5, // 5 Wei
  quoteLimit: 1_000_000,
};

export const paramsLowLeverageWithIr = {
  interestRate: 54000,
  maxLeverage: 19,
  swapFee: 1000, // 0.1%
  fee: 20000,
  mcSlippage: 50000, //5%
  positionMinAmount: 5, // 5 Wei
  quoteLimit: 1_000_000,
};

export const WHOLE_ONE = 10n ** 6n;
export const SECONDS_IN_YEAR_X96 = BigInt(365.25 * 24 * 60 * 60) * FP96.one;

export function mulFp96(firstX96: bigint, secondX96: bigint): bigint {
  return (firstX96 * secondX96) / FP96.one;
}

function divFp96(nomX96: bigint, denomX96: bigint): bigint {
  return (nomX96 * FP96.one) / denomX96;
}

function fp96FromRatio(nom: bigint, denom: bigint): bigint {
  return (nom * FP96.one) / denom;
}

export async function calcAccruedRateCoeffs(marginlyPool: MarginlyPool, prevState: MarginlyPoolState) {
  const params = prevState.params;
  const leverageShortX96 = prevState.systemLeverage.shortX96;
  const leverageLongX96 = prevState.systemLeverage.longX96;

  const lastReinitOnPrevBlock = prevState.lastReinitTimestampSeconds;
  const lastReinitTimestamp = await marginlyPool.lastReinitTimestampSeconds();
  const secondsPassed = lastReinitTimestamp - lastReinitOnPrevBlock;
  if (secondsPassed === 0n) {
    throw new Error(`Wrong argument`);
  }

  const baseDebtCoeffPrev = prevState.baseDebtCoeff;
  const quoteDebtCoeffPrev = prevState.quoteDebtCoeff;
  const baseCollateralCoeffPrev = prevState.baseCollateralCoeff;
  const quoteCollateralCoeffPrev = prevState.quoteCollateralCoeff;
  const result = {
    baseDebtCoeff: baseDebtCoeffPrev,
    quoteDebtCoeff: quoteDebtCoeffPrev,
    baseCollateralCoeff: baseCollateralCoeffPrev,
    quoteCollateralCoeff: quoteCollateralCoeffPrev,
    discountedBaseDebtFee: 0n,
    discountedQuoteDebtFee: 0n,
  };

  const discountedBaseDebtPrev = prevState.discountedBaseDebt;
  const discountedQuoteDebtPrev = prevState.discountedQuoteDebt;
  const discountedBaseCollateralPrev = prevState.discountedBaseCollateral;
  const discountedQuoteCollateralPrev = prevState.discountedQuoteCollateral;

  const interestRateX96 = (params.interestRate * FP96.one) / WHOLE_ONE;
  const feeX96 = (params.fee * FP96.one) / WHOLE_ONE;

  const onePlusFee = (feeX96 * FP96.one) / SECONDS_IN_YEAR_X96 + FP96.one;

  const feeDt = powTaylor(onePlusFee, secondsPassed);

  if (discountedBaseCollateralPrev != 0n) {
    const realBaseDebtPrev = (baseDebtCoeffPrev * discountedBaseDebtPrev) / FP96.one;
    const onePlusIRshort = (interestRateX96 * leverageShortX96) / SECONDS_IN_YEAR_X96 + FP96.one;
    const accruedRateDt = powTaylor(onePlusIRshort, secondsPassed);
    const baseDebtCoeffMul = (accruedRateDt * feeDt) / FP96.one;

    const baseCollateralCoeff =
      baseCollateralCoeffPrev +
      fp96FromRatio(((accruedRateDt - FP96.one) * realBaseDebtPrev) / FP96.one, discountedBaseCollateralPrev);
    const baseDebtCoeff = (baseDebtCoeffPrev * baseDebtCoeffMul) / FP96.one;

    const realBaseDebtFee = (((accruedRateDt * (feeDt - FP96.one)) / FP96.one) * realBaseDebtPrev) / FP96.one;

    result.discountedBaseDebtFee = (realBaseDebtFee * FP96.one) / baseCollateralCoeff;
    result.baseCollateralCoeff = baseCollateralCoeff;
    result.baseDebtCoeff = baseDebtCoeff;
  }

  if (discountedQuoteCollateralPrev != 0n) {
    const realQuoteDebtPrev = (quoteDebtCoeffPrev * discountedQuoteDebtPrev) / FP96.one;
    const onePlusIRLong = (interestRateX96 * leverageLongX96) / SECONDS_IN_YEAR_X96 + FP96.one;
    const accruedRateDt = powTaylor(onePlusIRLong, secondsPassed);
    const quoteDebtCoeffMul = (accruedRateDt * feeDt) / FP96.one;

    const quoteDebtCoeff = (quoteDebtCoeffPrev * quoteDebtCoeffMul) / FP96.one;

    const quoteCollateralCoeff =
      quoteCollateralCoeffPrev +
      fp96FromRatio(((accruedRateDt - FP96.one) * realQuoteDebtPrev) / FP96.one, discountedQuoteCollateralPrev);

    const realQuoteDebtFee = (((accruedRateDt * (feeDt - FP96.one)) / FP96.one) * realQuoteDebtPrev) / FP96.one;

    result.discountedQuoteDebtFee = (realQuoteDebtFee * FP96.one) / quoteCollateralCoeff;
    result.quoteDebtCoeff = quoteDebtCoeff;
    result.quoteCollateralCoeff = quoteCollateralCoeff;
  }

  return result;
}

export async function assertAccruedRateCoeffs(marginlyPool: MarginlyPool, prevState: MarginlyPoolState) {
  const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
  const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
  const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
  const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
  const techPosition = await marginlyPool.positions(TechnicalPositionOwner);

  const techPositionPrev = prevState.techPosition;
  const expectedCoeffs = await calcAccruedRateCoeffs(marginlyPool, prevState);

  expect(expectedCoeffs.baseDebtCoeff).to.be.eq(baseDebtCoeff);
  expect(expectedCoeffs.quoteDebtCoeff).to.be.eq(quoteDebtCoeff);
  expect(expectedCoeffs.quoteCollateralCoeff).to.be.eq(quoteCollateralCoeff);
  expect(expectedCoeffs.baseCollateralCoeff).to.be.eq(baseCollateralCoeff);
  expect(techPositionPrev.discountedBaseAmount + expectedCoeffs.discountedBaseDebtFee).to.be.eq(
    techPosition.discountedBaseAmount
  );
  expect(techPositionPrev.discountedQuoteAmount + expectedCoeffs.discountedQuoteDebtFee).to.be.eq(
    techPosition.discountedQuoteAmount
  );
}

export function uniswapV3Swapdata() {
  return 0;
}

type MarginlyPoolState = {
  baseDebtCoeff: bigint;
  quoteDebtCoeff: bigint;
  quoteCollateralCoeff: bigint;
  baseCollateralCoeff: bigint;
  techPosition: [bigint, bigint, bigint, bigint] & {
    _type: bigint;
    heapPosition: bigint;
    discountedBaseAmount: bigint;
    discountedQuoteAmount: bigint;
  };
  params: {
    maxLeverage: bigint;
    interestRate: bigint;
    fee: bigint;
    swapFee: bigint;
    mcSlippage: bigint;
    positionMinAmount: bigint;
    quoteLimit: bigint;
  };
  systemLeverage: [bigint, bigint] & { shortX96: bigint; longX96: bigint };
  lastReinitTimestampSeconds: bigint;
  discountedBaseDebt: bigint;
  discountedQuoteDebt: bigint;
  discountedBaseCollateral: bigint;
  discountedQuoteCollateral: bigint;
};

export async function getMarginlyPoolState(marginlyPool: MarginlyPool): Promise<MarginlyPoolState> {
  const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
  const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
  const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
  const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
  const techPosition = await marginlyPool.positions(TechnicalPositionOwner);
  const lastReinitTimestampSeconds = await marginlyPool.lastReinitTimestampSeconds();
  const systemLeverage = await marginlyPool.systemLeverage();
  const params = await marginlyPool.params();
  const discountedBaseDebt = await marginlyPool.discountedBaseDebt();
  const discountedQuoteDebt = await marginlyPool.discountedQuoteDebt();
  const discountedBaseCollateral = await marginlyPool.discountedBaseCollateral();
  const discountedQuoteCollateral = await marginlyPool.discountedQuoteCollateral();

  return {
    baseDebtCoeff,
    quoteDebtCoeff,
    quoteCollateralCoeff,
    baseCollateralCoeff,
    techPosition,
    params,
    systemLeverage,
    lastReinitTimestampSeconds,
    discountedBaseDebt,
    discountedQuoteDebt,
    discountedBaseCollateral,
    discountedQuoteCollateral,
  };
}
