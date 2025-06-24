import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { MarginlyRouter, TestERC20Token, TestStableSwap2EMAOraclePool } from '../../typechain-types';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { createCurveAdapter, createCurveAdapterInverse } from './shared/fixtures';
import { constructSwap, Dex, SWAP_ONE } from './shared/utils';
import { parseUnits } from 'ethers';

const ONE = parseUnits('1', 18);

async function swapExactInput(
  pool: TestStableSwap2EMAOraclePool,
  router: MarginlyRouter,
  signer: SignerWithAddress,
  price: bigint,
  token0: TestERC20Token,
  token1: TestERC20Token,
  amountIn: bigint,
  minAmountOut: bigint,
  zeroToOne: boolean
) {
  await pool.setPrice(price);
  if (zeroToOne) {
    await token0.connect(signer).approve(router, amountIn);
  } else {
    await token1.connect(signer).approve(router, amountIn);
  }

  const swapCalldata = constructSwap([Dex.Curve], [BigInt(SWAP_ONE)]);
  await router.swapExactInput(
    swapCalldata,
    zeroToOne ? token0 : token1,
    zeroToOne ? token1 : token0,
    amountIn,
    minAmountOut
  );
}

async function swapExactOutput(
  pool: TestStableSwap2EMAOraclePool,
  router: MarginlyRouter,
  signer: SignerWithAddress,
  price: bigint,
  token0: TestERC20Token,
  token1: TestERC20Token,
  maxAmountIn: bigint,
  amountOut: bigint,
  zeroToOne: boolean
) {
  await pool.setPrice(price);
  if (zeroToOne) {
    await token0.connect(signer).approve(router, maxAmountIn);
  } else {
    await token1.connect(signer).approve(router, maxAmountIn);
  }

  const swapCalldata = constructSwap([Dex.Curve], [BigInt(SWAP_ONE)]);
  await router.swapExactOutput(
    swapCalldata,
    zeroToOne ? token0 : token1,
    zeroToOne ? token1 : token0,
    maxAmountIn,
    amountOut
  );
}

