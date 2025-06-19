import { createMarginlyPool } from './shared/fixtures';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  calcAccruedRateCoeffs,
  calcLeverageLong,
  calcLeverageShort,
  CallType,
  FP96,
  uniswapV3Swapdata,
  getMarginlyPoolState,
} from './shared/utils';
import { ZeroAddress } from 'ethers';

describe('MarginlyPool.Liquidation', () => {
  it('should revert when existing position trying to make liquidation', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [_, shorter, depositor] = await ethers.getSigners();

    const price = (await marginlyPool.getBasePrice()).inner;

    const amountToDeposit = 100;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const quoteAmount = 2000;
    const baseAmount = 1000;
    await expect(
      marginlyPool
        .connect(depositor)
        .execute(CallType.ReceivePosition, quoteAmount, baseAmount, price, false, shorter.address, uniswapV3Swapdata())
    ).to.be.revertedWithCustomError(marginlyPool, 'PositionInitialized');
  });

  it('should revert when position to liquidation not exists', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [_, shorter, depositor, receiver] = await ethers.getSigners();

    const price = (await marginlyPool.getBasePrice()).inner;

    const amountToDeposit = 100;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const quoteAmount = 2000;
    const baseAmount = 1000;
    await expect(
      marginlyPool
        .connect(receiver)
        .execute(CallType.ReceivePosition, quoteAmount, baseAmount, price, false, shorter.address, uniswapV3Swapdata())
    ).to.be.revertedWithCustomError(marginlyPool, 'NotLiquidatable');
  });

  it('should revert when position to liquidation not liquidatable', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [_, shorter, depositor, receiver] = await ethers.getSigners();

    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 20000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const shorterCollateral = 100;
    const shortAmount = 5000; // leverage 19.9
    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, shorterCollateral, shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    const quoteAmount = 0;
    const baseAmount = 7700; // the sum is enough to cover debt + accruedInterest
    await expect(
      marginlyPool
        .connect(receiver)
        .execute(CallType.ReceivePosition, quoteAmount, baseAmount, price, false, shorter.address, uniswapV3Swapdata())
    ).to.be.revertedWithCustomError(marginlyPool, 'NotLiquidatable');
  });

  it('should revert when new position after liquidation of short will have bad margin', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [_, shorter, depositor, receiver] = await ethers.getSigners();

    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 40000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const shorterCollateral = 100;
    const shortAmount = 7500;
    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, shorterCollateral, shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    //wait for accrue interest
    const timeShift = 20 * 24 * 60 * 60;
    await time.increase(timeShift);

    const quoteAmount = 0;
    const baseAmount = 10;
    await expect(
      marginlyPool
        .connect(receiver)
        .execute(CallType.ReceivePosition, quoteAmount, baseAmount, price, false, shorter.address, uniswapV3Swapdata())
    ).to.be.revertedWithCustomError(marginlyPool, 'BadLeverage');
  });

  it('should revert when new position after liquidation of long will have bad margin', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [_, longer, depositor, receiver] = await ethers.getSigners();

    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 40000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollateral = 100;
    const longAmount = 1900;
    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, baseCollateral, longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    //wait for accrue interest
    const timeShift = 60 * 24 * 60 * 60;
    await time.increase(timeShift);

    const quoteAmount = 1;
    const baseAmount = 0;
    await expect(
      marginlyPool
        .connect(receiver)
        .execute(CallType.ReceivePosition, quoteAmount, baseAmount, price, false, longer.address, uniswapV3Swapdata())
    ).to.be.revertedWithCustomError(marginlyPool, 'BadLeverage');
  });

  it('should create new position without debt after short liquidation', async () => {
    const {
      marginlyPool,
      uniswapPoolInfo: { token0, token1 },
    } = await loadFixture(createMarginlyPool);
    const [_, shorter, depositor, receiver] = await ethers.getSigners();

    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 20000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const shorterCollateral = 100;
    const shortAmount = 7500;
    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, shorterCollateral, shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    const beforeLiquidationPosition = await marginlyPool.positions(shorter.address);
    const beforeDiscountedBaseCollateral = await marginlyPool.discountedBaseCollateral();
    const beforeDiscountedQuoteCollateral = await marginlyPool.discountedQuoteCollateral();
    const basePrice = await marginlyPool.getBasePrice();
    const token0BalanceBefore = await token0.balanceOf(marginlyPool);
    const token1BalanceBefore = await token1.balanceOf(marginlyPool);
    const prevState = await getMarginlyPoolState(marginlyPool);

    //wait for accrue interest
    const timeShift = 20 * 24 * 60 * 60;
    await time.increase(timeShift);

    const quoteAmount = 356n;
    const baseAmount = 7700n; // the sum is enough to cover debt + accruedInterest
    await marginlyPool
      .connect(receiver)
      .execute(CallType.ReceivePosition, quoteAmount, baseAmount, price, false, shorter.address, uniswapV3Swapdata());

    const expectedCoeffs = await calcAccruedRateCoeffs(marginlyPool, prevState);

    const liquidatedPosition = await marginlyPool.positions(shorter.address);
    expect(liquidatedPosition._type).to.be.equal(0);
    expect(liquidatedPosition.discountedBaseAmount).to.be.equal(0);
    expect(liquidatedPosition.discountedQuoteAmount).to.be.equal(0);

    const newPosition = await marginlyPool.positions(receiver.address);
    const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
    const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
    const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();

    expect(newPosition._type).to.be.equal(1); // Lend position
    expect(newPosition.heapPosition).to.be.equal(0);
    const expectedDiscountedQuoteAmountDelta = (quoteAmount * FP96.one) / quoteCollateralCoeff;
    expect(newPosition.discountedQuoteAmount).to.be.equal(
      beforeLiquidationPosition.discountedQuoteAmount + expectedDiscountedQuoteAmountDelta
    );

    const expectedDiscountedBaseAmount =
      ((baseAmount - (beforeLiquidationPosition.discountedBaseAmount * baseDebtCoeff) / FP96.one - 1n) * FP96.one) /
      baseCollateralCoeff;
    expect(newPosition.discountedBaseAmount).to.be.equal(expectedDiscountedBaseAmount);

    //assert aggregates
    expect(await marginlyPool.discountedBaseDebt()).to.be.equal(0);
    expect(await marginlyPool.discountedQuoteDebt()).to.be.equal(0);

    expect(await marginlyPool.discountedBaseDebt()).to.be.equal(0);
    expect(await marginlyPool.discountedQuoteDebt()).to.be.equal(0);
    expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(
      beforeDiscountedBaseCollateral + newPosition.discountedBaseAmount + expectedCoeffs.discountedBaseDebtFee
    );
    expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(
      beforeDiscountedQuoteCollateral + expectedDiscountedQuoteAmountDelta
    );

    const expectedLongLeverageX96 = calcLeverageLong(
      basePrice.inner,
      await marginlyPool.quoteDebtCoeff(),
      await marginlyPool.baseCollateralCoeff(),
      await marginlyPool.discountedQuoteDebt(),
      await marginlyPool.discountedBaseCollateral()
    );
    expect(await marginlyPool.longLeverageX96()).to.be.equal(expectedLongLeverageX96);

    const expectedShortLeverageX96 = calcLeverageShort(
      basePrice.inner,
      await marginlyPool.quoteCollateralCoeff(),
      await marginlyPool.baseDebtCoeff(),
      await marginlyPool.discountedQuoteCollateral(),
      await marginlyPool.discountedBaseDebt()
    );
    expect(await marginlyPool.shortLeverageX96()).to.be.equal(expectedShortLeverageX96);
    expect(await token0.balanceOf(marginlyPool)).to.be.equal(token0BalanceBefore + quoteAmount);
    expect(await token1.balanceOf(marginlyPool)).to.be.equal(token1BalanceBefore + baseAmount);
  });

  it('should create new position without debt after long liquidation', async () => {
    const {
      marginlyPool,
      uniswapPoolInfo: { token0, token1 },
    } = await loadFixture(createMarginlyPool);
    const [_, longer, depositor, receiver] = await ethers.getSigners();

    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 40000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollateral = 100;
    const longAmount = 1900;
    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, baseCollateral, longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    const beforeLiquidationPosition = await marginlyPool.positions(longer.address);
    const beforeDiscountedBaseCollateral = await marginlyPool.discountedBaseCollateral();
    const beforeDiscountedQuoteCollateral = await marginlyPool.discountedQuoteCollateral();
    const basePrice = await marginlyPool.getBasePrice();
    const token0BalanceBefore = await token0.balanceOf(marginlyPool);
    const token1BalanceBefore = await token1.balanceOf(marginlyPool);

    // wait for accrue interest
    const timeShift = 60 * 24 * 60 * 60;
    await time.increase(timeShift);

    const quoteAmount = 3000n;
    const baseAmount = 10n;
    await marginlyPool
      .connect(receiver)
      .execute(CallType.ReceivePosition, quoteAmount, baseAmount, price, false, longer.address, uniswapV3Swapdata());

    const liquidatedPosition = await marginlyPool.positions(longer.address);
    expect(liquidatedPosition._type).to.be.equal(0);
    expect(liquidatedPosition.discountedBaseAmount).to.be.equal(0);
    expect(liquidatedPosition.discountedQuoteAmount).to.be.equal(0);

    const newPosition = await marginlyPool.positions(receiver.address);
    const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
    const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
    const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();

    expect(newPosition._type).to.be.equal(1); // Lend position
    expect(newPosition.heapPosition).to.be.equal(0);
    const expectedDiscountedBaseAmountDelta = (baseAmount * FP96.one) / baseCollateralCoeff;
    expect(newPosition.discountedBaseAmount).to.be.equal(
      beforeLiquidationPosition.discountedBaseAmount + expectedDiscountedBaseAmountDelta
    ); // should receive bad position collateral
    const expectedDiscountedQuoteAmount =
      ((quoteAmount - (beforeLiquidationPosition.discountedQuoteAmount * quoteDebtCoeff) / FP96.one - 1n) * FP96.one) /
      quoteCollateralCoeff;
    expect(newPosition.discountedQuoteAmount).to.be.equal(expectedDiscountedQuoteAmount);

    //assert aggregates
    expect(await marginlyPool.discountedBaseDebt()).to.be.equal(0);
    expect(await marginlyPool.discountedQuoteDebt()).to.be.equal(0);
    expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(
      beforeDiscountedBaseCollateral + expectedDiscountedBaseAmountDelta
    );
    expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(
      beforeDiscountedQuoteCollateral + newPosition.discountedQuoteAmount
    );

    const expectedLongLeverageX96 = calcLeverageLong(
      basePrice.inner,
      await marginlyPool.quoteDebtCoeff(),
      await marginlyPool.baseCollateralCoeff(),
      await marginlyPool.discountedQuoteDebt(),
      await marginlyPool.discountedBaseCollateral()
    );
    expect(await marginlyPool.longLeverageX96()).to.be.equal(expectedLongLeverageX96);

    const expectedShortLeverageX96 = calcLeverageShort(
      basePrice.inner,
      await marginlyPool.quoteCollateralCoeff(),
      await marginlyPool.baseDebtCoeff(),
      await marginlyPool.discountedQuoteCollateral(),
      await marginlyPool.discountedBaseDebt()
    );
    expect(await marginlyPool.shortLeverageX96()).to.be.equal(expectedShortLeverageX96);
    expect(await token0.balanceOf(marginlyPool)).to.be.equal(token0BalanceBefore + quoteAmount);
    expect(await token1.balanceOf(marginlyPool)).to.be.equal(token1BalanceBefore + baseAmount);
  });

  it('should create new short position after short liquidation', async () => {
    const {
      marginlyPool,
      uniswapPoolInfo: { token0, token1 },
    } = await loadFixture(createMarginlyPool);
    const [_, shorter, depositor, receiver] = await ethers.getSigners();

    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 20000n;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const shorterCollateral = 100n;
    const shortAmount = 7500n;
    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, shorterCollateral, shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    const beforeLiquidationPosition = await marginlyPool.positions(shorter.address);
    const beforeDiscountedBaseCollateral = await marginlyPool.discountedBaseCollateral();
    const basePrice = await marginlyPool.getBasePrice();
    const token0BalanceBefore = await token0.balanceOf(marginlyPool);
    const token1BalanceBefore = await token1.balanceOf(marginlyPool);
    const prevState = await getMarginlyPoolState(marginlyPool);

    //wait for accrue interest
    const timeShift = 20 * 24 * 60 * 60;
    await time.increase(timeShift);

    const quoteAmount = 1000n; // the sum is enough to improve position leverage
    const baseAmount = 100n; // the sum is not enough to cover debt + accruedInterest
    await marginlyPool
      .connect(receiver)
      .execute(CallType.ReceivePosition, quoteAmount, baseAmount, price, false, shorter.address, uniswapV3Swapdata());

    const expectedCoeffs = await calcAccruedRateCoeffs(marginlyPool, prevState);

    const liquidatedPosition = await marginlyPool.positions(shorter.address);
    expect(liquidatedPosition._type).to.be.equal(0);
    expect(liquidatedPosition.discountedBaseAmount).to.be.equal(0);
    expect(liquidatedPosition.discountedQuoteAmount).to.be.equal(0);

    const newPosition = await marginlyPool.positions(receiver.address);
    const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();

    expect(newPosition._type).to.be.equal(2); // Short position
    expect(newPosition.heapPosition).to.be.equal(1);

    const expectedQuoteAmount =
      (quoteAmount * FP96.one) / quoteCollateralCoeff + beforeLiquidationPosition.discountedQuoteAmount;
    expect(newPosition.discountedQuoteAmount).to.be.equal(expectedQuoteAmount); // should receive bad position collateral
    const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
    const expectedDiscountedBaseAmount =
      beforeLiquidationPosition.discountedBaseAmount - (baseAmount * FP96.one) / baseCollateralCoeff;
    expect(newPosition.discountedBaseAmount).to.be.equal(expectedDiscountedBaseAmount); // should receive bad position debt

    //assert aggregates
    expect(await marginlyPool.discountedBaseDebt()).to.be.equal(expectedDiscountedBaseAmount);
    expect(await marginlyPool.discountedQuoteDebt()).to.be.equal(0);
    expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(
      beforeDiscountedBaseCollateral + expectedCoeffs.discountedBaseDebtFee
    );
    expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedQuoteAmount + depositAmount);

    const expectedLongLeverageX96 = calcLeverageLong(
      basePrice.inner,
      await marginlyPool.quoteDebtCoeff(),
      await marginlyPool.baseCollateralCoeff(),
      await marginlyPool.discountedQuoteDebt(),
      await marginlyPool.discountedBaseCollateral()
    );
    expect(await marginlyPool.longLeverageX96()).to.be.equal(expectedLongLeverageX96);

    const expectedShortLeverageX96 = calcLeverageShort(
      basePrice.inner,
      await marginlyPool.quoteCollateralCoeff(),
      await marginlyPool.baseDebtCoeff(),
      await marginlyPool.discountedQuoteCollateral(),
      await marginlyPool.discountedBaseDebt()
    );
    expect(await marginlyPool.shortLeverageX96()).to.be.equal(expectedShortLeverageX96);
    expect(await token0.balanceOf(marginlyPool)).to.be.equal(token0BalanceBefore + quoteAmount);
    expect(await token1.balanceOf(marginlyPool)).to.be.equal(token1BalanceBefore + baseAmount);
  });

  it('should create new long position after long liquidation', async () => {
    const {
      marginlyPool,
      uniswapPoolInfo: { token0, token1 },
    } = await loadFixture(createMarginlyPool);
    const [_, longer, depositor, receiver] = await ethers.getSigners();

    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 40000n;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollateral = 100n;
    const longAmount = 1900n;
    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, baseCollateral, longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    const beforeLiquidationPosition = await marginlyPool.positions(longer.address);
    const beforeDiscountedQuoteCollateral = await marginlyPool.discountedQuoteCollateral();
    const basePrice = await marginlyPool.getBasePrice();
    const token0BalanceBefore = await token0.balanceOf(marginlyPool);
    const token1BalanceBefore = await token1.balanceOf(marginlyPool);
    const prevState = await getMarginlyPoolState(marginlyPool);

    //wait for accrue interest
    const timeShift = 160 * 24 * 60 * 60;
    await time.increase(timeShift);

    const quoteAmount = 20n; // the sum is not enough to cover bad position debt
    const baseAmount = 10n;
    await marginlyPool
      .connect(receiver)
      .execute(CallType.ReceivePosition, quoteAmount, baseAmount, price, false, longer.address, uniswapV3Swapdata());

    const expectedCoeffs = await calcAccruedRateCoeffs(marginlyPool, prevState);

    const liquidatedPosition = await marginlyPool.positions(longer.address);
    expect(liquidatedPosition._type).to.be.equal(0);
    expect(liquidatedPosition.discountedBaseAmount).to.be.equal(0);
    expect(liquidatedPosition.discountedQuoteAmount).to.be.equal(0);

    const newPosition = await marginlyPool.positions(receiver.address);
    const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
    const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();

    expect(newPosition._type).to.be.equal(3); // Long position
    expect(newPosition.heapPosition).to.be.equal(1);
    const expectedBaseAmount =
      (baseAmount * FP96.one) / baseCollateralCoeff + beforeLiquidationPosition.discountedBaseAmount;
    expect(newPosition.discountedBaseAmount).to.be.equal(expectedBaseAmount); // should receive bad position collateral

    const expectedDiscountedQuoteAmount =
      beforeLiquidationPosition.discountedQuoteAmount - (quoteAmount * FP96.one) / quoteDebtCoeff;
    expect(newPosition.discountedQuoteAmount).to.be.equal(expectedDiscountedQuoteAmount);

    //assert aggregates
    expect(await marginlyPool.discountedBaseDebt()).to.be.equal(0);
    expect(await marginlyPool.discountedQuoteDebt()).to.be.equal(expectedDiscountedQuoteAmount);
    expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedBaseAmount + depositAmount);
    expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(
      beforeDiscountedQuoteCollateral + expectedCoeffs.discountedQuoteDebtFee
    );

    const expectedLongLeverageX96 = calcLeverageLong(
      basePrice.inner,
      await marginlyPool.quoteDebtCoeff(),
      await marginlyPool.baseCollateralCoeff(),
      await marginlyPool.discountedQuoteDebt(),
      await marginlyPool.discountedBaseCollateral()
    );
    expect(await marginlyPool.longLeverageX96()).to.be.equal(expectedLongLeverageX96);

    const expectedShortLeverageX96 = calcLeverageShort(
      basePrice.inner,
      await marginlyPool.quoteCollateralCoeff(),
      await marginlyPool.baseDebtCoeff(),
      await marginlyPool.discountedQuoteCollateral(),
      await marginlyPool.discountedBaseDebt()
    );
    expect(await marginlyPool.shortLeverageX96()).to.be.equal(expectedShortLeverageX96);
    expect(await token0.balanceOf(marginlyPool)).to.be.equal(token0BalanceBefore + quoteAmount);
    expect(await token1.balanceOf(marginlyPool)).to.be.equal(token1BalanceBefore + baseAmount);
  });

  it('should create better short position after short liquidation', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [, shorter1, shorter2, depositor, receiver] = await ethers.getSigners();

    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 20000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const shorterCollateral1 = 100;
    const shortAmount1 = 7500; // leverage 19.9
    await marginlyPool
      .connect(shorter1)
      .execute(CallType.DepositQuote, shorterCollateral1, shortAmount1, price, false, ZeroAddress, uniswapV3Swapdata());

    const shorterCollateral2 = 100;
    const shortAmount2 = 7400;
    await marginlyPool
      .connect(shorter2)
      .execute(CallType.DepositQuote, shorterCollateral2, shortAmount2, price, false, ZeroAddress, uniswapV3Swapdata());

    const beforeShorter2Position = await marginlyPool.positions(shorter2.address);
    expect(beforeShorter2Position.heapPosition).to.be.eq(2);

    const beforeShorter1Position = await marginlyPool.positions(shorter1.address);
    expect(beforeShorter1Position.heapPosition).to.be.eq(1);

    //wait for accrue interest
    const timeShift = 20 * 24 * 60 * 60;
    await time.increase(timeShift);

    const quoteAmount = 1000; // the sum is enough to improve position leverage
    const baseAmount = 100; // the sum is not enough to cover debt + accruedInterest
    await marginlyPool
      .connect(receiver)
      .execute(CallType.ReceivePosition, quoteAmount, baseAmount, price, false, shorter1.address, uniswapV3Swapdata());

    const shorter2Position = await marginlyPool.positions(shorter2.address);
    expect(shorter2Position.heapPosition).to.be.eq(1);

    const receiverPosition = await marginlyPool.positions(receiver.address);
    expect(receiverPosition.heapPosition).to.be.eq(2);
  });

  it('should create better long position after short liquidation', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [, longer1, longer2, depositor, receiver] = await ethers.getSigners();

    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 40000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollateral1 = 100;
    const longAmount1 = 1900;
    await marginlyPool
      .connect(longer1)
      .execute(CallType.DepositBase, baseCollateral1, longAmount1, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollateral2 = 100;
    const longAmount2 = 1900;
    await marginlyPool
      .connect(longer2)
      .execute(CallType.DepositBase, baseCollateral2, longAmount2, price, false, ZeroAddress, uniswapV3Swapdata());

    const beforeLonger1Position = await marginlyPool.positions(longer1.address);
    expect(beforeLonger1Position.heapPosition).to.be.eq(1);

    const beforeLonger2Position = await marginlyPool.positions(longer2.address);
    expect(beforeLonger2Position.heapPosition).to.be.eq(2);

    //wait for accrue interest
    const timeShift = 160 * 24 * 60 * 60;
    await time.increase(timeShift);

    const quoteAmount = 20; // the sum is not enough to cover bad position debt
    const baseAmount = 10;
    await marginlyPool
      .connect(receiver)
      .execute(CallType.ReceivePosition, quoteAmount, baseAmount, price, false, longer1.address, uniswapV3Swapdata());

    const longer2Position = await marginlyPool.positions(longer2.address);
    expect(longer2Position.heapPosition).to.be.eq(1);

    const receiverPosition = await marginlyPool.positions(receiver.address);
    expect(receiverPosition.heapPosition).to.be.eq(2);
  });
});

