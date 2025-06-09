import assert = require('assert');
import { EventLog, formatUnits, parseUnits, ZeroAddress } from 'ethers';
import { initializeTestSystem, SystemUnderTest } from '.';
import { logger } from '../utils/logger';
import { CallType, decodeSwapEvent, uniswapV3Swapdata, WHOLE_ONE } from '../utils/chain-ops';
import { FP96, toHumanString } from '../utils/fixed-point';
import { changeWethPrice } from '../utils/uniswap-ops';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Short income', () => {
  it('Short income', async () => {
    const sut = await loadFixture(initializeTestSystem);
    await shortIncome(sut);
  });
});

async function shortIncome(sut: SystemUnderTest) {
  logger.info(`Starting shortIncome test suite`);
  const { marginlyPool, treasury, usdc, weth, accounts, uniswap, gasReporter } = sut;

  const swapFeeX96 = ((await marginlyPool.params()).swapFee * FP96.one) / WHOLE_ONE;
  logger.info(`swapFee: ${toHumanString(swapFeeX96)}`);

  const numberOfLenders = 2;
  const lenders = accounts.slice(0, numberOfLenders);
  const baseAmount = parseUnits('20', 18); // 20 WETH

  logger.info(`Deposit quote and base`);
  for (let i = 0; i < lenders.length; i++) {
    await (await weth.connect(treasury).transfer(lenders[i], baseAmount)).wait();
    await (await weth.connect(lenders[i]).approve(marginlyPool, baseAmount)).wait();

    await gasReporter.saveGasUsage(
      'depositBase',
      marginlyPool
        .connect(lenders[i])
        .execute(CallType.DepositBase, baseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        })
    );
  }

  const wethPriceX96 = (await marginlyPool.getBasePrice()).inner * 10n ** 12n;

  logger.info(`Weth price = ${toHumanString(wethPriceX96)}`);

  const borrower = accounts[numberOfLenders];
  const initialBorrQuoteBalance =
    (1_000_000n * // 1 WETH is USDC
      wethPriceX96) /
    FP96.one;
  logger.info(`borrower initial deposit: ${formatUnits(initialBorrQuoteBalance, 6)} USDC`);

  await (await usdc.connect(treasury).transfer(borrower, initialBorrQuoteBalance)).wait();
  await (await usdc.connect(borrower).approve(marginlyPool, initialBorrQuoteBalance)).wait();

  await gasReporter.saveGasUsage(
    'depositQuote',
    marginlyPool
      .connect(borrower)
      .execute(CallType.DepositQuote, initialBorrQuoteBalance, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      })
  );

  // we are checking nothing here since it's basically short test with extra step
  const shortAmount = parseUnits('5', 18);
  logger.info(`Open ${formatUnits(shortAmount, 18)} WETH short position`);

  const minPrice = (await marginlyPool.getBasePrice()).inner / 2n;
  await gasReporter.saveGasUsage(
    'short',
    marginlyPool
      .connect(borrower)
      .execute(CallType.Short, shortAmount, 0, minPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 1_500_000,
      })
  );

  logger.info(`Decreasing WETH price by ~10%`);
  await changeWethPrice(treasury, sut, (wethPriceX96 * 9n) / 10n / FP96.one);

  const shiftInDays = 10;
  logger.info(`Shift date by ${shiftInDays} days`);
  // shift time
  const numOfSeconds = shiftInDays * 24 * 60 * 60;
  await time.setNextBlockTimestamp(Number(await marginlyPool.lastReinitTimestampSeconds()) + numOfSeconds);

  logger.info(`reinit`);
  const reinitReceipt = await gasReporter.saveGasUsage(
    'reinit',
    marginlyPool
      .connect(treasury)
      .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 1_000_000 })
  );
  logger.info(`reinit executed`);
  const marginCallEvent = reinitReceipt.logs
    ?.filter((e) => e instanceof EventLog)
    .find((e) => e.eventName == 'EnactMarginCall');
  if (marginCallEvent) {
    const error = `MC happened, try reducing time shift`;
    logger.error(error);
    throw new Error(error);
  }

  const positionBefore = await marginlyPool.positions(borrower);
  const positionDiscountedQuoteAmountBefore = positionBefore.discountedQuoteAmount;
  const discountedQuoteCollBefore = await marginlyPool.discountedQuoteCollateral();

  logger.info(`Closing position`);
  const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
  const closePosReceipt = await gasReporter.saveGasUsage(
    'closePosition',
    marginlyPool
      .connect(borrower)
      .execute(CallType.ClosePosition, 0, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 1_000_000,
      })
  );
  const closePosSwapEvent = decodeSwapEvent(closePosReceipt, uniswap.target);
  const swapAmount = closePosSwapEvent.amount0;
  logger.info(`swapAmount: ${formatUnits(swapAmount, 6)} USDC`);
  const fee = (swapFeeX96 * swapAmount) / FP96.one;
  logger.info(`fee: ${formatUnits(fee, 6)}`);

  logger.info(`discountedBaseDebt: ${formatUnits(await marginlyPool.discountedBaseDebt(), 18)} WETH`);
  logger.info(`discountedQuoteCollateral: ${formatUnits(await marginlyPool.discountedQuoteCollateral(), 6)} USDC`);

  const positionAfter = await marginlyPool.positions(borrower.address);
  const positionDiscountedBaseAmountAfter = positionAfter.discountedBaseAmount;

  logger.info(`position.discountedBaseAmount: ${formatUnits(positionAfter.discountedBaseAmount, 18)} ETH`);
  assert.deepEqual(0, positionDiscountedBaseAmountAfter, 'pos.discountedBaseAmount');

  const collCoeff = await marginlyPool.quoteCollateralCoeff();
  const positionDiscountedQuoteAmountAfter = positionAfter.discountedQuoteAmount;
  const expectedPosDiscountedQuoteAmount =
    ((positionDiscountedQuoteAmountBefore - swapAmount + fee) * FP96.one) / collCoeff;
  logger.info(`position.discountedQuoteAmount: ${formatUnits(positionDiscountedQuoteAmountAfter, 6)}`);
  assert.deepEqual(expectedPosDiscountedQuoteAmount, positionDiscountedQuoteAmountAfter, 'pos.discountedQuoteAmount');

  const positionRealQuoteAmount = (positionAfter.discountedQuoteAmount * collCoeff) / FP96.one;
  logger.info(`position real quote amount: ${formatUnits(positionRealQuoteAmount, 6)} USDC`);

  const discountedQuoteCollAfter = await marginlyPool.discountedQuoteCollateral();
  const expectedDiscountedQuoteColl = discountedQuoteCollBefore - ((swapAmount + fee) * FP96.one) / collCoeff;
  assert.deepEqual(expectedDiscountedQuoteColl, discountedQuoteCollAfter, 'discountedQuoteCollateral');

  const discountedBaseDebt = await marginlyPool.discountedBaseDebt();
  assert.deepEqual(discountedBaseDebt, 0, 'discountedBaseDebt');

  const moneyBefore = +formatUnits(initialBorrQuoteBalance, 6);
  const moneyAfter = +formatUnits(positionRealQuoteAmount, 6);
  logger.info(`USDC initial deposit:   ${moneyBefore}`);
  logger.info(`USDC after closing pos: ${moneyAfter}`);
  const delta = moneyAfter - moneyBefore;
  logger.info(`Position income/loss: ${delta} USDC`);
}
