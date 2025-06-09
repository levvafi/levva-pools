import { logger } from '../utils/logger';
import { SECS_PER_BLOCK } from './const';
import { AbiCoder, Addressable, BrowserProvider, ContractTransactionReceipt, EventLog, Provider } from 'ethers';
import { FP96, powTaylor } from './fixed-point';
import { TechnicalPositionOwner } from '../suites';
import { MarginlyPool } from '../../../contracts/typechain-types';

export const PositionType = {
  Uninitialized: 0n,
  Lend: 1n,
  Short: 2n,
  Long: 3n,
};

export const Dex = {
  UniswapV3: 0n,
  ApeSwap: 1n,
  Balancer: 2n,
  Camelot: 3n,
  KyberClassicSwap: 4n,
  KyberElasticSwap: 5n,
  QuickSwap: 6n,
  SushiSwap: 7n,
  TraderJoe: 8n,
  Woofi: 9n,
  Ramses: 10n,
  DodoV1: 11n,
  DodoV2: 12n,
};

export const SWAP_ONE = 1n << 15n;

export function uniswapV3Swapdata() {
  return 0;
}

export function constructSwap(dex: bigint[], ratios: bigint[]): bigint {
  if (dex.length != ratios.length) {
    throw new Error(`dex and ratios arrays length are different`);
  }

  let swap = 0n;
  for (let i = 0; i < dex.length; ++i) {
    swap = (((swap << 6n) + dex[i]) << 16n) + ratios[i];
  }
  swap = (swap << 4n) + BigInt(dex.length);
  return swap;
}

export async function waitBlocks(blocks: number): Promise<void> {
  logger.info(`Waiting for ${blocks} blocks`);
  return await new Promise((rs) => setTimeout(rs, blocks * SECS_PER_BLOCK * 1000.0));
}

export class BrowserProviderDecorator {
  readonly provider: BrowserProvider;

  constructor(provider: BrowserProvider) {
    this.provider = provider;
  }

  mineAtTimestamp(timestampSeconds: number): Promise<any> {
    return this.provider.send('evm_mine', [timestampSeconds]);
  }

