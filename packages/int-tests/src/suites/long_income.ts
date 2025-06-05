import assert = require('assert');
import { formatUnits, parseUnits, ZeroAddress } from 'ethers';
import { SystemUnderTest } from '.';
import { logger } from '../utils/logger';
import { CallType, decodeSwapEvent, uniswapV3Swapdata } from '../utils/chain-ops';
import { FP96, toHumanString } from '../utils/fixed-point';
import { changeWethPrice } from '../utils/uniswap-ops';

export async function longIncome(sut: SystemUnderTest) {
  logger.info(`Starting longIncome test suite`);
  const { marginlyPool, treasury, usdc, weth, accounts, provider, uniswap, gasReporter } = sut;

  const numberOfLenders = 2;
  const lenders = accounts.slice(0, numberOfLenders);
  const quoteAmount = parseUnits('1000000', 6); // 1_000_000 USDC

  logger.info(`Deposit quote and base`);
  for (let i = 0; i < lenders.length; i++) {
    await (await usdc.connect(treasury).transfer(lenders[i].address, quoteAmount)).wait();
    await (await usdc.connect(lenders[i]).approve(marginlyPool, quoteAmount)).wait();

    await gasReporter.saveGasUsage(
      'depositQuote',
      marginlyPool
        .connect(lenders[i])
        .execute(CallType.DepositQuote, quoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        })
    );
  }

  const wethPriceX96 = (await marginlyPool.getBasePrice()).inner * 10n ** 12n;

  logger.info(`Weth price = ${toHumanString(wethPriceX96)}`);

  const borrower = accounts[numberOfLenders];
  const initialBorrBaseBalance = parseUnits('1', 18); // 1 WETH
  logger.info(`borrower initial deposit: ${formatUnits(initialBorrBaseBalance, 18)} WETH`);

  await (await weth.connect(treasury).transfer(borrower.address, initialBorrBaseBalance)).wait();
  await (await weth.connect(borrower).approve(marginlyPool, initialBorrBaseBalance)).wait();

  await gasReporter.saveGasUsage(
    'depositBase',
    marginlyPool
      .connect(borrower)
      .execute(CallType.DepositBase, initialBorrBaseBalance, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      })
  );

  // we are checking nothing here since it's basically long test with extra step
  const longAmount = parseUnits('5', 18);
  logger.info(`Open ${formatUnits(longAmount, 18)} WETH long position`);

  const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
  await gasReporter.saveGasUsage(
    'long',
    marginlyPool
      .connect(borrower)
      .execute(CallType.Long, longAmount, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 1_500_000,
      })
  );

  logger.info(`Increasing WETH price by ~10%`);
  await changeWethPrice(treasury, provider.provider, sut, (wethPriceX96 * 11n) / 10n / FP96.one);

  const shiftInDays = 10;
  logger.info(`Shift date by ${shiftInDays} days`);
  // shift time
  const numOfSeconds = shiftInDays * 24 * 60 * 60;
  await provider.mineAtTimestamp(Number(await marginlyPool.lastReinitTimestampSeconds()) + numOfSeconds);

  logger.info(`reinit`);
  const reinitReceipt = await gasReporter.saveGasUsage(
    'reinit',
    await marginlyPool
      .connect(treasury)
      .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 1_000_000 })
  );
  logger.info(`reinit executed`);
  const marginCallEvent = reinitReceipt.events?.find((e) => e.event == 'EnactMarginCall');
  if (marginCallEvent) {
    const error = `MC happened, try reducing time shift`;
    logger.error(error);
    throw new Error(error);
  }

  const positionBefore = await marginlyPool.positions(borrower.address);
  const positionDiscountedBaseAmountBefore = positionBefore.discountedBaseAmount;
  const discountedBaseCollBefore = await marginlyPool.discountedBaseCollateral();

  logger.info(`Closing position`);
  const minPrice = (await marginlyPool.getBasePrice()).inner / 2n;
  const closePosReceipt = await gasReporter.saveGasUsage(
    'closePosition',
    await marginlyPool
      .connect(borrower)
      .execute(CallType.ClosePosition, 0, 0, minPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 1_000_000,
      })
  );
  const closePosSwapEvent = decodeSwapEvent(closePosReceipt, uniswap.address);
  const swapAmount = closePosSwapEvent.amount1;
  logger.info(`swapAmount: ${formatUnits(swapAmount, 18)} WETH`);
  logger.info(`discountedBaseCollateral: ${formatUnits(await marginlyPool.discountedBaseCollateral(), 18)} WETH`);
  logger.info(`discountedQuoteDebt: ${formatUnits(await marginlyPool.discountedQuoteDebt(), 6)} USDC`);

  const collCoeff = await marginlyPool.baseCollateralCoeff();
  const positionAfter = await marginlyPool.positions(borrower.address);
  const positionDiscountedBaseAmountAfter = positionAfter.discountedBaseAmount;
  const expectedPosDiscountedBaseAmount = positionDiscountedBaseAmountBefore - (swapAmount * FP96.one) / collCoeff;

  logger.info(`position.discountedBaseAmount: ${formatUnits(positionAfter.discountedBaseAmount, 18)} ETH`);
  assert.deepEqual(expectedPosDiscountedBaseAmount, positionDiscountedBaseAmountAfter, 'pos.discountedBaseAmount');

  const positionRealBaseAmount = (positionAfter.discountedBaseAmount * collCoeff) / FP96.one;
  logger.info(`position real base amount: ${formatUnits(positionRealBaseAmount, 18)} ETH`);

  const positionDiscountedQuoteAmountAfter = positionAfter.discountedQuoteAmount;
  assert.deepEqual(0, positionDiscountedQuoteAmountAfter, 'pos.discountedQuoteAmount');

  const discountedBaseCollAfter = await marginlyPool.discountedBaseCollateral();
  const expectedDiscountedBaseColl = discountedBaseCollBefore - (swapAmount * FP96.one) / collCoeff;
  assert.deepEqual(expectedDiscountedBaseColl, discountedBaseCollAfter, 'discountedBaseCollateral');

  const discountedQuoteDebt = await marginlyPool.discountedQuoteDebt();
  assert.deepEqual(discountedQuoteDebt, 0, 'discountedQuoteDebt');

  const moneyBefore = +formatUnits((initialBorrBaseBalance * wethPriceX96) / FP96.one, 18);
  const price = (await marginlyPool.getBasePrice()).inner;
  const moneyAfter = +formatUnits((positionRealBaseAmount * price) / FP96.one, 6);
  logger.info(`WETH initial deposit * initial price:   ${moneyBefore}`);
  logger.info(`WETH after closing pos * current price: ${moneyAfter}`);
  const delta = moneyAfter - moneyBefore;
  logger.info(`Position income/loss: ${delta}`);
}
