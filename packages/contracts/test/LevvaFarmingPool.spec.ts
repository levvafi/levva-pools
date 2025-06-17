import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { createLevvaFarmingPool } from './shared/fixtures';
import { ethers } from 'hardhat';
import { CallType, PositionType, uniswapV3Swapdata } from './shared/utils';
import { ZeroAddress } from 'ethers';

describe('Levva Farming pool', () => {
  it('Short forbidden', async () => {
    const { marginlyPool } = await loadFixture(createLevvaFarmingPool);
    const [_, lender, user] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;
    const amount = 10_000n;

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, 100n * amount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await expect(
      marginlyPool
        .connect(user)
        .execute(CallType.DepositQuote, amount, amount, price, false, ZeroAddress, uniswapV3Swapdata())
    ).to.be.revertedWithCustomError(marginlyPool, 'ShortUnavailable');

    await marginlyPool
      .connect(user)
      .execute(CallType.DepositQuote, amount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await expect(
      marginlyPool.connect(user).execute(CallType.Short, amount, 0, price, false, ZeroAddress, uniswapV3Swapdata())
    ).to.be.revertedWithCustomError(marginlyPool, 'ShortUnavailable');
  });

  it('Close long position and withdraw', async () => {
    const { marginlyPool, baseContract } = await loadFixture(createLevvaFarmingPool);
    const [_, lender, user] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;
    const amount = 10_000n;

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 100n * amount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await marginlyPool
      .connect(user)
      .execute(CallType.DepositBase, amount, amount, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionBefore = await marginlyPool.positions(user);

    expect(positionBefore._type).to.be.eq(PositionType.Long);
    expect(positionBefore.discountedBaseAmount).to.be.gt(0);
    expect(positionBefore.discountedQuoteAmount).to.be.gt(0);

    const balanceBefore = await baseContract.balanceOf(user);

    await marginlyPool
      .connect(user)
      .execute(CallType.ClosePosition, 0, 0, price, true, ZeroAddress, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(user);

    expect(positionAfter._type).to.be.eq(PositionType.Uninitialized);
    expect(positionAfter.discountedBaseAmount).to.be.eq(0);
    expect(positionAfter.discountedQuoteAmount).to.be.eq(0);

    const balanceAfter = await baseContract.balanceOf(user);
    expect(balanceAfter).to.be.gt(balanceBefore);
  });

  it('Sell collateral long position and withdraw', async () => {
    const { marginlyPool, quoteContract } = await loadFixture(createLevvaFarmingPool);
    const [_, lender, user] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;
    const amount = 10_000n;

    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, 100n * amount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    await marginlyPool
      .connect(user)
      .execute(CallType.DepositBase, amount, amount, price, false, ZeroAddress, uniswapV3Swapdata());

    const positionBefore = await marginlyPool.positions(user);

    expect(positionBefore._type).to.be.eq(PositionType.Long);
    expect(positionBefore.discountedBaseAmount).to.be.gt(0);
    expect(positionBefore.discountedQuoteAmount).to.be.gt(0);

    const balanceBefore = await quoteContract.balanceOf(user);

    await marginlyPool
      .connect(user)
      .execute(CallType.SellCollateral, 0, 0, price, true, ZeroAddress, uniswapV3Swapdata());

    const positionAfter = await marginlyPool.positions(user);

    expect(positionAfter._type).to.be.eq(PositionType.Uninitialized);
    expect(positionAfter.discountedBaseAmount).to.be.eq(0);
    expect(positionAfter.discountedQuoteAmount).to.be.eq(0);

    const balanceAfter = await quoteContract.balanceOf(user);
    expect(balanceAfter).to.be.gt(balanceBefore);
  });
});
