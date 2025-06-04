import { logger } from '../utils/logger';
import { SECS_PER_BLOCK } from './const';
import { Web3Provider } from '@ethersproject/providers';
import { MarginlyPoolContract } from '../contract-api/MarginlyPool';
import { BigNumber, ethers, ContractReceipt } from 'ethers';
import { FP96, powTaylor } from './fixed-point';
import { TechnicalPositionOwner } from '../suites';
import { defaultAbiCoder } from 'ethers'

export const PositionType = {
  Uninitialized: 0,
  Lend: 1,
  Short: 2,
  Long: 3,
};

export const Dex = {
  UniswapV3: 0,
  ApeSwap: 1,
  Balancer: 2,
  Camelot: 3,
  KyberClassicSwap: 4,
  KyberElasticSwap: 5,
  QuickSwap: 6,
  SushiSwap: 7,
  TraderJoe: 8,
  Woofi: 9,
  Ramses: 10,
  DodoV1: 11,
  DodoV2: 12,
};

export const SWAP_ONE = 1 << 15;

export function uniswapV3Swapdata() {
  return 0;
}

export function constructSwap(dex: number[], ratios: number[]): BigNumber {
  if (dex.length != ratios.length) {
    throw new Error(`dex and ratios arrays length are different`);
  }

  let swap = BigInt(0);
  for (let i = 0; i < dex.length; ++i) {
    swap = (((swap << BigInt(6)) + BigInt(dex[i])) << BigInt(16)) + BigInt(ratios[i]);
  }
  swap = (swap << BigInt(4)) + BigInt(dex.length);
  return BigNumber.from(swap);
}

export async function waitBlocks(blocks: number): Promise<void> {
  logger.info(`Waiting for ${blocks} blocks`);
  return await new Promise((rs) => setTimeout(rs, blocks * SECS_PER_BLOCK * 1000.0));
}

export class Web3ProviderDecorator {
  readonly provider: Web3Provider;

  constructor(provider: Web3Provider) {
    this.provider = provider;
  }

  mineAtTimestamp(timestampSeconds: number): Promise<any> {
    return this.provider.send('evm_mine', [timestampSeconds]);
  }

  async getLastBlockTimestamp(): Promise<number> {
    return (await this.provider.getBlock(this.provider._lastBlockNumber)).timestamp;
  }
}

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

export type SwapEvent = {
  amount0: BigNumber;
  amount1: BigNumber;
  sqrtPriceX96: BigNumber;
  liquidity: BigNumber;
  tick: number;
};

export function decodeSwapEvent(txReceipt: ContractReceipt, uniswapAddress: string): SwapEvent {
  const swapEvent = txReceipt.events!.find((e) => e.address == uniswapAddress);
  const swapEventTypes = ['int256', 'int256', 'uint160', 'uint128', 'int24'];
  const result = ethers.utils.defaultAbiCoder.decode(swapEventTypes, swapEvent!.data);

  return {
    amount0: BigNumber.from(result[0]),
    amount1: BigNumber.from(result[1]),
    sqrtPriceX96: BigNumber.from(result[2]),
    liquidity: BigNumber.from(result[3]),
    tick: result[4],
  };
}

export async function getLongSortKeyX48(
  marginlyPool: MarginlyPoolContract,
  accountAddress: string
): Promise<BigNumber> {
  const position = await marginlyPool.positions(accountAddress);
  const index = BigNumber.from(position.heapPosition)-(1);
  logger.debug(`  heap position is ${position.heapPosition}`);
  const [, leverage] = await marginlyPool.getHeapPosition(index, false);
  return BigNumber.from(leverage.key);
}

export async function getShortSortKeyX48(
  marginlyPool: MarginlyPoolContract,
  accountAddress: string
): Promise<BigNumber> {
  const position = await marginlyPool.positions(accountAddress);
  const index = BigNumber.from(position.heapPosition)-(1);
  logger.debug(`  heap position is ${position.heapPosition}`);
  const [, leverage] = await marginlyPool.getHeapPosition(index, true);
  return BigNumber.from(leverage.key);
}

export const WHOLE_ONE = 1e6;
export const SECONDS_IN_YEAR_X96 = BigNumber.from(365.25 * 24 * 60 * 60)*(FP96.one);

function mulFp96(firstX96: BigNumber, secondX96: BigNumber): BigNumber {
  return firstX96*(secondX96)/(FP96.one);
}

function divFp96(nomX96: BigNumber, denomX96: BigNumber): BigNumber {
  return nomX96*(FP96.one)/(denomX96);
}

function fp96FromRatio(nom: BigNumber, denom: BigNumber): BigNumber {
  return nom*(FP96.one)/(denom);
}