describe('Curve adapter', () => {
  it('swapExactInput token0 to token1', async () => {
    const [owner] = await ethers.getSigners();
    const { router, pool, token0, token1 } = await loadFixture(createCurveAdapter);

    // 1.0 TK1 = 2.0 TK0
    const price = parseUnits('2', 18);
    const amountIn = parseUnits('0.1', 18); // 0.1 TK0
    const minAmountOut = (amountIn * ONE) / price; // 0.05 TK1

    const token0BalanceBefore = await token0.balanceOf(owner);
    const token1BalanceBefore = await token1.balanceOf(owner);

    await swapExactInput(pool, router, owner, price, token0, token1, amountIn, minAmountOut, true);

    const token0BalanceAfter = await token0.balanceOf(owner);
    const token1BalanceAfter = await token1.balanceOf(owner);

    expect(token0BalanceAfter).to.be.equal(token0BalanceBefore - amountIn);
    expect(token1BalanceAfter).to.be.equal(token1BalanceBefore + minAmountOut);
  });

  it('swapExactInput token1 to token0', async () => {
    const [owner] = await ethers.getSigners();
    const { router, pool, token0, token1 } = await loadFixture(createCurveAdapter);

    // 1.0 TK1 = 2.0 TK0
    const price = parseUnits('2', 18);
    const amountIn = parseUnits('0.1', 18); // 0.1 TK1
    const minAmountOut = (amountIn * price) / ONE; // 0.2 TK0

    const token0BalanceBefore = await token0.balanceOf(owner);
    const token1BalanceBefore = await token1.balanceOf(owner);

    await swapExactInput(pool, router, owner, price, token0, token1, amountIn, minAmountOut, false);

    const token0BalanceAfter = await token0.balanceOf(owner);
    const token1BalanceAfter = await token1.balanceOf(owner);

    expect(token1BalanceAfter).to.be.equal(token1BalanceBefore - amountIn);
    expect(token0BalanceAfter).to.be.equal(token0BalanceBefore + minAmountOut);
  });

  it('swapExactOutput token0 to token1', async () => {
    const [owner] = await ethers.getSigners();
    const { router, pool, token0, token1 } = await loadFixture(createCurveAdapter);

    // 1.0 TK1 = 2.0 TK0
    const price = parseUnits('2', 18);
    const amountOut = parseUnits('0.1', 18); // 0.1 TK1
    const maxAmountIn = (amountOut * price) / ONE; // 0.05 TK1

    const token0BalanceBefore = await token0.balanceOf(owner);
    const token1BalanceBefore = await token1.balanceOf(owner);

    await swapExactOutput(pool, router, owner, price, token0, token1, maxAmountIn, amountOut, true);

    const token0BalanceAfter = await token0.balanceOf(owner);
    const token1BalanceAfter = await token1.balanceOf(owner);

    expect(token0BalanceAfter).to.be.equal(token0BalanceBefore - maxAmountIn);
    expect(token1BalanceAfter).to.be.equal(token1BalanceBefore + amountOut);
  });

  it('swapExactOutput token1 to token0', async () => {
    const [owner] = await ethers.getSigners();
    const { router, pool, token0, token1 } = await loadFixture(createCurveAdapter);

    // 1.0 TK1 = 2.0 TK0
    const price = parseUnits('2', 18);
    const amountOut = parseUnits('0.1', 18); // 0.1 TK0
    const maxAmountIn = (amountOut * ONE) / price; // 0.2 TK1

    const token0BalanceBefore = await token0.balanceOf(owner);
    const token1BalanceBefore = await token1.balanceOf(owner);

    await swapExactOutput(pool, router, owner, price, token0, token1, maxAmountIn, amountOut, false);

    const token0BalanceAfter = await token0.balanceOf(owner);
    const token1BalanceAfter = await token1.balanceOf(owner);

    expect(token1BalanceAfter).to.be.equal(token1BalanceBefore - maxAmountIn);
    expect(token0BalanceAfter).to.be.equal(token0BalanceBefore + amountOut);
  });

  it('inverse: swapExactInput token0 to token1', async () => {
    const [owner] = await ethers.getSigners();
    const { router, pool, token0, token1 } = await loadFixture(createCurveAdapterInverse);

    // 1.0 TK1 = 2.0 TK0
    const price = parseUnits('2', 18);
    const amountIn = parseUnits('0.1', 18); // 0.1 TK0
    const minAmountOut = (amountIn * ONE) / price; // 0.05 TK1

    const token0BalanceBefore = await token0.balanceOf(owner);
    const token1BalanceBefore = await token1.balanceOf(owner);

    await swapExactInput(pool, router, owner, price, token0, token1, amountIn, minAmountOut, true);

    const token0BalanceAfter = await token0.balanceOf(owner);
    const token1BalanceAfter = await token1.balanceOf(owner);

    expect(token0BalanceAfter).to.be.equal(token0BalanceBefore - amountIn);
    expect(token1BalanceAfter).to.be.equal(token1BalanceBefore + minAmountOut);
  });

  it('inverse: swapExactInput token1 to token0', async () => {
    const [owner] = await ethers.getSigners();
    const { router, pool, token0, token1 } = await loadFixture(createCurveAdapterInverse);

    // 1.0 TK1 = 2.0 TK0
    const price = parseUnits('2', 18);
    const amountIn = parseUnits('0.1', 18); // 0.1 TK1
    const minAmountOut = (amountIn * price) / ONE; // 0.2 TK0

    const token0BalanceBefore = await token0.balanceOf(owner);
    const token1BalanceBefore = await token1.balanceOf(owner);

    await swapExactInput(pool, router, owner, price, token0, token1, amountIn, minAmountOut, false);

    const token0BalanceAfter = await token0.balanceOf(owner);
    const token1BalanceAfter = await token1.balanceOf(owner);

    expect(token1BalanceAfter).to.be.equal(token1BalanceBefore - amountIn);
    expect(token0BalanceAfter).to.be.equal(token0BalanceBefore + minAmountOut);
  });

  it('inverse: swapExactOutput token0 to token1', async () => {
    const [owner] = await ethers.getSigners();
    const { router, pool, token0, token1 } = await loadFixture(createCurveAdapterInverse);

    // 1.0 TK1 = 2.0 TK0
    const price = parseUnits('2', 18);
    const amountOut = parseUnits('0.1', 18); // 0.1 TK1
    const maxAmountIn = (amountOut * price) / ONE; // 0.05 TK1

    const token0BalanceBefore = await token0.balanceOf(owner);
    const token1BalanceBefore = await token1.balanceOf(owner);

    await swapExactOutput(pool, router, owner, price, token0, token1, maxAmountIn, amountOut, true);

    const token0BalanceAfter = await token0.balanceOf(owner);
    const token1BalanceAfter = await token1.balanceOf(owner);

    expect(token0BalanceAfter).to.be.equal(token0BalanceBefore - maxAmountIn);
    expect(token1BalanceAfter).to.be.equal(token1BalanceBefore + amountOut);
  });

  it('inverse: swapExactOutput token1 to token0', async () => {
    const [owner] = await ethers.getSigners();
    const { router, pool, token0, token1 } = await loadFixture(createCurveAdapterInverse);

    // 1.0 TK1 = 2.0 TK0
    const price = parseUnits('2', 18);
    const amountOut = parseUnits('0.1', 18); // 0.1 TK0
    const maxAmountIn = (amountOut * ONE) / price; // 0.2 TK1

    const token0BalanceBefore = await token0.balanceOf(owner);
    const token1BalanceBefore = await token1.balanceOf(owner);

    await swapExactOutput(pool, router, owner, price, token0, token1, maxAmountIn, amountOut, false);

    const token0BalanceAfter = await token0.balanceOf(owner);
    const token1BalanceAfter = await token1.balanceOf(owner);

    expect(token1BalanceAfter).to.be.equal(token1BalanceBefore - maxAmountIn);
    expect(token0BalanceAfter).to.be.equal(token0BalanceBefore + amountOut);
  });
});
