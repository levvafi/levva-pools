import { expect } from 'chai';
import { createCurveCaseCrvUsdUsdc, createCurveCaseFrxEthWeth, CurveOracleCaseParams } from '../../shared/fixtures';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { oneX96 } from '../pendle/common';
import { formatEther } from 'ethers';

async function fetchCurvePrices(
  params: CurveOracleCaseParams,
  blockTag?: number
): Promise<{
  actualBalancePrice: bigint;
  actualMargincallPrice: bigint;
  expectedBalancePrice: bigint;
  expectedMargincallPrice: bigint;
}> {
  const multiplier = 10n ** (18n + params.baseToken.decimals - params.quoteToken.decimals);

  let actualBalancePrice =
    ((await params.oracle.getBalancePrice(params.quoteToken.address, params.baseToken.address, { blockTag })) *
      multiplier) /
    oneX96;

  const actualMargincallPrice =
    ((await params.oracle.getMargincallPrice(params.quoteToken.address, params.baseToken.address, { blockTag })) *
      multiplier) /
    oneX96;

  let expectedBalancePrice: bigint;

  if (params.priceOracleMethodHasArg) {
    expectedBalancePrice = await params.pool['price_oracle(uint256)'](0, { blockTag });
  } else {
    expectedBalancePrice = await params.pool['price_oracle()']({ blockTag });
  }

  if (!params.isToken0QuoteToken) {
    const one = 10n ** 18n;
    expectedBalancePrice = (one * one) / expectedBalancePrice;
  }

  return {
    actualBalancePrice,
    actualMargincallPrice,
    expectedBalancePrice,
    expectedMargincallPrice: expectedBalancePrice,
  };
}

export function printCurvePrices(actualPrice: bigint, expectedPrice: bigint, caseParams: CurveOracleCaseParams) {
  const priceDelta = actualPrice - expectedPrice;
  console.log(
    `  Expected price: 1.0 ${caseParams.baseToken.symbol} = ${formatEther(expectedPrice)} ${
      caseParams.quoteToken.symbol
    }`
  );
  console.log(
    `  Actual price:   1.0 ${caseParams.baseToken.symbol} = ${formatEther(actualPrice)} ${caseParams.quoteToken.symbol}`
  );
  console.log(`  Delta: ${formatEther(priceDelta)}`);
}

describe('CurveOracle', () => {
  it('frxETH/WETH: without arg in method', async () => {
    const caseParams = await loadFixture(createCurveCaseFrxEthWeth);

    const { actualBalancePrice, actualMargincallPrice, expectedBalancePrice, expectedMargincallPrice } =
      await fetchCurvePrices(caseParams);

    console.log(`\nBalance price:`);
    printCurvePrices(actualBalancePrice, expectedBalancePrice, caseParams);
    console.log(`\nMargincall price:`);
    printCurvePrices(actualMargincallPrice, expectedMargincallPrice, caseParams);

    expect(actualBalancePrice).to.be.closeTo(expectedBalancePrice, 1000n);
    expect(actualMargincallPrice).to.be.closeTo(expectedMargincallPrice, 1000n);
  });

  it('crvUSD/USDC: with arg in method', async () => {
    const caseParams = await loadFixture(createCurveCaseCrvUsdUsdc);

    const { actualBalancePrice, actualMargincallPrice, expectedBalancePrice, expectedMargincallPrice } =
      await fetchCurvePrices(caseParams);

    console.log(`\nBalance price:`);
    printCurvePrices(actualBalancePrice, expectedBalancePrice, caseParams);
    console.log(`\nMargincall price:`);
    printCurvePrices(actualMargincallPrice, expectedMargincallPrice, caseParams);

    expect(actualBalancePrice).to.be.closeTo(expectedBalancePrice, 1000n);
    expect(actualMargincallPrice).to.be.closeTo(expectedMargincallPrice, 1000n);
  });
});