/// Same as accrueInterest in smart contract
export async function calcAccruedRateCoeffs(
  marginlyPool: MarginlyPoolContract,
  prevBlockNumber: number,
  marginCallHappened = false
) {
  const callOpt = { blockTag: prevBlockNumber };

  const params = await marginlyPool.params(callOpt);
  const systemLeverage = await marginlyPool.systemLeverage(callOpt);
  const leverageShortX96 = systemLeverage.shortX96;
  const leverageLongX96 = systemLeverage.longX96;

  const lastReinitOnPrevBlock = await marginlyPool.lastReinitTimestampSeconds(callOpt);
  const lastReinitTimestamp = await marginlyPool.lastReinitTimestampSeconds();
  const secondsPassed = BigNumber.from(lastReinitTimestamp)-(lastReinitOnPrevBlock);

  const baseDebtCoeffPrev = await marginlyPool.baseDebtCoeff(callOpt);
  const quoteDebtCoeffPrev = await marginlyPool.quoteDebtCoeff(callOpt);
  const baseCollateralCoeffPrev = await marginlyPool.baseCollateralCoeff(callOpt);
  const quoteCollateralCoeffPrev = await marginlyPool.quoteCollateralCoeff(callOpt);
  const baseDelevCoeffPrev = await marginlyPool.baseDelevCoeff(callOpt);
  const quoteDelevCoeffPrev = await marginlyPool.quoteDelevCoeff(callOpt);

  const result = {
    baseDebtCoeff: baseDebtCoeffPrev,
    quoteDebtCoeff: quoteDebtCoeffPrev,
    baseCollateralCoeff: baseCollateralCoeffPrev,
    quoteCollateralCoeff: quoteCollateralCoeffPrev,
    baseDelevCoeff: baseDelevCoeffPrev,
    quoteDelevCoeff: quoteDelevCoeffPrev,
    discountedBaseDebtFee: 0n,
    discountedQuoteDebtFee: 0n,
  };

  if (+secondsPassed === 0) {
    return result;
  }

  const discountedBaseDebtPrev = await marginlyPool.discountedBaseDebt(callOpt);
  const discountedQuoteDebtPrev = await marginlyPool.discountedQuoteDebt(callOpt);
  const discountedBaseCollateralPrev = await marginlyPool.discountedBaseCollateral(callOpt);
  const discountedQuoteCollateralPrev = await marginlyPool.discountedQuoteCollateral(callOpt);

  const interestRateX96 = BigNumber.from(params.interestRate)*(FP96.one)/(WHOLE_ONE);
  const feeX96 = BigNumber.from(params.fee)*(FP96.one)/(WHOLE_ONE);

  const onePlusFee = feeX96*(FP96.one)/(SECONDS_IN_YEAR_X96).add(FP96.one);
  const feeDt = powTaylor(onePlusFee, +secondsPassed);

  if (!discountedBaseCollateralPrev.isZero()) {
    const realBaseDebtPrev = baseDebtCoeffPrev*(discountedBaseDebtPrev)/(FP96.one);
    const onePlusIRshort = interestRateX96*(leverageShortX96)/(SECONDS_IN_YEAR_X96).add(FP96.one);
    const accruedRateDt = powTaylor(onePlusIRshort, +secondsPassed);
    const realBaseCollateral = baseCollateralCoeffPrev*(discountedBaseCollateralPrev)/(FP96.one);
    const factor = FP96.one.add(
      fp96FromRatio(accruedRateDt-(FP96.one)*(realBaseDebtPrev)/(FP96.one), realBaseCollateral)
    );
    const baseCollateralCoeff = baseCollateralCoeffPrev*(factor)/(FP96.one);
    const baseDelevCoeff = baseDelevCoeffPrev*(factor);
    const baseDebtCoeff = baseDebtCoeffPrev*(accruedRateDt)/(FP96.one)*(feeDt)/(FP96.one);

    const realBaseDebtFee = accruedRateDt*(feeDt-(FP96.one))/(FP96.one)*(realBaseDebtPrev)/(FP96.one);

    result.discountedBaseDebtFee = realBaseDebtFee*(FP96.one)/(baseCollateralCoeff);
    result.baseCollateralCoeff = baseCollateralCoeff;
    result.baseDebtCoeff = baseDebtCoeff;
    result.baseDelevCoeff = baseDelevCoeff;
  }

  if (!discountedQuoteCollateralPrev.isZero()) {
    const realQuoteDebtPrev = quoteDebtCoeffPrev*(discountedQuoteDebtPrev)/(FP96.one);
    const onePlusIRLong = interestRateX96*(leverageLongX96)/(SECONDS_IN_YEAR_X96).add(FP96.one);
    const accruedRateDt = powTaylor(onePlusIRLong, +secondsPassed);
    const quoteDebtCoeff = quoteDebtCoeffPrev*(accruedRateDt)/(FP96.one)*(feeDt)/(FP96.one);
    const realQuoteCollateral = quoteCollateralCoeffPrev*(discountedQuoteCollateralPrev)/(FP96.one);
    const factor = FP96.one.add(
      fp96FromRatio(accruedRateDt-(FP96.one)*(realQuoteDebtPrev)/(FP96.one), realQuoteCollateral)
    );
    const quoteCollateralCoeff = quoteCollateralCoeffPrev*(factor)/(FP96.one);
    const quoteDelevCoeff = quoteDelevCoeffPrev*(factor)/(FP96.one);

    const realQuoteDebtFee = accruedRateDt*(feeDt-(FP96.one))/(FP96.one)*(realQuoteDebtPrev)/(FP96.one);

    result.discountedQuoteDebtFee = realQuoteDebtFee*(FP96.one)/(quoteCollateralCoeff);
    result.quoteDebtCoeff = quoteDebtCoeff;
    result.quoteCollateralCoeff = quoteCollateralCoeff;
    result.quoteDelevCoeff = quoteDelevCoeff;
  }

  //skip calculation of collateralCoeff on MC
  if (marginCallHappened) {
    result.quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
    result.baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
  }

  return result;
}

