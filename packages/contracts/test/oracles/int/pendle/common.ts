import { formatEther } from 'ethers';
import { PendleOracleCaseParams } from '../../shared/fixtures';

export const oneX96 = 2n ** 96n;
export const one = 10n ** 18n;

export function printPendleTokenSymbols(caseParams: PendleOracleCaseParams) {
  console.log(`\n\nTokens names:`);
  console.log(`  PT  = ${caseParams.pt.symbol}`);
  console.log(`  SY  = ${caseParams.sy.symbol}`);
  console.log(`  YQT = ${caseParams.yqt.symbol}`);
  console.log(`  QT  = ${caseParams.qt.symbol}`);
}

export function printPendlePrices(
  actualPrice: bigint,
  priceFromPendlePtLpOracle: bigint,
  priceFromSecondaryOracle: bigint,
  expectedPrice: bigint
) {
  const priceDelta = actualPrice - expectedPrice;
  console.log(`  Price from PendlePtLpOracle: 1.0 PT  = ${formatEther(priceFromPendlePtLpOracle)} SY`);
  console.log(`  Price from SecondaryOracle:  1.0 YQT = ${formatEther(priceFromSecondaryOracle)} QT`);
  console.log(`  Final expected price:        1.0 PT  = ${formatEther(expectedPrice)} QT`);
  console.log(`  Actual price from oracle:    1.0 PT  = ${formatEther(actualPrice)} QT`);
  console.log(`  Delta: ${formatEther(priceDelta)}`);
}

export async function fetchPendlePrices(
  params: PendleOracleCaseParams,
  blockTag?: number
): Promise<{
  actualBalancePrice: bigint;
  actualMargincallPrice: bigint;
  balancePtToSyPrice: bigint;
  margincallPtToSyPrice: bigint;
  balancePriceFromSecondaryOracle: bigint;
  margincallPriceFromSecondaryOracle: bigint;
}> {
  const actualBalancePrice =
    ((await params.oracle.getBalancePrice(params.qt.address, params.pt.address, { blockTag })) * one) / oneX96;
  const actualMargincallPrice =
    ((await params.oracle.getMargincallPrice(params.qt.address, params.pt.address, { blockTag })) * one) / oneX96;
  const balancePtToSyPrice = await params.pendlePtLpOracle.getPtToSyRate(params.pendleMarket, params.secondsAgo, {
    blockTag,
  });
  const margincallPtToSyPrice = await params.pendlePtLpOracle.getPtToSyRate(
    params.pendleMarket,
    params.secondsAgoLiquidation,
    { blockTag }
  );
  const balancePriceFromSecondaryOracle =
    ((await params.secondaryPoolOracle.getBalancePrice(params.qt.address, params.yqt.address, { blockTag })) * one) /
    oneX96;
  const margincallPriceFromSecondaryOracle =
    ((await params.secondaryPoolOracle.getMargincallPrice(params.qt.address, params.yqt.address, { blockTag })) * one) /
    oneX96;

  return {
    actualBalancePrice,
    actualMargincallPrice,
    balancePtToSyPrice,
    balancePriceFromSecondaryOracle,
    margincallPtToSyPrice,
    margincallPriceFromSecondaryOracle,
  };
}
