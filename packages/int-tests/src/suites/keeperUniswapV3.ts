import { formatUnits, parseUnits, ZeroAddress } from 'ethers';
import { SystemUnderTest } from '.';
import { CallType, uniswapV3Swapdata } from '../utils/chain-ops';
import { logger } from '../utils/logger';
import { encodeLiquidationParams } from '@marginly/common';
import { MarginlyPool } from '../../../contracts/typechain-types';

type PoolCoeffs = {
  baseCollateralCoeffX96: bigint;
  baseDebtCoeffX96: bigint;
  quoteCollateralCoeffX96: bigint;
  quoteDebtCoeffX96: bigint;
};

//To generate swapCallData use script here https://dotnetfiddle.net/zAmYaP
const balancerSwapCallData = 2621441;
const sushiSwapSwapCallData = 7864321;
const dodoV1SwapCallData = 12058625;
const dodoV2SwapCallData = 13107201;
const kyberClassicSwapCallData = 4718593;

const keeperSwapCallData = sushiSwapSwapCallData;

async function getDebtAmount(
  marginlyPool: MarginlyPool,
  positionAddress: string,
  basePriceX96: bigint,
  poolCoeffs: PoolCoeffs
): Promise<bigint> {
  const Fp96One = 2n ** 96n;
  const position = await marginlyPool.positions(positionAddress);

  if (position._type == 2n) {
    const debt = (position.discountedBaseAmount * poolCoeffs.baseDebtCoeffX96) / Fp96One;
    const debtInQuote = (debt * basePriceX96) / Fp96One;
    const collateral = (position.discountedQuoteAmount * poolCoeffs.quoteCollateralCoeffX96) / Fp96One;

    const leverage = collateral / (collateral - debtInQuote);
    console.log(`Position ${positionAddress} leverage is ${leverage}`);
    return debt;
  } else if (position._type == 3n) {
    const debt = (position.discountedQuoteAmount * poolCoeffs.quoteDebtCoeffX96) / Fp96One;
    const collateral = (position.discountedBaseAmount * poolCoeffs.baseCollateralCoeffX96) / Fp96One;
    const collateralInQuote = (collateral * basePriceX96) / Fp96One;

    const leverage = collateralInQuote / (collateralInQuote - debt);
    console.log(`Position ${positionAddress} leverage is ${leverage}`);
    return debt;
  } else {
    throw Error('Wrong position type');
  }
}