export async function assertAccruedRateCoeffs(
  marginlyPool: MarginlyPoolContract,
  prevBlockNumber: number,
  marginCallHappened = false
) {
  const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
  const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
  const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
  const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
  const quoteDelevCoeff = await marginlyPool.quoteDelevCoeff();
  const baseDelevCoeff = await marginlyPool.baseDelevCoeff();

  const technicalPosition = await marginlyPool.positions(TechnicalPositionOwner);
  const technicalPositionPrev = await marginlyPool.positions(TechnicalPositionOwner, { blockTag: prevBlockNumber });

  const expectedCoeffs = await calcAccruedRateCoeffs(marginlyPool, prevBlockNumber, marginCallHappened);

  if (!expectedCoeffs.baseDebtCoeff.eq(baseDebtCoeff)) {
    throw new Error(`baseDebtCoeff coeff differs ${expectedCoeffs.baseDebtCoeff} and ${baseDebtCoeff}`);
  }
  if (!expectedCoeffs.quoteDebtCoeff.eq(quoteDebtCoeff)) {
    throw new Error(`quoteDebtCoeff coeff differs ${expectedCoeffs.quoteDebtCoeff} and ${quoteDebtCoeff}`);
  }
  if (!expectedCoeffs.quoteCollateralCoeff.eq(quoteCollateralCoeff)) {
    throw new Error(
      `quoteCollateralCoeff coeff differs ${expectedCoeffs.quoteCollateralCoeff} and ${quoteCollateralCoeff}`
    );
  }
  if (!expectedCoeffs.baseCollateralCoeff.eq(baseCollateralCoeff)) {
    throw new Error(
      `baseCollateralCoeff coeff differs ${expectedCoeffs.baseCollateralCoeff} and ${baseCollateralCoeff}`
    );
  }

  if (!expectedCoeffs.quoteDelevCoeff.eq(quoteDelevCoeff)) {
    throw new Error(`quoteDelevCoeff coeff differs ${expectedCoeffs.quoteDelevCoeff} and ${quoteDelevCoeff}`);
  }
  if (!expectedCoeffs.baseDelevCoeff.eq(baseDelevCoeff)) {
    throw new Error(`baseDelevCoeff coeff differs ${expectedCoeffs.baseDelevCoeff} and ${baseDelevCoeff}`);
  }

  if (
    !technicalPosition.discountedBaseAmount.eq(
      technicalPositionPrev.discountedBaseAmount.add(expectedCoeffs.discountedBaseDebtFee)
    )
  ) {
    throw new Error(
      `technicalPosition.discountedBaseAmount ${technicalPosition.discountedBaseAmount} doesn't equal prev value ${technicalPositionPrev.discountedBaseAmount} plus fee ${expectedCoeffs.discountedBaseDebtFee}`
    );
  }

  if (
    !technicalPosition.discountedQuoteAmount.eq(
      technicalPositionPrev.discountedQuoteAmount.add(expectedCoeffs.discountedQuoteDebtFee)
    )
  ) {
    throw new Error(
      `technicalPosition.discountedQuoteAmount ${technicalPosition.discountedQuoteAmount} doesn't equal prev value ${technicalPositionPrev.discountedQuoteAmount} plus fee ${expectedCoeffs.discountedQuoteDebtFee}`
    );
  }

  return expectedCoeffs;
}