describe('mc heap tests', () => {
  it('remove long caller', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [_, depositor, longer1, longer2, longer3] = await ethers.getSigners();
    const depositAmount = 1000;

    const price = (await marginlyPool.getBasePrice()).inner;

    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, 1000 * depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await marginlyPool
      .connect(longer1)
      .execute(CallType.DepositBase, depositAmount, 18500, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(longer2)
      .execute(CallType.DepositBase, depositAmount, 18400, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(longer3)
      .execute(CallType.DepositBase, depositAmount, 18300, price, false, ZeroAddress, uniswapV3Swapdata());

    expect((await marginlyPool.getHeapPosition(0, false))[1].account).to.be.equal(longer1.address);
    expect((await marginlyPool.getHeapPosition(1, false))[1].account).to.be.equal(longer2.address);
    expect((await marginlyPool.getHeapPosition(2, false))[1].account).to.be.equal(longer3.address);

    await time.increase(24 * 60 * 60);

    // should happen 2 MCs: longer1 as as the one with the worst leverage and longer3 as the caller with bad leverage
    await marginlyPool.connect(longer3).execute(CallType.Reinit, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    expect((await marginlyPool.getHeapPosition(0, false))[1].account).to.be.equal(longer2.address);
    expect((await marginlyPool.getHeapPosition(1, false))[1].account).to.be.equal(ZeroAddress);
  });

  it('remove short caller', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [_, depositor, shorter1, shorter2, shorter3] = await ethers.getSigners();
    const depositAmount = ((await marginlyPool.getBasePrice()).inner * 1000n) / FP96.one;

    const price = (await marginlyPool.getBasePrice()).inner;

    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, 1000n * depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await marginlyPool
      .connect(shorter1)
      .execute(CallType.DepositQuote, depositAmount, 18500, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(shorter2)
      .execute(CallType.DepositQuote, depositAmount, 18400, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(shorter3)
      .execute(CallType.DepositQuote, depositAmount, 18300, price, false, ZeroAddress, uniswapV3Swapdata());

    expect((await marginlyPool.getHeapPosition(0, true))[1].account).to.be.equal(shorter1.address);
    expect((await marginlyPool.getHeapPosition(1, true))[1].account).to.be.equal(shorter2.address);
    expect((await marginlyPool.getHeapPosition(2, true))[1].account).to.be.equal(shorter3.address);

    await time.increase(24 * 60 * 60);

    // should happen 2 MCs: shorter1 as the one with the worst leverage and shorter3 as the caller with bad leverage
    await marginlyPool.connect(shorter3).execute(CallType.Reinit, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    expect((await marginlyPool.getHeapPosition(0, true))[1].account).to.be.equal(shorter2.address);
    expect((await marginlyPool.getHeapPosition(1, true))[1].account).to.be.equal(ZeroAddress);
  });
});