export async function keeperUniswapV3(sut: SystemUnderTest) {
  logger.info(`Starting keeper liquidation test suite`);
  const ethArgs = { gasLimit: 1_000_000 };

  const { marginlyPool, keeperUniswapV3, treasury, usdc, weth, accounts, provider, uniswap, gasReporter } = sut;

  const lender = accounts[0];
  logger.info(`Deposit lender account`);
  {
    const quoteAmount = parseUnits('1000000', 6); // 1_000_000 USDC
    const baseAmount = parseUnits('20', 18); // 20 WETH

    await (await usdc.connect(treasury).transfer(lender, quoteAmount)).wait();
    await (await usdc.connect(lender).approve(marginlyPool, quoteAmount)).wait();

    await (await weth.connect(treasury).transfer(lender, baseAmount)).wait();
    await (await weth.connect(lender).approve(marginlyPool, baseAmount)).wait();

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, baseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), ethArgs);
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, quoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), ethArgs);
  }

  const longer = accounts[1];
  logger.info(`Deposit longer account`);
  {
    const baseAmount = parseUnits('1', 18); // 0.1 WETH
    const longAmount = parseUnits('17', 18); //1.7 WETH

    await (await weth.connect(treasury).transfer(longer, baseAmount)).wait();
    await (await weth.connect(longer).approve(marginlyPool, baseAmount)).wait();

    await (
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, baseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), ethArgs)
    ).wait();
    const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
    await (
      await marginlyPool
        .connect(longer)
        .execute(CallType.Long, longAmount, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), ethArgs)
    ).wait();
  }

  logger.info(`Deposit shorter account`);
  const shorter = accounts[2];
  {
    const quoteAmount = parseUnits('200', 6); // 200 USDC
    const shortAmount = parseUnits('1.7', 18); // 1.7 WETH
    await (await usdc.connect(treasury).transfer(shorter, quoteAmount)).wait();
    await (await usdc.connect(shorter).approve(marginlyPool, quoteAmount)).wait();

    await (
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositQuote, quoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), ethArgs)
    ).wait();
    const minPrice = (await marginlyPool.getBasePrice()).inner / 2n;
    await (
      await marginlyPool
        .connect(shorter)
        .execute(CallType.Short, shortAmount, 0, minPrice, false, ZeroAddress, uniswapV3Swapdata(), ethArgs)
    ).wait();
  }

  // Set parameters.maxLeverage to leverage 15
  {
    const params = await marginlyPool.params();
    await (await marginlyPool.connect(treasury).setParameters({ ...params, maxLeverage: 15 })).wait();
  }

  const [basePrice, params, baseCollateralCoeff, baseDebtCoeff, quoteCollateralCoeff, quoteDebtCoeff]: [
    any,
    any,
    bigint,
    bigint,
    bigint,
    bigint,
  ] = await Promise.all([
    marginlyPool.getBasePrice(),
    marginlyPool.params(),
    marginlyPool.baseCollateralCoeff(),
    marginlyPool.baseDebtCoeff(),
    marginlyPool.quoteCollateralCoeff(),
    marginlyPool.quoteDebtCoeff(),
  ]);

  const basePriceX96 = basePrice.inner;
  const maxLeverage = params.maxLeverage;

  console.log(`Max leverage is ${maxLeverage}`);

  const poolCoeffs: PoolCoeffs = {
    baseCollateralCoeffX96: baseCollateralCoeff,
    baseDebtCoeffX96: baseDebtCoeff,
    quoteCollateralCoeffX96: quoteCollateralCoeff,
    quoteDebtCoeffX96: quoteDebtCoeff,
  };

  // get 1% more than calculated debt value
  const longerDebtAmount =
    ((await getDebtAmount(marginlyPool, longer.address, basePriceX96, poolCoeffs)) * 101n) / 100n;
  const shorterDebtAmount =
    ((await getDebtAmount(marginlyPool, shorter.address, basePriceX96, poolCoeffs)) * 101n) / 100n;

  const liquidator = accounts[4];

  let balanceBefore = await usdc.balanceOf(liquidator);

  {
    const [amount0, amount1] = (await uniswap.token0()) == usdc.address ? [longerDebtAmount, 0] : [0, longerDebtAmount];
    const liquidationParams = encodeLiquidationParams(
      usdc.address,
      longerDebtAmount,
      marginlyPool.address,
      longer.address,
      liquidator.address,
      uniswap.address,
      0n,
      keeperSwapCallData
    );

    await gasReporter.saveGasUsage(
      'keeperUniswapV3.liquidatePosition',
      keeperUniswapV3.connect(liquidator).liquidatePosition(uniswap, amount0, amount1, liquidationParams, {
        gasLimit: 1_000_000,
      })
    );
  }

  let balanceAfter = await usdc.balanceOf(liquidator);

  let profit = formatUnits(balanceAfter - balanceBefore, await usdc.decimals());
  console.log(`Profit after long position liquidation is ${profit} USDC`);

  balanceBefore = await weth.balanceOf(liquidator);
  {
    const [amount0, amount1] =
      (await uniswap.token0()) == weth.address ? [shorterDebtAmount, 0] : [0, shorterDebtAmount];
    const liquidationParams = encodeLiquidationParams(
      weth.address,
      shorterDebtAmount,
      marginlyPool.address,
      shorter.address,
      liquidator.address,
      uniswap.address,
      0n,
      keeperSwapCallData
    );

    await gasReporter.saveGasUsage(
      'keeper.liquidatePosition',
      keeperUniswapV3.connect(liquidator).liquidatePosition(uniswap, amount0, amount1, liquidationParams, {
        gasLimit: 1_000_000,
      })
    );
  }

  balanceAfter = await weth.balanceOf(liquidator);
  profit = formatUnits(balanceAfter - balanceBefore, await weth.decimals());
  console.log(`Profit after short position liquidation is ${profit} WETH`);
}