  async getLastBlockTimestamp(): Promise<number> {
    const latestBlock = await this.provider.getBlock(await this.provider.getBlockNumber());
    if (latestBlock === null) {
      throw new Error('Failed to obtain latest block');
    }
    return latestBlock.timestamp;
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
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
};

export function decodeSwapEvent(
  txReceipt: ContractTransactionReceipt,
  uniswapAddress: string | Addressable
): SwapEvent {
  const swapEvent = txReceipt.logs
    ?.filter((x) => x instanceof EventLog)
    .find((e) => e.address == uniswapAddress.toString());
  const swapEventTypes = ['int256', 'int256', 'uint160', 'uint128', 'int24'];
  const result = AbiCoder.defaultAbiCoder().decode(swapEventTypes, swapEvent!.data);

  return {
    amount0: result[0],
    amount1: result[1],
    sqrtPriceX96: result[2],
    liquidity: result[3],
    tick: result[4],
  };
}

export async function getLongSortKeyX48(marginlyPool: MarginlyPool, accountAddress: string): Promise<bigint> {
  const position = await marginlyPool.positions(accountAddress);
  const index = position.heapPosition - 1n;
  logger.debug(`  heap position is ${position.heapPosition}`);
  const [, leverage] = await marginlyPool.getHeapPosition(index, false);
  return leverage.key;
}

export async function getShortSortKeyX48(marginlyPool: MarginlyPool, accountAddress: string): Promise<bigint> {
  const position = await marginlyPool.positions(accountAddress);
  const index = position.heapPosition - 1n;
  logger.debug(`  heap position is ${position.heapPosition}`);
  const [, leverage] = await marginlyPool.getHeapPosition(index, true);
  return leverage.key;
}

export const WHOLE_ONE = 10n ** 6n;
export const SECONDS_IN_YEAR_X96 = BigInt(365.25 * 24 * 60 * 60) * FP96.one;

function mulFp96(firstX96: bigint, secondX96: bigint): bigint {
  return (firstX96 * secondX96) / FP96.one;
}

function divFp96(nomX96: bigint, denomX96: bigint): bigint {
  return (nomX96 * FP96.one) / denomX96;
}

function fp96FromRatio(nom: bigint, denom: bigint): bigint {
  return (nom * FP96.one) / denom;
}

/// Same as accrueInterest in smart contract
export async function calcAccruedRateCoeffs(
  marginlyPool: MarginlyPool,
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
  const secondsPassed = lastReinitTimestamp - lastReinitOnPrevBlock;

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

  if (secondsPassed === 0n) {
    return result;
  }

  const discountedBaseDebtPrev = await marginlyPool.discountedBaseDebt(callOpt);
  const discountedQuoteDebtPrev = await marginlyPool.discountedQuoteDebt(callOpt);
  const discountedBaseCollateralPrev = await marginlyPool.discountedBaseCollateral(callOpt);
  const discountedQuoteCollateralPrev = await marginlyPool.discountedQuoteCollateral(callOpt);

  const interestRateX96 = (params.interestRate * FP96.one) / WHOLE_ONE;
  const feeX96 = (params.fee * FP96.one) / WHOLE_ONE;

  const onePlusFee = (feeX96 * FP96.one) / SECONDS_IN_YEAR_X96 + FP96.one;
  const feeDt = powTaylor(onePlusFee, secondsPassed);

  if (discountedBaseCollateralPrev != 0n) {
    const realBaseDebtPrev = (baseDebtCoeffPrev * discountedBaseDebtPrev) / FP96.one;
    const onePlusIRshort = (interestRateX96 * leverageShortX96) / SECONDS_IN_YEAR_X96 + FP96.one;
    const accruedRateDt = powTaylor(onePlusIRshort, secondsPassed);
    const realBaseCollateral = (baseCollateralCoeffPrev * discountedBaseCollateralPrev) / FP96.one;
    const factor =
      FP96.one + fp96FromRatio(((accruedRateDt - FP96.one) * realBaseDebtPrev) / FP96.one, realBaseCollateral);
    const baseCollateralCoeff = (baseCollateralCoeffPrev * factor) / FP96.one;
    const baseDelevCoeff = baseDelevCoeffPrev * factor;
    const baseDebtCoeff = (((baseDebtCoeffPrev * accruedRateDt) / FP96.one) * feeDt) / FP96.one;

    const realBaseDebtFee = (((accruedRateDt * (feeDt - FP96.one)) / FP96.one) * realBaseDebtPrev) / FP96.one;

    result.discountedBaseDebtFee = (realBaseDebtFee * FP96.one) / baseCollateralCoeff;
    result.baseCollateralCoeff = baseCollateralCoeff;
    result.baseDebtCoeff = baseDebtCoeff;
    result.baseDelevCoeff = baseDelevCoeff;
  }

  if (discountedQuoteCollateralPrev != 0n) {
    const realQuoteDebtPrev = (quoteDebtCoeffPrev * discountedQuoteDebtPrev) / FP96.one;
    const onePlusIRLong = (interestRateX96 * leverageLongX96) / SECONDS_IN_YEAR_X96 + FP96.one;
    const accruedRateDt = powTaylor(onePlusIRLong, secondsPassed);
    const quoteDebtCoeff = (((quoteDebtCoeffPrev * accruedRateDt) / FP96.one) * feeDt) / FP96.one;
    const realQuoteCollateral = (quoteCollateralCoeffPrev * discountedQuoteCollateralPrev) / FP96.one;
    const factor =
      FP96.one + fp96FromRatio(((accruedRateDt - FP96.one) * realQuoteDebtPrev) / FP96.one, realQuoteCollateral);
    const quoteCollateralCoeff = (quoteCollateralCoeffPrev * factor) / FP96.one;
    const quoteDelevCoeff = (quoteDelevCoeffPrev * factor) / FP96.one;

    const realQuoteDebtFee = (((accruedRateDt * (feeDt - FP96.one)) / FP96.one) * realQuoteDebtPrev) / FP96.one;

    result.discountedQuoteDebtFee = (realQuoteDebtFee * FP96.one) / quoteCollateralCoeff;
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
  marginlyPool: MarginlyPool,
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

  if (expectedCoeffs.baseDebtCoeff != baseDebtCoeff) {
    throw new Error(`baseDebtCoeff coeff differs ${expectedCoeffs.baseDebtCoeff} and ${baseDebtCoeff}`);
  }
  if (expectedCoeffs.quoteDebtCoeff != quoteDebtCoeff) {
    throw new Error(`quoteDebtCoeff coeff differs ${expectedCoeffs.quoteDebtCoeff} and ${quoteDebtCoeff}`);
  }
  if (expectedCoeffs.quoteCollateralCoeff != quoteCollateralCoeff) {
    throw new Error(
      `quoteCollateralCoeff coeff differs ${expectedCoeffs.quoteCollateralCoeff} and ${quoteCollateralCoeff}`
    );
  }
  if (expectedCoeffs.baseCollateralCoeff != baseCollateralCoeff) {
    throw new Error(
      `baseCollateralCoeff coeff differs ${expectedCoeffs.baseCollateralCoeff} and ${baseCollateralCoeff}`
    );
  }

  if (expectedCoeffs.quoteDelevCoeff != quoteDelevCoeff) {
    throw new Error(`quoteDelevCoeff coeff differs ${expectedCoeffs.quoteDelevCoeff} and ${quoteDelevCoeff}`);
  }
  if (expectedCoeffs.baseDelevCoeff != baseDelevCoeff) {
    throw new Error(`baseDelevCoeff coeff differs ${expectedCoeffs.baseDelevCoeff} and ${baseDelevCoeff}`);
  }

  if (
    technicalPosition.discountedBaseAmount !=
    technicalPositionPrev.discountedBaseAmount + expectedCoeffs.discountedBaseDebtFee
  ) {
    throw new Error(
      `technicalPosition.discountedBaseAmount ${technicalPosition.discountedBaseAmount} doesn't equal prev value ${technicalPositionPrev.discountedBaseAmount} plus fee ${expectedCoeffs.discountedBaseDebtFee}`
    );
  }

  if (
    technicalPosition.discountedQuoteAmount !=
    technicalPositionPrev.discountedQuoteAmount + expectedCoeffs.discountedQuoteDebtFee
  ) {
    throw new Error(
      `technicalPosition.discountedQuoteAmount ${technicalPosition.discountedQuoteAmount} doesn't equal prev value ${technicalPositionPrev.discountedQuoteAmount} plus fee ${expectedCoeffs.discountedQuoteDebtFee}`
    );
  }

  return expectedCoeffs;
}
