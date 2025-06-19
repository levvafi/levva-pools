import assert from 'assert';
import { EventLog, formatUnits, parseUnits, ZeroAddress } from 'ethers';
import { initializeTestSystem, SystemUnderTest } from '.';
import {
  getLongSortKeyX48,
  decodeSwapEvent,
  CallType,
  assertAccruedRateCoeffs,
  uniswapV3Swapdata,
  WHOLE_ONE,
} from '../utils/chain-ops';
import { abs, fp48ToHumanString, FP96, toHumanString } from '../utils/fixed-point';
import { showSystemAggregates } from '../utils/log-utils';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Long', () => {
  it('Long', async () => {
    const sut = await loadFixture(initializeTestSystem);
    await long(sut);
    sut.logger.flush();
  });
});

async function long(sut: SystemUnderTest) {
  const { marginlyPool, marginlyFactory, treasury, usdc, weth, accounts, uniswap, gasReporter, logger } = sut;
  logger.info(`Starting long test suite`);

  const lenders = accounts.slice(0, 20); // 2 lenders
  const quoteAmount = parseUnits('1000000', 6); // 1_000_000 USDC
  const expectedRealQuoteBalance = quoteAmount * BigInt(lenders.length);
  const baseAmount = parseUnits('20', 18); // 10 WETH

  logger.info(`Deposit quote and base`);
  for (let i = 0; i < lenders.length; i++) {
    await (await usdc.connect(treasury).transfer(lenders[i].address, quoteAmount)).wait();
    await (await usdc.connect(lenders[i]).approve(marginlyPool, quoteAmount)).wait();

    await (await weth.connect(treasury).transfer(lenders[i].address, baseAmount)).wait();
    await (await weth.connect(lenders[i]).approve(marginlyPool, baseAmount)).wait();

    await gasReporter.saveGasUsage(
      'depositQuote',
      await marginlyPool
        .connect(lenders[i])
        .execute(CallType.DepositQuote, quoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        })
    );
    await gasReporter.saveGasUsage(
      'depositBase',
      marginlyPool
        .connect(lenders[i])
        .execute(CallType.DepositBase, baseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        })
    );
  }

  const realQuoteBalance = await usdc.balanceOf(marginlyPool);
  logger.info(`RealQuoteBalance is: ${formatUnits(realQuoteBalance, 6)} USDC`);
  assert.deepEqual(expectedRealQuoteBalance, realQuoteBalance, 'realQuoteBalance');

  const params = await marginlyPool.params();
  const maxLeverageX96 = params.maxLeverage * FP96.one;
  const swapFeeX96 = (params.swapFee * FP96.one) / WHOLE_ONE;
  const wethPriceX96 = (await marginlyPool.getBasePrice()).inner;
  const feeHolder = await marginlyFactory.feeHolder();

  logger.info(`MaxLeverage = ${maxLeverageX96 / 2n ** 96n}`);
  logger.info(`SwapFeeX96 = ${toHumanString(swapFeeX96)}`);
  logger.info(`Weth price = ${toHumanString(wethPriceX96 * 10n ** 12n)}`);

  //prepare base depositors
  const borrowers = accounts.slice(20, 40);
  const initialBorrBaseBalance = parseUnits('2', 18); // 2 WETH
  const expectedRealBaseBalance =
    initialBorrBaseBalance * BigInt(borrowers.length) + baseAmount * BigInt(lenders.length);

  for (let i = 0; i < borrowers.length; i++) {
    await (await weth.connect(treasury).transfer(borrowers[i].address, initialBorrBaseBalance)).wait();
    await (await weth.connect(borrowers[i]).approve(marginlyPool, initialBorrBaseBalance)).wait();

    await gasReporter.saveGasUsage(
      'depositBase',
      await marginlyPool
        .connect(borrowers[i])
        .execute(CallType.DepositBase, initialBorrBaseBalance, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        })
    );
    const position = await marginlyPool.positions(borrowers[i].address);
    assert.deepEqual(initialBorrBaseBalance, position.discountedBaseAmount);
  }

  const realBaseBalance = await weth.balanceOf(marginlyPool);
  assert.equal(expectedRealBaseBalance, realBaseBalance);

  logger.info(`RealBaseBalance: ${formatUnits(realBaseBalance, 18)} WETH`);

  logger.info(`Open long positions and check coeffs:`);
  for (let i = 0; i < borrowers.length; i++) {
    const longAmount = parseUnits('8', 18) + parseUnits('0.5', 18) * BigInt(i); // 8 + (0.25*(i+1)) WETH

    logger.info(`\n`);
    logger.info(`${i + 1}) long for account ${borrowers[i].address}`);

    const discountedBaseCollateralBefore = await marginlyPool.discountedBaseCollateral();
    const discountedBaseDebtBefore = await marginlyPool.discountedBaseDebt();
    const discountedQuoteCollateralBefore = await marginlyPool.discountedQuoteCollateral();
    const discountedQuoteDebtBefore = await marginlyPool.discountedQuoteDebt();
    const feeHolderBalanceBefore = await usdc.balanceOf(feeHolder);
    const positionBefore = await marginlyPool.positions(borrowers[i].address);
    const realQuoteBalanceBefore = await usdc.balanceOf(marginlyPool);
    const realBaseBalanceBefore = await weth.balanceOf(marginlyPool);
    const prevBlockNumber = await treasury.provider.getBlockNumber();
    logger.info(`Before long transaction`);
    const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
    const txReceipt = await marginlyPool
      .connect(borrowers[i])
      .execute(CallType.Long, longAmount, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 1_900_000,
      });
    const receipt = await gasReporter.saveGasUsage('long', txReceipt);
    const swapEvent = decodeSwapEvent(receipt, uniswap.target);
    //check position

    //check coefficients
    const discountedBaseCollateral = await marginlyPool.discountedBaseCollateral();
    const discountedBaseDebt = await marginlyPool.discountedBaseDebt();
    const discountedQuoteCollateral = await marginlyPool.discountedQuoteCollateral();
    const discountedQuoteDebt = await marginlyPool.discountedQuoteDebt();
    const feeHolderBalance = await usdc.balanceOf(feeHolder);
    const position = await marginlyPool.positions(borrowers[i].address);
    const realQuoteBalance = await usdc.balanceOf(marginlyPool);
    const sortKeyX48 = await getLongSortKeyX48(marginlyPool, borrowers[i].address, logger);
    const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
    const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
    const realBaseBalance = await weth.balanceOf(marginlyPool);

    const expectedCoeffs = await assertAccruedRateCoeffs(marginlyPool, prevBlockNumber);
    logger.info(` SortKeyX48 is ${sortKeyX48}`);

    //fee
    const expectedFee = (swapEvent.amount0 * swapFeeX96) / FP96.one;
    const fee = feeHolderBalance - feeHolderBalanceBefore;
    assert.deepEqual(fee, expectedFee);
    logger.info(` fee charged ${formatUnits(fee, 6)} USDC`);

    //swap
    const realQuoteAmount = swapEvent.amount0;
    logger.info(
      ` Uniswap: QuoteIn ${formatUnits(realQuoteAmount, 6)} USDC, BaseOut: ${formatUnits(longAmount, 18)} WETH`
    );

    //discountedBaseCollateral
    const expectedDiscountedBaseCollateralChange = (longAmount * FP96.one) / baseCollateralCoeff;
    logger.info(` DiscountedBaseCollateral change ${expectedDiscountedBaseCollateralChange}`);
    assert.deepEqual(
      positionBefore.discountedBaseAmount + expectedDiscountedBaseCollateralChange,
      position.discountedBaseAmount,
      'position.discountedBaseAmount'
    );
    assert.deepEqual(
      discountedBaseCollateralBefore + expectedDiscountedBaseCollateralChange,
      discountedBaseCollateral,
      'discountedBaseCollateral'
    );

    //discountedBaseDebt
    assert.deepEqual(discountedBaseDebtBefore, discountedBaseDebt);

    //discountedQuoteDebt
    const expectedDiscountedDebtChange = ((realQuoteAmount + fee) * FP96.one) / quoteDebtCoeff;
    const actualDiscountedDebtChange = discountedQuoteDebt - discountedQuoteDebtBefore;
    logger.info(` expected DiscountedDebtChange ${expectedDiscountedDebtChange}`);
    logger.info(` actual DiscountedDebtChange ${actualDiscountedDebtChange}`);

    const expectedPositionDiscountedQuoteDebt = positionBefore.discountedQuoteAmount + expectedDiscountedDebtChange;
    if (expectedPositionDiscountedQuoteDebt - position.discountedQuoteAmount != 0n) {
      throw `wrong position.discountedQuoteAmount: expected: ${expectedPositionDiscountedQuoteDebt} actual: ${position.discountedQuoteAmount}`;
    }

    const expectedDiscountedDebt = discountedQuoteDebtBefore + expectedDiscountedDebtChange;
    if (expectedDiscountedDebt - discountedQuoteDebt != 0n) {
      throw `wrong discountedQuoteDebt: expected: ${expectedDiscountedDebt} actual: ${discountedQuoteDebt}`;
    }

    // position type should be changed
    if (positionBefore._type == 1n) {
      //Lend -> Long
      assert.deepEqual(position._type, 3n, 'position type');
    } else {
      // Long
      assert.deepEqual(position._type, positionBefore._type, 'position type');
    }

    const actualQuoteDebtFee = discountedQuoteCollateral - discountedQuoteCollateralBefore;

    // discountedQuoteCollateral
    assert.deepEqual(actualQuoteDebtFee, expectedCoeffs.discountedQuoteDebtFee);

    //realQuoteBalance
    const expectedRealQuoteBalanceChange = fee + realQuoteAmount;
    const realQuoteBalanceChange = realQuoteBalance - realQuoteBalanceBefore;
    logger.info(` RealQuoteBalance change ${formatUnits(realQuoteBalanceChange, 6)} USDC`);
    assert.deepEqual(realQuoteBalanceBefore, realQuoteBalance + expectedRealQuoteBalanceChange);

    //realBaseBalance
    const expectedRealBaseBalanceChange = longAmount;
    const realBaseBalanceChange = realBaseBalance - realBaseBalanceBefore;
    logger.info(` RealBaseBalance change ${formatUnits(realBaseBalanceChange, 18)} WETH`);
    assert.deepEqual(realBaseBalanceBefore + expectedRealBaseBalanceChange, realBaseBalance);
  }

  assert.notEqual(await marginlyPool.discountedQuoteDebt(), 0n);

  logger.info(`Shift date for 1 year, 1 day per iteration`);
  // shift time to 1 year
  const numOfSeconds = 24n * 60n * 60n; // 1 day
  let nextDate = await marginlyPool.lastReinitTimestampSeconds();
  for (let i = 0; i < 365; i++) {
    const prevBlockNumber = await treasury.provider.getBlockNumber();
    nextDate += numOfSeconds;
    await time.setNextBlockTimestamp(nextDate);

    const quoteCollateralCoeffBefore = await marginlyPool.quoteCollateralCoeff();
    const quoteDebtCoeffBefore = await marginlyPool.quoteDebtCoeff();

    //reinit tx
    const txReceipt = await marginlyPool
      .connect(treasury)
      .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 });
    const receipt = await gasReporter.saveGasUsage('reinit', txReceipt);

    const marginCallEvent = receipt.logs
      ?.filter((e) => e instanceof EventLog)
      .find((e) => e.eventName == 'EnactMarginCall');
    if (marginCallEvent) {
      logger.info(`\n`);
      logger.warn(`Margin call happened at day ${i} (${nextDate} time)`);
      logger.warn(` mc account: ${marginCallEvent.args![0]}`);
    }

    const expectedCoeffs = await assertAccruedRateCoeffs(marginlyPool, prevBlockNumber, !!marginCallEvent);

    //check coefficients
    const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
    const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
    const discountedQuoteDebt = await marginlyPool.discountedQuoteDebt();
    const discountedQuoteCollateral = await marginlyPool.discountedQuoteCollateral();

    if (!marginCallEvent) {
      const quoteDebtDelta = ((quoteDebtCoeff - quoteDebtCoeffBefore) * discountedQuoteDebt) / FP96.one;

      const quoteCollatDelta =
        ((quoteCollateralCoeff - quoteCollateralCoeffBefore) * discountedQuoteCollateral) / FP96.one;

      const realDebtFee = (expectedCoeffs.discountedQuoteDebtFee * quoteCollateralCoeff) / FP96.one;

      // quote collateral change + debt fee == quote debt change
      const epsilon = 300n;
      const delta = abs(quoteDebtDelta - quoteCollatDelta - realDebtFee);
      if (delta >= epsilon) {
        logger.warn(`quoteDebtDelta: ${formatUnits(quoteDebtDelta, 6)} USDC`);
        logger.warn(`quoteCollatDelta: ${formatUnits(quoteCollatDelta, 6)} USDC`);
        logger.warn(`quoteDebtFee: ${formatUnits(expectedCoeffs.discountedQuoteDebtFee, 6)} USDC`);
        logger.error(`delta is ${formatUnits(delta, 6)} they must be equal`);
      }
      // assert.deepEqual(quoteDebtDelta, quoteCollatDelta);
    }
  }

  const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
  const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
  const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();

  //check lender positions
  logger.info(`Check lenders after reinit`);
  for (let i = 0; i < lenders.length; i++) {
    logger.info(`\n`);
    logger.info(`${i + 1}) lender ${lenders[i].address}`);
    const position = await marginlyPool.positions(lenders[i].address);

    const discountedQuoteAmount = position.discountedQuoteAmount;
    const realQuoteAmount = (quoteCollateralCoeff * discountedQuoteAmount) / FP96.one;

    logger.info(` Deposit ${formatUnits(quoteAmount, 6)} USDC, current ${formatUnits(realQuoteAmount, 6)} USDC`);
  }

  logger.info(`Check borrowers after reinit`);
  for (let i = 0; i < borrowers.length; i++) {
    logger.info(`\n`);
    logger.info(`${i + 1}) borrower ${borrowers[i].address}`);
    const position = await marginlyPool.positions(borrowers[i].address);
    logger.info(` position type ${position._type}`);
    if (position._type == 0n) {
      logger.info(` position not exists`);
      continue;
    }

    const sortKeyX48 = await getLongSortKeyX48(marginlyPool, borrowers[i].address, logger);

    const realBaseAmount = (baseCollateralCoeff * position.discountedBaseAmount) / FP96.one;
    const realQuoteAmount = (quoteDebtCoeff * position.discountedQuoteAmount) / FP96.one;

    logger.info(` sortKey ${fp48ToHumanString(sortKeyX48)}`);
    logger.info(` sortKeyX48 ${sortKeyX48}`);
    logger.info(` collateral ${formatUnits(realBaseAmount, 18)} WETH, debt ${formatUnits(realQuoteAmount, 6)} USDC`);
  }

  await showSystemAggregates(sut);
}
