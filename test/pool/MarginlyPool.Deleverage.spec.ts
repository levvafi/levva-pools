import { createMarginlyPool, getDeleveragedPool } from './shared/fixtures';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  CallType,
  FP96,
  paramsDefaultLeverageWithoutIr,
  paramsLowLeverageWithoutIr,
  uniswapV3Swapdata,
  PositionType,
} from './shared/utils';
import { ZeroAddress } from 'ethers';

describe('Deleverage', () => {
  it('Deleverage long position', async () => {
    const { marginlyPool, factoryOwner } = await loadFixture(createMarginlyPool);

    await marginlyPool.connect(factoryOwner).setParameters(paramsDefaultLeverageWithoutIr);

    const price = (await marginlyPool.getBasePrice()).inner;

    const accounts = await ethers.getSigners();

    const lender = accounts[0];
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 10000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 10000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const longer = accounts[1];
    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, 1000, 18000, price, false, ZeroAddress, uniswapV3Swapdata());

    const shorter = accounts[2];

    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, 100000, 20000, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollCoeff = await marginlyPool.baseCollateralCoeff();
    const discountedBaseCollateral = await marginlyPool.discountedBaseCollateral();
    const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
    const discountedBaseDebt = await marginlyPool.discountedBaseDebt();
    const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
    const discountedQuoteCollateral = await marginlyPool.discountedQuoteCollateral();
    const quoteCollCoeff = await marginlyPool.quoteCollateralCoeff();

    const posDisColl = (await marginlyPool.positions(longer.address)).discountedBaseAmount;
    const posDisDebt = (await marginlyPool.positions(longer.address)).discountedQuoteAmount;

    await marginlyPool.connect(factoryOwner).setParameters(paramsLowLeverageWithoutIr);
    await marginlyPool.connect(lender).execute(CallType.Reinit, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const poolBaseBalance = (baseCollCoeff * discountedBaseCollateral - baseDebtCoeff * discountedBaseDebt) / FP96.one;

    const longerPosition = await marginlyPool.positions(longer.address);

    expect(longerPosition._type).to.be.equal(0);
    expect(longerPosition.discountedBaseAmount).to.be.equal(0);
    expect(longerPosition.discountedQuoteAmount).to.be.equal(0);

    const quoteDelevCoeffAfter = await marginlyPool.quoteDelevCoeff();
    const baseDebtCoeffAfter = await marginlyPool.baseDebtCoeff();

    const posRealColl = (baseCollCoeff * posDisColl) / FP96.one;
    const baseDeleverageAmount = posRealColl - poolBaseBalance;
    const quoteDeleverageAmount = (baseDeleverageAmount * price) / FP96.one;

    expect(baseDebtCoeffAfter).to.be.equal(baseDebtCoeff - (baseDeleverageAmount * FP96.one) / discountedBaseDebt);

    const posQuoteDebtAfterDelev = (quoteDebtCoeff * posDisDebt) / FP96.one - quoteDeleverageAmount;
    const posBaseCollBeforeMC = posRealColl - baseDeleverageAmount;
    const quoteDelta = (posBaseCollBeforeMC * price) / FP96.one - posQuoteDebtAfterDelev;

    const poolQuoteCollAfterDelev = (quoteCollCoeff * discountedQuoteCollateral) / FP96.one - quoteDeleverageAmount;

    const quoteDelevCoeffAfterDelev = (quoteDeleverageAmount * FP96.one) / discountedBaseDebt;

    const factor = (quoteDelta * FP96.one) / poolQuoteCollAfterDelev + FP96.one;

    const resQuoteDelevCoeff = (quoteDelevCoeffAfterDelev * factor) / FP96.one;

    expect(quoteDelevCoeffAfter).to.be.equal(resQuoteDelevCoeff);
  });

  it('Deleverage short position', async () => {
    const { marginlyPool, factoryOwner } = await loadFixture(createMarginlyPool);

    await marginlyPool.connect(factoryOwner).setParameters(paramsDefaultLeverageWithoutIr);
    const price = (await marginlyPool.getBasePrice()).inner;

    const accounts = await ethers.getSigners();

    const lender = accounts[0];
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 10000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const shorter = accounts[1];
    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, 100, 7200, price, false, ZeroAddress, uniswapV3Swapdata());

    const longer = accounts[2];
    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, 10000, 8000, price, false, ZeroAddress, uniswapV3Swapdata());

    const quoteCollCoeff = await marginlyPool.quoteCollateralCoeff();
    const discountedQuoteCollateral = await marginlyPool.discountedQuoteCollateral();
    const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
    const discountedQuoteDebt = await marginlyPool.discountedQuoteDebt();
    const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
    const discountedBaseCollateral = await marginlyPool.discountedBaseCollateral();
    const baseCollCoeff = await marginlyPool.baseCollateralCoeff();

    const posDisColl = (await marginlyPool.positions(shorter.address)).discountedQuoteAmount;
    const posDisDebt = (await marginlyPool.positions(shorter.address)).discountedBaseAmount;

    await marginlyPool.connect(factoryOwner).setParameters(paramsLowLeverageWithoutIr);
    await marginlyPool.connect(lender).execute(CallType.Reinit, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const poolQuoteBalance =
      (quoteCollCoeff * discountedQuoteCollateral - quoteDebtCoeff * discountedQuoteDebt) / FP96.one;

    const shorterPosition = await marginlyPool.positions(shorter.address);

    expect(shorterPosition._type).to.be.equal(0);
    expect(shorterPosition.discountedBaseAmount).to.be.equal(0);
    expect(shorterPosition.discountedQuoteAmount).to.be.equal(0);

    const baseDelevCoeffAfter = await marginlyPool.baseDelevCoeff();
    const quoteDebtCoeffAfter = await marginlyPool.quoteDebtCoeff();

    const posRealColl = (quoteCollCoeff * posDisColl) / FP96.one;
    const quoteDeleverageAmount = posRealColl - poolQuoteBalance;
    const baseDeleverageAmount = (quoteDeleverageAmount * FP96.one) / price;

    expect(quoteDebtCoeffAfter).to.be.equal(quoteDebtCoeff - (quoteDeleverageAmount * FP96.one) / discountedQuoteDebt);

    const posBaseDebtAfterDelev = (baseDebtCoeff * posDisDebt) / FP96.one - baseDeleverageAmount;
    const posQuoteCollBeforeMC = posRealColl - quoteDeleverageAmount;
    const baseDelta = (posQuoteCollBeforeMC * FP96.one) / price - posBaseDebtAfterDelev;

    const poolBaseCollAfterDelev = (baseCollCoeff * discountedBaseCollateral) / FP96.one - baseDeleverageAmount;

    const baseDelevCoeffAfterDelev = (baseDeleverageAmount * FP96.one) / discountedQuoteDebt;

    const factor = (baseDelta * FP96.one) / poolBaseCollAfterDelev + FP96.one;

    const resBaseDelevCoeff = (baseDelevCoeffAfterDelev * factor) / FP96.one;

    expect(baseDelevCoeffAfter).to.be.closeTo(resBaseDelevCoeff, baseDelevCoeffAfter / 1000n);
  });

  it('short call after deleverage', async () => {
    const { marginlyPool } = await loadFixture(getDeleveragedPool);

    const [_, lender, shorter] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionBefore = await marginlyPool.positions(shorter.address);
    const disQuoteCollateralBefore = await marginlyPool.discountedQuoteCollateral();

    const shortAmount = 1000n;
    await marginlyPool
      .connect(shorter)
      .execute(CallType.Short, shortAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
    const quoteCollCoeff = await marginlyPool.quoteCollateralCoeff();
    const quoteDelevCoeff = await marginlyPool.quoteDelevCoeff();
    const positionAfter = await marginlyPool.positions(shorter.address);
    const disQuoteCollateralAfter = await marginlyPool.discountedQuoteCollateral();

    const quoteCollDelta =
      (price * shortAmount) / quoteCollCoeff +
      (quoteDelevCoeff * shortAmount * FP96.one) / baseDebtCoeff / quoteCollCoeff;

    const posQuoteCollDelta = positionAfter.discountedQuoteAmount - positionBefore.discountedQuoteAmount;
    expect(posQuoteCollDelta).to.be.equal(quoteCollDelta);

    const totalQuoteCollDelta = disQuoteCollateralAfter - disQuoteCollateralBefore;
    expect(totalQuoteCollDelta).to.be.equal(quoteCollDelta);
  });

  it('long call after deleverage', async () => {
    const { marginlyPool } = await loadFixture(getDeleveragedPool);

    const [_, lender, longer] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionBefore = await marginlyPool.positions(longer.address);
    const disBaseCollateralBefore = await marginlyPool.discountedBaseCollateral();

    const longAmount = 1000n;
    await marginlyPool
      .connect(longer)
      .execute(CallType.Long, longAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
    const baseCollCoeff = await marginlyPool.baseCollateralCoeff();
    const baseDelevCoeff = await marginlyPool.baseDelevCoeff();
    const positionAfter = await marginlyPool.positions(longer.address);
    const disBaseCollateralAfter = await marginlyPool.discountedBaseCollateral();

    const baseCollDelta =
      (longAmount * FP96.one) / baseCollCoeff +
      (((((baseDelevCoeff * price) / FP96.one) * longAmount) / quoteDebtCoeff) * FP96.one) / baseCollCoeff;

    const posBaseCollDelta = positionAfter.discountedBaseAmount - positionBefore.discountedBaseAmount;
    expect(posBaseCollDelta).to.be.closeTo(baseCollDelta, 1n);

    const totalBaseCollDelta = disBaseCollateralAfter - disBaseCollateralBefore;
    expect(totalBaseCollDelta).to.be.closeTo(baseCollDelta, 1n);
  });

  it('depositQuote call after deleverage', async () => {
    const { marginlyPool } = await loadFixture(getDeleveragedPool);

    const [_, lender, shorter] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const shortAmount = 1000n;
    await marginlyPool
      .connect(shorter)
      .execute(CallType.Short, shortAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionBefore = await marginlyPool.positions(shorter.address);
    const disQuoteCollateralBefore = await marginlyPool.discountedQuoteCollateral();

    const quoteDepositAmount = 500n;
    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, quoteDepositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(shorter.address);
    const disQuoteCollateralAfter = await marginlyPool.discountedQuoteCollateral();
    const quoteCollCoeff = await marginlyPool.quoteCollateralCoeff();
    const quoteCollDelta = (quoteDepositAmount * FP96.one) / quoteCollCoeff;

    const posQuoteCollDelta = positionAfter.discountedQuoteAmount - positionBefore.discountedQuoteAmount;
    expect(posQuoteCollDelta).to.be.equal(quoteCollDelta);

    const totalQuoteCollDelta = disQuoteCollateralAfter - disQuoteCollateralBefore;
    expect(totalQuoteCollDelta).to.be.equal(quoteCollDelta);
  });

  it('depositBase call after deleverage', async () => {
    const { marginlyPool } = await loadFixture(getDeleveragedPool);

    const [_, lender, longer] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const longAmount = 1000n;
    await marginlyPool
      .connect(longer)
      .execute(CallType.Long, longAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionBefore = await marginlyPool.positions(longer.address);
    const disBaseCollateralBefore = await marginlyPool.discountedBaseCollateral();

    const baseDepositAmount = 500n;
    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, baseDepositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(longer.address);
    const disBaseCollateralAfter = await marginlyPool.discountedBaseCollateral();
    const baseCollCoeff = await marginlyPool.baseCollateralCoeff();
    const baseCollDelta = (baseDepositAmount * FP96.one) / baseCollCoeff;

    const posBaseCollDelta = positionAfter.discountedBaseAmount - positionBefore.discountedBaseAmount;
    expect(posBaseCollDelta).to.be.equal(baseCollDelta);

    const totalBaseCollDelta = disBaseCollateralAfter - disBaseCollateralBefore;
    expect(totalBaseCollDelta).to.be.equal(baseCollDelta);
  });

  it('withdrawQuote call after deleverage', async () => {
    const { marginlyPool } = await loadFixture(getDeleveragedPool);

    const [_, lender, shorter] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const shortAmount = 1000n;
    await marginlyPool
      .connect(shorter)
      .execute(CallType.Short, shortAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionBefore = await marginlyPool.positions(shorter.address);
    const disQuoteCollateralBefore = await marginlyPool.discountedQuoteCollateral();

    const quoteAmountWithdrawn = 500n;
    await marginlyPool
      .connect(shorter)
      .execute(CallType.WithdrawQuote, quoteAmountWithdrawn, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(shorter.address);
    const disQuoteCollateralAfter = await marginlyPool.discountedQuoteCollateral();
    const quoteCollCoeff = await marginlyPool.quoteCollateralCoeff();
    const quoteCollDelta = (quoteAmountWithdrawn * FP96.one) / quoteCollCoeff;

    const posQuoteCollDelta = positionBefore.discountedQuoteAmount - positionAfter.discountedQuoteAmount;
    expect(posQuoteCollDelta).to.be.equal(quoteCollDelta);

    const totalQuoteCollDelta = disQuoteCollateralBefore - disQuoteCollateralAfter;
    expect(totalQuoteCollDelta).to.be.equal(quoteCollDelta);
  });

  it('withdrawBase call after deleverage', async () => {
    const { marginlyPool } = await loadFixture(getDeleveragedPool);

    const [_, lender, longer] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const longAmount = 1000n;
    await marginlyPool
      .connect(longer)
      .execute(CallType.Long, longAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionBefore = await marginlyPool.positions(longer.address);
    const disBaseCollateralBefore = await marginlyPool.discountedBaseCollateral();

    const baseAmountWithdrawn = 500n;
    await marginlyPool
      .connect(longer)
      .execute(CallType.WithdrawBase, baseAmountWithdrawn, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(longer.address);
    const disBaseCollateralAfter = await marginlyPool.discountedBaseCollateral();
    const baseCollCoeff = await marginlyPool.baseCollateralCoeff();
    const baseCollDelta = (baseAmountWithdrawn * FP96.one) / baseCollCoeff;

    const posBaseCollDelta = positionBefore.discountedBaseAmount - positionAfter.discountedBaseAmount;
    expect(posBaseCollDelta).to.be.equal(baseCollDelta);

    const totalBaseCollDelta = disBaseCollateralBefore - disBaseCollateralAfter;
    expect(totalBaseCollDelta).to.be.equal(baseCollDelta);
  });

  it('close long position after deleverage', async () => {
    const { marginlyPool } = await loadFixture(getDeleveragedPool);

    const [_, lender, longer] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;
    console.log(`price is ${price}`);

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const longAmount = 1000;
    await marginlyPool
      .connect(longer)
      .execute(CallType.Long, longAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionBefore = await marginlyPool.positions(longer.address);
    const disBaseCollateralBefore = await marginlyPool.discountedBaseCollateral();
    const disQuoteDebtBefore = await marginlyPool.discountedQuoteDebt();

    await time.increase(10 * 24 * 60 * 60);
    // 99% of a price as limit is used to avoid precision issues in calculations
    await marginlyPool
      .connect(longer)
      .execute(CallType.ClosePosition, 0, 0, (price * 99n) / 100n, false, ZeroAddress, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(longer.address);

    expect(positionAfter.discountedQuoteAmount).to.be.equal(0);
    const disQuoteDebtAfter = await marginlyPool.discountedQuoteDebt();
    const totalQuoteDebtDelta = disQuoteDebtBefore - disQuoteDebtAfter;
    expect(totalQuoteDebtDelta).to.be.equal(positionBefore.discountedQuoteAmount);

    const baseCollCoeff = await marginlyPool.baseCollateralCoeff();
    const baseDelevCoeff = await marginlyPool.baseDelevCoeff();
    const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();

    // posBefore.discountedQuoteAmount * quoteDebtCoeff / price
    const realCollDelta = (positionBefore.discountedQuoteAmount * quoteDebtCoeff) / price;
    // (realCollDelta + pos.discountedQuoteAmount * baseDelevCoeff) / baseCollCoeff
    const disBaseCollDelta =
      ((realCollDelta + (positionBefore.discountedQuoteAmount * baseDelevCoeff) / FP96.one) * FP96.one) / baseCollCoeff;

    const disBaseCollateralAfter = await marginlyPool.discountedBaseCollateral();

    const posBaseCollDelta = positionBefore.discountedBaseAmount - positionAfter.discountedBaseAmount;
    expect(posBaseCollDelta).to.be.closeTo(disBaseCollDelta, 2n);

    const totalBaseCollDelta = disBaseCollateralBefore - disBaseCollateralAfter;
    expect(totalBaseCollDelta).to.be.closeTo(disBaseCollDelta, 2n);
  });

  it('close short position after deleverage', async () => {
    const { marginlyPool } = await loadFixture(getDeleveragedPool);

    const [_, lender, shorter] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const shortAmount = 1000;
    await marginlyPool
      .connect(shorter)
      .execute(CallType.Short, shortAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionBefore = await marginlyPool.positions(shorter.address);
    const disQuoteCollateralBefore = await marginlyPool.discountedQuoteCollateral();
    const disBaseDebtBefore = await marginlyPool.discountedBaseDebt();

    await time.increase(10 * 24 * 60 * 60);
    await marginlyPool
      .connect(shorter)
      .execute(CallType.ClosePosition, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(shorter.address);

    expect(positionAfter.discountedBaseAmount).to.be.equal(0);
    const disBaseDebtAfter = await marginlyPool.discountedBaseDebt();
    const totalBaseDebtDelta = disBaseDebtBefore - disBaseDebtAfter;
    expect(totalBaseDebtDelta).to.be.equal(positionBefore.discountedBaseAmount);

    const quoteCollCoeff = await marginlyPool.quoteCollateralCoeff();
    const quoteDelevCoeff = await marginlyPool.quoteDelevCoeff();
    const baseDebtCoeff = await marginlyPool.baseDebtCoeff();

    const realCollDelta = (((positionBefore.discountedBaseAmount * baseDebtCoeff) / FP96.one) * price) / FP96.one;
    // (realCollDelta + pos.discountedBaseAmount * quoteDelevCoeff) / quoteCollCoeff
    const disQuoteCollDelta =
      ((realCollDelta + (positionBefore.discountedBaseAmount * quoteDelevCoeff) / FP96.one) * FP96.one) /
      quoteCollCoeff;

    const disQuoteCollateralAfter = await marginlyPool.discountedQuoteCollateral();

    const posQuoteCollDelta = positionBefore.discountedQuoteAmount - positionAfter.discountedQuoteAmount;
    expect(posQuoteCollDelta).to.be.equal(disQuoteCollDelta);

    const totalQuoteCollDelta = disQuoteCollateralBefore - disQuoteCollateralAfter;
    expect(totalQuoteCollDelta).to.be.equal(disQuoteCollDelta);
  });

  it('receive short position after deleverage, decreasing debt', async () => {
    const { marginlyPool, factoryOwner } = await loadFixture(getDeleveragedPool);

    const [_, lender, shorter, liquidator] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;
    const params = await marginlyPool.params();

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const depositQuoteAmount = 1000n;
    // (quoteDeposit + price * shortAmount) / quoteDeposit = (maxLev - 1)
    // shortAmount = (maxLev - 2) * quoteDeposit / price
    const shortAmount = ((params.maxLeverage - 2n) * depositQuoteAmount * FP96.one) / price;
    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, depositQuoteAmount, shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    const newParams = {
      maxLeverage: params.maxLeverage / 2n,
      interestRate: params.interestRate,
      fee: params.fee,
      swapFee: params.swapFee,
      mcSlippage: params.mcSlippage,
      positionMinAmount: params.positionMinAmount,
      quoteLimit: params.quoteLimit,
    };
    await marginlyPool.connect(factoryOwner).setParameters(newParams);

    const positionBefore = await marginlyPool.positions(shorter.address);
    const baseDebtBefore = await marginlyPool.discountedBaseDebt();
    const quoteDebtBefore = await marginlyPool.discountedQuoteDebt();
    const quoteCollBefore = await marginlyPool.discountedQuoteCollateral();
    const baseCollBefore = await marginlyPool.discountedBaseCollateral();

    const receiveBaseAmount = (shortAmount * 3n) / 4n;
    await marginlyPool
      .connect(liquidator)
      .execute(CallType.ReceivePosition, 0, receiveBaseAmount, price, false, shorter.address, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(liquidator.address);
    expect(positionAfter._type).to.be.eq(PositionType.Short);

    const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
    const quoteDelevCoeff = await marginlyPool.quoteDelevCoeff();
    const baseDebtCoeff = await marginlyPool.baseDebtCoeff();

    const quoteCollAfter = await marginlyPool.discountedQuoteCollateral();
    const quoteDebtAfter = await marginlyPool.discountedQuoteDebt();
    const baseDebtAfter = await marginlyPool.discountedBaseDebt();
    const baseCollAfter = await marginlyPool.discountedBaseCollateral();

    expect(quoteDebtBefore).to.be.eq(quoteDebtAfter);
    expect(baseCollBefore).to.be.eq(baseCollAfter);

    const realBaseDebtBefore = (baseDebtCoeff * baseDebtBefore) / FP96.one;
    const realBaseDebtAfter = (baseDebtCoeff * baseDebtAfter) / FP96.one;
    expect(realBaseDebtBefore - realBaseDebtAfter).to.be.closeTo(receiveBaseAmount, receiveBaseAmount / 1000n);

    const posRealBaseDebtBefore = (baseDebtCoeff * positionBefore.discountedBaseAmount) / FP96.one;
    const posRealBaseDebtAfter = (baseDebtCoeff * positionAfter.discountedBaseAmount) / FP96.one;
    expect(posRealBaseDebtBefore - posRealBaseDebtAfter).to.be.closeTo(receiveBaseAmount, receiveBaseAmount / 1000n);

    const realQuoteCollBefore =
      (quoteCollateralCoeff * quoteCollBefore) / FP96.one - (quoteDelevCoeff * baseDebtBefore) / FP96.one;
    const realQuoteCollAfter =
      (quoteCollateralCoeff * quoteCollAfter) / FP96.one - (quoteDelevCoeff * baseDebtAfter) / FP96.one;
    expect(realQuoteCollBefore).to.be.closeTo(realQuoteCollAfter, realQuoteCollAfter / 1000n);

    const posRealQuoteCollBefore =
      (quoteCollateralCoeff * positionBefore.discountedQuoteAmount) / FP96.one -
      (quoteDelevCoeff * positionBefore.discountedBaseAmount) / FP96.one;
    const posRealQuoteCollAfter =
      (quoteCollateralCoeff * positionAfter.discountedQuoteAmount) / FP96.one -
      (quoteDelevCoeff * positionAfter.discountedBaseAmount) / FP96.one;
    expect(posRealQuoteCollBefore).to.be.closeTo(posRealQuoteCollAfter, posRealQuoteCollAfter / 1000n);
  });

  it('receive long position after deleverage, decreasing debt', async () => {
    const { marginlyPool, factoryOwner } = await loadFixture(getDeleveragedPool);

    const [_, lender, longer, liquidator] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;
    const params = await marginlyPool.params();

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const depositBaseAmount = 1000n;
    // (baseDeposit + longAmount) / baseDeposit = (maxLev - 1)
    // shortAmount = (maxLev - 2) * quoteDeposit
    const longAmount = (params.maxLeverage - 2n) * depositBaseAmount;
    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, depositBaseAmount, longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    const newParams = {
      maxLeverage: params.maxLeverage / 2n,
      interestRate: params.interestRate,
      fee: params.fee,
      swapFee: params.swapFee,
      mcSlippage: params.mcSlippage,
      positionMinAmount: params.positionMinAmount,
      quoteLimit: params.quoteLimit,
    };
    await marginlyPool.connect(factoryOwner).setParameters(newParams);

    const positionBefore = await marginlyPool.positions(longer.address);
    const quoteDebtBefore = await marginlyPool.discountedQuoteDebt();
    const baseDebtBefore = await marginlyPool.discountedBaseDebt();
    const quoteCollBefore = await marginlyPool.discountedQuoteCollateral();
    const baseCollBefore = await marginlyPool.discountedBaseCollateral();

    const receiveQuoteAmount = (price * longAmount * 3n) / 4n / FP96.one;
    await marginlyPool
      .connect(liquidator)
      .execute(CallType.ReceivePosition, receiveQuoteAmount, 0, price, false, longer.address, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(liquidator.address);
    expect(positionAfter._type).to.be.eq(PositionType.Long);

    const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
    const baseDelevCoeff = await marginlyPool.baseDelevCoeff();
    const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();

    const baseCollAfter = await marginlyPool.discountedBaseCollateral();
    const baseDebtAfter = await marginlyPool.discountedBaseDebt();
    const quoteCollAfter = await marginlyPool.discountedQuoteCollateral();
    const quoteDebtAfter = await marginlyPool.discountedQuoteDebt();

    expect(baseDebtBefore).to.be.eq(baseDebtAfter);
    expect(quoteCollBefore).to.be.eq(quoteCollAfter);

    const realQuoteDebtBefore = (quoteDebtCoeff * quoteDebtBefore) / FP96.one;
    const realQuoteDebtAfter = (quoteDebtCoeff * quoteDebtAfter) / FP96.one;
    expect(realQuoteDebtBefore - realQuoteDebtAfter).to.be.closeTo(receiveQuoteAmount, receiveQuoteAmount / 1000n);

    const posRealQuoteDebtBefore = (quoteDebtCoeff * positionBefore.discountedQuoteAmount) / FP96.one;
    const posRealQuoteDebtAfter = (quoteDebtCoeff * positionAfter.discountedQuoteAmount) / FP96.one;
    expect(posRealQuoteDebtBefore - posRealQuoteDebtAfter).to.be.closeTo(
      receiveQuoteAmount,
      receiveQuoteAmount / 1000n
    );

    const realBaseCollBefore =
      (baseCollateralCoeff * baseCollBefore) / FP96.one - (baseDelevCoeff * quoteDebtBefore) / FP96.one;
    const realBaseCollAfter =
      (baseCollateralCoeff * baseCollAfter) / FP96.one - (baseDelevCoeff * quoteDebtAfter) / FP96.one;
    expect(realBaseCollBefore).to.be.closeTo(realBaseCollAfter, realBaseCollAfter / 1000n);

    const posRealBaseCollBefore =
      (baseCollateralCoeff * positionBefore.discountedBaseAmount) / FP96.one -
      (baseDelevCoeff * positionBefore.discountedQuoteAmount) / FP96.one;
    const posRealBaseCollAfter =
      (baseCollateralCoeff * positionAfter.discountedBaseAmount) / FP96.one -
      (baseDelevCoeff * positionAfter.discountedQuoteAmount) / FP96.one;
    expect(posRealBaseCollBefore).to.be.closeTo(posRealBaseCollAfter, posRealBaseCollAfter / 1000n);
  });

  it('receive short position after deleverage, debt fully covered', async () => {
    const { marginlyPool, factoryOwner } = await loadFixture(getDeleveragedPool);

    const [_, lender, shorter, liquidator] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    const params = await marginlyPool.params();
    const newParams = {
      maxLeverage: params.maxLeverage,
      interestRate: 0n,
      fee: 0n,
      swapFee: 0n,
      mcSlippage: params.mcSlippage,
      positionMinAmount: params.positionMinAmount,
      quoteLimit: params.quoteLimit,
    };
    await marginlyPool.connect(factoryOwner).setParameters(newParams);

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const depositQuoteAmount = 1000n;
    // (quoteDeposit + price * shortAmount) / quoteDeposit = (maxLev - 1)
    // shortAmount = (maxLev - 2) * quoteDeposit / price
    const shortAmount = ((params.maxLeverage - 2n) * depositQuoteAmount * FP96.one) / price;
    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, depositQuoteAmount, shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    newParams.maxLeverage /= 2n;
    await marginlyPool.connect(factoryOwner).setParameters(newParams);

    const positionBefore = await marginlyPool.positions(shorter.address);
    const quoteDebtBefore = await marginlyPool.discountedQuoteDebt();
    const baseDebtBefore = await marginlyPool.discountedBaseDebt();
    const quoteCollBefore = await marginlyPool.discountedQuoteCollateral();
    const baseCollBefore = await marginlyPool.discountedBaseCollateral();

    const receiveBaseAmount = (shortAmount * 5n) / 4n;
    const baseOverflow = receiveBaseAmount - shortAmount;
    expect(baseOverflow).to.be.greaterThan(0);
    await marginlyPool
      .connect(liquidator)
      .execute(CallType.ReceivePosition, 0, receiveBaseAmount, price, false, shorter.address, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(liquidator.address);
    expect(positionAfter._type).to.be.eq(PositionType.Lend);

    const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
    const quoteDelevCoeff = await marginlyPool.quoteDelevCoeff();
    const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
    const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();

    const quoteDebtAfter = await marginlyPool.discountedQuoteDebt();
    const quoteCollAfter = await marginlyPool.discountedQuoteCollateral();
    const baseDebtAfter = await marginlyPool.discountedBaseDebt();
    const baseCollAfter = await marginlyPool.discountedBaseCollateral();

    expect(quoteDebtBefore).to.be.eq(quoteDebtAfter);

    const realBaseDebtBefore = (baseDebtCoeff * baseDebtBefore) / FP96.one;
    const realBaseDebtAfter = (baseDebtCoeff * baseDebtAfter) / FP96.one;
    expect(realBaseDebtBefore - realBaseDebtAfter).to.be.closeTo(shortAmount, shortAmount / 1000n);

    const posRealBaseCollateralAfter = (baseCollateralCoeff * positionAfter.discountedBaseAmount) / FP96.one;
    expect(posRealBaseCollateralAfter).to.be.closeTo(baseOverflow, baseOverflow / 1000n);

    const realBaseCollateralBefore = (baseCollateralCoeff * baseCollBefore) / FP96.one;
    const realBaseCollateralAfter = (baseCollateralCoeff * baseCollAfter) / FP96.one;
    expect(realBaseCollateralAfter - realBaseCollateralBefore).to.be.closeTo(baseOverflow, baseOverflow / 1000n);

    const realQuoteCollBefore =
      (quoteCollateralCoeff * quoteCollBefore) / FP96.one - (quoteDelevCoeff * baseDebtBefore) / FP96.one;
    const realQuoteCollAfter =
      (quoteCollateralCoeff * quoteCollAfter) / FP96.one - (quoteDelevCoeff * baseDebtAfter) / FP96.one;
    expect(realQuoteCollBefore).to.be.closeTo(realQuoteCollAfter, realQuoteCollAfter / 1000n);

    const posRealQuoteCollBefore =
      (quoteCollateralCoeff * positionBefore.discountedQuoteAmount) / FP96.one -
      (quoteDelevCoeff * positionBefore.discountedBaseAmount) / FP96.one;
    const posRealQuoteCollAfter = (quoteCollateralCoeff * positionAfter.discountedQuoteAmount) / FP96.one;
    expect(posRealQuoteCollBefore).to.be.closeTo(posRealQuoteCollAfter, posRealQuoteCollAfter / 1000n);
  });

  it('receive long position after deleverage, debt fully covered', async () => {
    const { marginlyPool, factoryOwner } = await loadFixture(getDeleveragedPool);

    const [_, lender, longer, liquidator] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    const params = await marginlyPool.params();
    let newParams = {
      maxLeverage: params.maxLeverage,
      interestRate: 0n,
      fee: 0n,
      swapFee: 0n,
      mcSlippage: params.mcSlippage,
      positionMinAmount: params.positionMinAmount,
      quoteLimit: params.quoteLimit,
    };
    await marginlyPool.connect(factoryOwner).setParameters(newParams);

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const depositBaseAmount = 1000n;
    // (baseDeposit + longAmount) / baseDeposit = (maxLev - 1)
    // shortAmount = (maxLev - 2) * quoteDeposit
    const longAmount = (params.maxLeverage - 2n) * depositBaseAmount;
    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, depositBaseAmount, longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    newParams = {
      maxLeverage: newParams.maxLeverage / 2n,
      interestRate: params.interestRate,
      fee: params.fee,
      swapFee: params.swapFee,
      mcSlippage: params.mcSlippage,
      positionMinAmount: params.positionMinAmount,
      quoteLimit: params.quoteLimit,
    };
    await marginlyPool.connect(factoryOwner).setParameters(newParams);

    const positionBefore = await marginlyPool.positions(longer.address);
    const quoteDebtBefore = await marginlyPool.discountedQuoteDebt();
    const baseDebtBefore = await marginlyPool.discountedBaseDebt();
    const baseCollBefore = await marginlyPool.discountedBaseCollateral();
    const quoteCollBefore = await marginlyPool.discountedQuoteCollateral();

    const receiveQuoteAmount = (price * longAmount * 5n) / 4n / FP96.one;
    const longAmountInQuote = (price * longAmount) / FP96.one;
    const quoteOverflow = receiveQuoteAmount - longAmountInQuote;
    expect(quoteOverflow).to.be.greaterThan(0);
    await marginlyPool
      .connect(liquidator)
      .execute(CallType.ReceivePosition, receiveQuoteAmount, 0, price, false, longer.address, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(liquidator.address);
    expect(positionAfter._type).to.be.eq(PositionType.Lend);

    const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
    const baseDelevCoeff = await marginlyPool.baseDelevCoeff();
    const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
    const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();

    const baseCollAfter = await marginlyPool.discountedBaseCollateral();
    const baseDebtAfter = await marginlyPool.discountedBaseDebt();
    const quoteDebtAfter = await marginlyPool.discountedQuoteDebt();
    const quoteCollAfter = await marginlyPool.discountedQuoteCollateral();

    expect(baseDebtBefore).to.be.eq(baseDebtAfter);

    const realQuoteDebtBefore = (quoteDebtCoeff * quoteDebtBefore) / FP96.one;
    const realQuoteDebtAfter = (quoteDebtCoeff * quoteDebtAfter) / FP96.one;
    expect(realQuoteDebtBefore - realQuoteDebtAfter).to.be.closeTo(longAmountInQuote, longAmountInQuote / 1000n);

    const posRealQuoteCollateralAfter = (quoteCollateralCoeff * positionAfter.discountedQuoteAmount) / FP96.one;
    expect(posRealQuoteCollateralAfter).to.be.closeTo(quoteOverflow, quoteOverflow / 1000n);

    const realQuoteCollateralBefore = (quoteCollateralCoeff * quoteCollBefore) / FP96.one;
    const realQuoteCollateralAfter = (quoteCollateralCoeff * quoteCollAfter) / FP96.one;
    expect(realQuoteCollateralAfter - realQuoteCollateralBefore).to.be.closeTo(quoteOverflow, quoteOverflow / 1000n);

    const realBaseCollBefore =
      (baseCollateralCoeff * baseCollBefore) / FP96.one - (baseDelevCoeff * quoteDebtBefore) / FP96.one;
    const realBaseCollAfter =
      (baseCollateralCoeff * baseCollAfter) / FP96.one - (baseDelevCoeff * quoteDebtAfter) / FP96.one;
    expect(realBaseCollBefore).to.be.closeTo(realBaseCollAfter, realBaseCollAfter / 1000n);

    const posRealBaseCollBefore =
      (baseCollateralCoeff * positionBefore.discountedBaseAmount) / FP96.one -
      (baseDelevCoeff * positionBefore.discountedQuoteAmount) / FP96.one;
    const posRealBaseCollAfter = (baseCollateralCoeff * positionAfter.discountedBaseAmount) / FP96.one;
    expect(posRealBaseCollBefore).to.be.closeTo(posRealBaseCollAfter, posRealBaseCollAfter / 1000n);
  });

  it('receive short position after deleverage, increasing collateral', async () => {
    const { marginlyPool, factoryOwner } = await loadFixture(getDeleveragedPool);

    const [_, lender, shorter, liquidator] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    const params = await marginlyPool.params();
    let newParams = {
      maxLeverage: params.maxLeverage,
      interestRate: 0n,
      fee: 0n,
      swapFee: 0n,
      mcSlippage: params.mcSlippage,
      positionMinAmount: params.positionMinAmount,
      quoteLimit: params.quoteLimit,
    };
    await marginlyPool.connect(factoryOwner).setParameters(newParams);

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const depositQuoteAmount = 1000n;
    // (quoteDeposit + price * shortAmount) / quoteDeposit = (maxLev - 1)
    // shortAmount = (maxLev - 2) * quoteDeposit / price
    const shortAmount = ((params.maxLeverage - 2n) * depositQuoteAmount * FP96.one) / price;
    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, depositQuoteAmount, shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    newParams = {
      maxLeverage: newParams.maxLeverage / 2n,
      interestRate: params.interestRate,
      fee: params.fee,
      swapFee: params.swapFee,
      mcSlippage: params.mcSlippage,
      positionMinAmount: params.positionMinAmount,
      quoteLimit: params.quoteLimit,
    };
    await marginlyPool.connect(factoryOwner).setParameters(newParams);

    const positionBefore = await marginlyPool.positions(shorter.address);
    const baseDebtBefore = await marginlyPool.discountedBaseDebt();
    const quoteCollBefore = await marginlyPool.discountedQuoteCollateral();
    const baseCollBefore = await marginlyPool.discountedBaseCollateral();

    const receiveQuoteAmount = (price * shortAmount) / FP96.one;
    await marginlyPool
      .connect(liquidator)
      .execute(CallType.ReceivePosition, receiveQuoteAmount, 0, price, false, shorter.address, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(liquidator.address);
    expect(positionAfter._type).to.be.eq(PositionType.Short);

    const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
    const quoteDelevCoeff = await marginlyPool.quoteDelevCoeff();

    const quoteCollAfter = await marginlyPool.discountedQuoteCollateral();
    const baseDebtAfter = await marginlyPool.discountedBaseDebt();
    const baseCollAfter = await marginlyPool.discountedBaseCollateral();

    expect(baseCollBefore).to.be.eq(baseCollAfter);
    expect(baseDebtBefore).to.be.eq(baseDebtAfter);
    expect(positionBefore.discountedBaseAmount).to.be.eq(positionBefore.discountedBaseAmount);

    const realQuoteCollBefore =
      (quoteCollateralCoeff * quoteCollBefore) / FP96.one - (quoteDelevCoeff * baseDebtBefore) / FP96.one;
    const realQuoteCollAfter =
      (quoteCollateralCoeff * quoteCollAfter) / FP96.one - (quoteDelevCoeff * baseDebtAfter) / FP96.one;
    expect(realQuoteCollAfter - realQuoteCollBefore).to.be.closeTo(receiveQuoteAmount, receiveQuoteAmount / 1000n);

    const posRealQuoteCollBefore =
      (quoteCollateralCoeff * positionBefore.discountedQuoteAmount) / FP96.one -
      (quoteDelevCoeff * positionBefore.discountedBaseAmount) / FP96.one;
    const posRealQuoteCollAfter =
      (quoteCollateralCoeff * positionAfter.discountedQuoteAmount) / FP96.one -
      (quoteDelevCoeff * positionBefore.discountedBaseAmount) / FP96.one;
    expect(posRealQuoteCollAfter - posRealQuoteCollBefore).to.be.closeTo(
      receiveQuoteAmount,
      receiveQuoteAmount / 1000n
    );
  });

  it('receive long position after deleverage, increasing collateral', async () => {
    const { marginlyPool, factoryOwner } = await loadFixture(getDeleveragedPool);

    const [_, lender, longer, liquidator] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    const params = await marginlyPool.params();
    let newParams = {
      maxLeverage: params.maxLeverage,
      interestRate: 0n,
      fee: 0n,
      swapFee: 0n,
      mcSlippage: params.mcSlippage,
      positionMinAmount: params.positionMinAmount,
      quoteLimit: params.quoteLimit,
    };
    await marginlyPool.connect(factoryOwner).setParameters(newParams);

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const depositBaseAmount = 1000n;
    // (baseDeposit + longAmount) / baseDeposit = (maxLev - 1)
    // shortAmount = (maxLev - 2) * quoteDeposit
    const longAmount = (params.maxLeverage - 2n) * depositBaseAmount;
    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, depositBaseAmount, longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

    newParams = {
      maxLeverage: newParams.maxLeverage / 2n,
      interestRate: params.interestRate,
      fee: params.fee,
      swapFee: params.swapFee,
      mcSlippage: params.mcSlippage,
      positionMinAmount: params.positionMinAmount,
      quoteLimit: params.quoteLimit,
    };
    await marginlyPool.connect(factoryOwner).setParameters(newParams);

    const positionBefore = await marginlyPool.positions(longer.address);
    const quoteDebtBefore = await marginlyPool.discountedQuoteDebt();
    const baseCollBefore = await marginlyPool.discountedBaseCollateral();
    const quoteCollBefore = await marginlyPool.discountedQuoteCollateral();

    const receiveBaseAmount = longAmount;
    await marginlyPool
      .connect(liquidator)
      .execute(CallType.ReceivePosition, 0, receiveBaseAmount, price, false, longer.address, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(liquidator.address);
    expect(positionAfter._type).to.be.eq(PositionType.Long);

    const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
    const baseDelevCoeff = await marginlyPool.baseDelevCoeff();

    const baseCollAfter = await marginlyPool.discountedBaseCollateral();
    const quoteDebtAfter = await marginlyPool.discountedQuoteDebt();
    const quoteCollAfter = await marginlyPool.discountedQuoteCollateral();

    expect(quoteCollAfter).to.be.eq(quoteCollBefore);
    expect(quoteDebtAfter).to.be.eq(quoteDebtBefore);
    expect(positionAfter.discountedQuoteAmount).to.be.eq(positionBefore.discountedQuoteAmount);

    const realBaseCollBefore =
      (baseCollateralCoeff * baseCollBefore) / FP96.one - (baseDelevCoeff * quoteDebtBefore) / FP96.one;
    const realBaseCollAfter =
      (baseCollateralCoeff * baseCollAfter) / FP96.one - (baseDelevCoeff * quoteDebtAfter) / FP96.one;
    expect(realBaseCollAfter - realBaseCollBefore).to.be.closeTo(receiveBaseAmount, receiveBaseAmount / 1000n);

    const posRealBaseCollBefore =
      (baseCollateralCoeff * positionBefore.discountedBaseAmount) / FP96.one -
      (baseDelevCoeff * positionBefore.discountedQuoteAmount) / FP96.one;
    const posRealBaseCollAfter =
      (baseCollateralCoeff * positionAfter.discountedBaseAmount) / FP96.one -
      (baseDelevCoeff * positionAfter.discountedQuoteAmount) / FP96.one;
    expect(posRealBaseCollAfter - posRealBaseCollBefore).to.be.closeTo(receiveBaseAmount, receiveBaseAmount / 1000n);
  });
});
