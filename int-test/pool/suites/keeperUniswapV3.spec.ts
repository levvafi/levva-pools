import { formatUnits, parseUnits, ZeroAddress } from 'ethers';
import { initializeTestSystem, SystemUnderTest } from '.';
import { CallType, uniswapV3Swapdata } from '../utils/chain-ops';
import { encodeLiquidationParams } from '../utils/marginly-keeper';
import { LevvaTradingPool } from '../../../typechain-types';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { FP96 } from '../utils/fixed-point';
import { Logger } from 'pino';

describe('KeeperUniswapV3', () => {
  it('KeeperUniswapV3', async () => {
    const sut = await loadFixture(initializeTestSystem);
    await keeperUniswapV3(sut);
    sut.logger.flush();
  });
});

type PoolCoeffs = {
  baseCollateralCoeffX96: bigint;
  baseDebtCoeffX96: bigint;
  quoteCollateralCoeffX96: bigint;
  quoteDebtCoeffX96: bigint;
};

//To generate swapCallData use script here https://dotnetfiddle.net/zAmYaP
const keeperSwapCallData = 7864321n;

async function getDebtAmount(
  marginlyPool: LevvaTradingPool,
  positionAddress: string,
  basePriceX96: bigint,
  poolCoeffs: PoolCoeffs,
  logger: Logger
): Promise<bigint> {
  const Fp96One = 2n ** 96n;
  const position = await marginlyPool.positions(positionAddress);

  if (position._type == 2n) {
    const debt = (position.discountedBaseAmount * poolCoeffs.baseDebtCoeffX96) / Fp96One;
    const debtInQuote = (debt * basePriceX96) / Fp96One;
    const collateral = (position.discountedQuoteAmount * poolCoeffs.quoteCollateralCoeffX96) / Fp96One;

    const leverage = collateral / (collateral - debtInQuote);
    logger.info(`Position ${positionAddress} leverage is ${leverage}`);
    return debt;
  } else if (position._type == 3n) {
    const debt = (position.discountedQuoteAmount * poolCoeffs.quoteDebtCoeffX96) / Fp96One;
    const collateral = (position.discountedBaseAmount * poolCoeffs.baseCollateralCoeffX96) / Fp96One;
    const collateralInQuote = (collateral * basePriceX96) / Fp96One;

    const leverage = collateralInQuote / (collateralInQuote - debt);
    logger.info(`Position ${positionAddress} leverage is ${leverage}`);
    return debt;
  } else {
    throw Error('Wrong position type');
  }
}

async function keeperUniswapV3(sut: SystemUnderTest) {
  const { marginlyPool, keeperUniswapV3, treasury, usdc, weth, accounts, uniswap, gasReporter, logger } = sut;

  logger.info(`Starting keeper liquidation test suite`);
  const ethArgs = { gasLimit: 1_000_000 };

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
    const shortAmount = (17n * quoteAmount * FP96.one) / (await marginlyPool.getBasePrice()).inner;
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
    const newParams = {
      maxLeverage: 15n,
      interestRate: params.interestRate,
      fee: params.fee,
      swapFee: params.swapFee,
      mcSlippage: params.mcSlippage,
      positionMinAmount: params.positionMinAmount,
      quoteLimit: params.quoteLimit,
    };
    await (await marginlyPool.connect(treasury).setParameters(newParams)).wait();
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

  logger.info(`Max leverage is ${maxLeverage}`);

  const poolCoeffs: PoolCoeffs = {
    baseCollateralCoeffX96: baseCollateralCoeff,
    baseDebtCoeffX96: baseDebtCoeff,
    quoteCollateralCoeffX96: quoteCollateralCoeff,
    quoteDebtCoeffX96: quoteDebtCoeff,
  };

  // get 1% more than calculated debt value
  const longerDebtAmount =
    ((await getDebtAmount(marginlyPool, longer.address, basePriceX96, poolCoeffs, logger)) * 101n) / 100n;
  const shorterDebtAmount =
    ((await getDebtAmount(marginlyPool, shorter.address, basePriceX96, poolCoeffs, logger)) * 101n) / 100n;

  const liquidator = accounts[4];

  let balanceBefore = await usdc.balanceOf(liquidator);

  {
    const [amount0, amount1] =
      (await uniswap.token0()) == (await usdc.getAddress()) ? [longerDebtAmount, 0] : [0, longerDebtAmount];
    const liquidationParams = encodeLiquidationParams(
      usdc.target,
      longerDebtAmount,
      marginlyPool.target,
      longer.address,
      liquidator.address,
      uniswap.target,
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
  logger.info(`Profit after long position liquidation is ${profit} USDC`);

  balanceBefore = await weth.balanceOf(liquidator);
  {
    const [amount0, amount1] =
      (await uniswap.token0()) == (await weth.getAddress()) ? [shorterDebtAmount, 0] : [0, shorterDebtAmount];
    const liquidationParams = encodeLiquidationParams(
      weth.target,
      shorterDebtAmount,
      marginlyPool.target,
      shorter.address,
      liquidator.address,
      uniswap.target,
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
  logger.info(`Profit after short position liquidation is ${profit} WETH`);
}
