import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { createMarginlyRouter } from '../shared/fixtures';
import { ethers } from 'hardhat';
import { constructSwap, Dex, SWAP_ONE } from '../shared/utils';
import { AdapterStorage__factory } from '../../typechain-types';
import { AbiCoder } from 'ethers';

describe('MarginlyRouter UniswapV3', () => {
  it('swapExactInput 0 to 1, success', async () => {
    const { marginlyRouter, token0, token1, uniswapV3 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(amountToSwap);
    expect(await token1.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.UniswapV3], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactInput(swapCalldata, token0, token1, amountToSwap, 0);

    expect(await uniswapV3.pool.debugZeroForOne()).to.be.true;
    expect(await uniswapV3.pool.debugExactInput()).to.be.true;

    const price = await uniswapV3.pool.price();

    expect(await token0.balanceOf(user)).to.be.equal(0);
    expect(await token1.balanceOf(user)).to.be.equal(price * amountToSwap);
  });

  it('swapExactInput 0 to 1, less than minimal amount', async () => {
    const { marginlyRouter, token0, token1, uniswapV3 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);

    const price = await uniswapV3.pool.price();
    const amountToGetPlusOne = price * amountToSwap + 1n;

    const swapCalldata = constructSwap([Dex.UniswapV3], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactInput(swapCalldata, token0, token1, amountToSwap, amountToGetPlusOne)
    ).to.be.revertedWithCustomError(uniswapV3.adapter, 'InsufficientAmount');
  });

  it('swapExactInput 1 to 0, success', async () => {
    const { marginlyRouter, token0, token1, uniswapV3 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token1.mint(user, amountToSwap);
    await token1.connect(user).approve(marginlyRouter, amountToSwap);
    expect(await token1.balanceOf(user)).to.be.equal(amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.UniswapV3], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactInput(swapCalldata, token1, token0, amountToSwap, 0);
    expect(await uniswapV3.pool.debugZeroForOne()).to.be.false;
    expect(await uniswapV3.pool.debugExactInput()).to.be.true;
    const price = await uniswapV3.pool.price();

    expect(await token1.balanceOf(user)).to.be.equal(0);
    expect(await token0.balanceOf(user)).to.be.equal(amountToSwap / price);
  });

  it('swapExactInput 1 to 0, less than minimal amount', async () => {
    const { marginlyRouter, token0, token1, uniswapV3 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token1.mint(user, amountToSwap);
    await token1.connect(user).approve(marginlyRouter, amountToSwap);

    const price = await uniswapV3.pool.price();
    const amountToGetPlusOne = amountToSwap / price + 1n;

    const swapCalldata = constructSwap([Dex.UniswapV3], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactInput(swapCalldata, token1, token0, amountToSwap, amountToGetPlusOne)
    ).to.be.revertedWithCustomError(uniswapV3.adapter, 'InsufficientAmount');
  });

  it('swapExactOutput 0 to 1, success', async () => {
    const { marginlyRouter, token0, token1, uniswapV3 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await uniswapV3.pool.price();

    const amountToGet = 1000n;
    const amountTransferred = amountToGet / price;
    const initialAmount0 = amountTransferred * 100n;
    await token0.mint(user, initialAmount0);
    await token0.connect(user).approve(marginlyRouter, initialAmount0);

    expect(await token0.balanceOf(user)).to.be.equal(initialAmount0);
    expect(await token1.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.UniswapV3], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactOutput(swapCalldata, token0, token1, initialAmount0, amountToGet);

    expect(await uniswapV3.pool.debugZeroForOne()).to.be.true;
    expect(await uniswapV3.pool.debugExactInput()).to.be.false;

    expect(await token0.balanceOf(user)).to.be.equal(initialAmount0 - amountTransferred);
    expect(await token1.balanceOf(user)).to.be.equal(amountToGet);
  });

  it('swapExactOutput 0 to 1, more than maximal amount', async () => {
    const { marginlyRouter, token0, token1, uniswapV3 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await uniswapV3.pool.price();

    const amountToGet = 1000n;
    const amountToSwap = amountToGet / price;
    const initialAmount0 = amountToSwap * 100n;
    await token0.mint(user, initialAmount0);
    await token0.connect(user).approve(marginlyRouter, initialAmount0);

    const swapCalldata = constructSwap([Dex.UniswapV3], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactOutput(swapCalldata, token0, token1, amountToSwap - 1n, amountToGet)
    ).to.be.revertedWithCustomError(uniswapV3.adapter, 'TooMuchRequested');
  });

  it('swapExactOutput 1 to 0, success', async () => {
    const { marginlyRouter, token0, token1, uniswapV3 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await uniswapV3.pool.price();

    const amountToGet = 1000n;
    const amountToSwap = amountToGet * price;
    const initialAmount1 = amountToSwap * 100n;
    await token1.mint(user, initialAmount1);
    await token1.connect(user).approve(marginlyRouter, initialAmount1);
    expect(await token1.balanceOf(user)).to.be.equal(initialAmount1);
    expect(await token0.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.UniswapV3], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactOutput(swapCalldata, token1, token0, initialAmount1, amountToGet);

    expect(await uniswapV3.pool.debugZeroForOne()).to.be.false;
    expect(await uniswapV3.pool.debugExactInput()).to.be.false;

    expect(await token1.balanceOf(user)).to.be.equal(initialAmount1 - amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(amountToGet);
  });

  it('swapExactOutput 1 to 0, more than maximal amount', async () => {
    const { marginlyRouter, token0, token1, uniswapV3 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await uniswapV3.pool.price();

    const amountToGet = 1000n;
    const amountToSwap = amountToGet * price;
    const initialAmount1 = amountToSwap * 100n;
    await token1.mint(user, initialAmount1);
    await token1.connect(user).approve(marginlyRouter, initialAmount1);

    const swapCalldata = constructSwap([Dex.UniswapV3], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactOutput(swapCalldata, token1, token0, amountToSwap - 1n, amountToGet)
    ).to.be.revertedWithCustomError(uniswapV3.adapter, 'TooMuchRequested');
  });
});

describe('MarginlyRouter UniswapV2', () => {
  it('swapExactInput 0 to 1, success', async () => {
    const { marginlyRouter, token0, token1, uniswapV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(amountToSwap);
    expect(await token1.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.QuickSwap], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactInput(swapCalldata, token0, token1, amountToSwap, 0);

    const [reserve0, reserve1] = await uniswapV2.pool.getReserves();
    const amountToSwapWithFee = amountToSwap * 997n;
    const amountToGet = (reserve1 * amountToSwapWithFee) / (reserve0 * 1000n + amountToSwapWithFee);

    expect(await token0.balanceOf(user)).to.be.equal(0);
    expect(await token1.balanceOf(user)).to.be.equal(amountToGet);
  });

  it('swapExactInput 0 to 1, less than minimal amount', async () => {
    const { marginlyRouter, token0, token1, uniswapV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);

    const [reserve0, reserve1] = await uniswapV2.pool.getReserves();
    const amountToSwapWithFee = amountToSwap * 997n;
    const amountToGet = (reserve1 * amountToSwapWithFee) / (reserve0 * 1000n + amountToSwapWithFee);

    const swapCalldata = constructSwap([Dex.QuickSwap], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactInput(swapCalldata, token0, token1, amountToSwap, amountToGet + 1n)
    ).to.be.revertedWithCustomError(uniswapV2.adapter, 'InsufficientAmount');
  });

  it('swapExactInput 1 to 0, success', async () => {
    const { marginlyRouter, token0, token1, uniswapV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token1.mint(user, amountToSwap);
    await token1.connect(user).approve(marginlyRouter, amountToSwap);
    expect(await token1.balanceOf(user)).to.be.equal(amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.QuickSwap], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactInput(swapCalldata, token1, token0, amountToSwap, 0);
    const [reserve0, reserve1] = await uniswapV2.pool.getReserves();
    const amountToSwapWithFee = amountToSwap * 997n;
    const amountToGet = (reserve0 * amountToSwapWithFee) / (reserve1 * 1000n + amountToSwapWithFee);

    expect(await token1.balanceOf(user)).to.be.equal(0);
    expect(await token0.balanceOf(user)).to.be.equal(amountToGet);
  });

  it('swapExactInput 1 to 0, less than minimal amount', async () => {
    const { marginlyRouter, token0, token1, uniswapV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token1.mint(user, amountToSwap);
    await token1.connect(user).approve(marginlyRouter, amountToSwap);

    const [reserve0, reserve1] = await uniswapV2.pool.getReserves();
    const amountToSwapWithFee = amountToSwap * 997n;
    const amountToGet = (reserve0 * amountToSwapWithFee) / (reserve1 * 1000n + amountToSwapWithFee);

    const swapCalldata = constructSwap([Dex.QuickSwap], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactInput(swapCalldata, token1, token0, amountToSwap, amountToGet + 1n)
    ).to.be.revertedWithCustomError(uniswapV2.adapter, 'InsufficientAmount');
  });

  it('swapExactOutput 0 to 1, success', async () => {
    const { marginlyRouter, token0, token1, uniswapV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const [reserve0, reserve1] = await uniswapV2.pool.getReserves();
    const amountToGet = 1000n;
    const amountTransferred = (reserve0 * amountToGet * 1000n) / ((reserve1 - amountToGet) * 997n) + 1n;
    const initialAmount0 = amountTransferred * 100n;
    await token0.mint(user, initialAmount0);
    await token0.connect(user).approve(marginlyRouter, initialAmount0);

    expect(await token0.balanceOf(user)).to.be.equal(initialAmount0);
    expect(await token1.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.QuickSwap], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactOutput(swapCalldata, token0, token1, initialAmount0, amountToGet);

    expect(await token0.balanceOf(user)).to.be.equal(initialAmount0 - amountTransferred);
    expect(await token1.balanceOf(user)).to.be.equal(amountToGet);
  });

  it('swapExactOutput 0 to 1, more than maximal amount', async () => {
    const { marginlyRouter, token0, token1, uniswapV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const [reserve0, reserve1] = await uniswapV2.pool.getReserves();
    const amountToGet = 1000n;
    const amountTransferred = (reserve0 * amountToGet * 1000n) / ((reserve1 - amountToGet) * 997n) + 1n;

    const initialAmount0 = amountTransferred * 100n;
    await token0.mint(user, initialAmount0);
    await token0.connect(user).approve(marginlyRouter, initialAmount0);

    const swapCalldata = constructSwap([Dex.QuickSwap], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactOutput(swapCalldata, token0, token1, amountTransferred - 1n, amountToGet)
    ).to.be.revertedWithCustomError(uniswapV2.adapter, 'TooMuchRequested');
  });

  it('swapExactOutput 1 to 0, success', async () => {
    const { marginlyRouter, token0, token1, uniswapV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const [reserve0, reserve1] = await uniswapV2.pool.getReserves();
    const amountToGet = 1000n;
    const amountToSwap = (reserve1 * amountToGet * 1000n) / ((reserve0 - amountToGet) * 997n) + 1n;
    const initialAmount1 = amountToSwap * 100n;
    await token1.mint(user, initialAmount1);
    await token1.connect(user).approve(marginlyRouter, initialAmount1);
    expect(await token1.balanceOf(user)).to.be.equal(initialAmount1);
    expect(await token0.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.QuickSwap], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactOutput(swapCalldata, token1, token0, initialAmount1, amountToGet);

    expect(await token1.balanceOf(user)).to.be.equal(initialAmount1 - amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(amountToGet);
  });

  it('swapExactOutput 1 to 0, more than maximal amount', async () => {
    const { marginlyRouter, token0, token1, uniswapV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const [reserve0, reserve1] = await uniswapV2.pool.getReserves();
    const amountToGet = 1000n;
    const amountToSwap = (reserve1 * amountToGet * 1000n) / ((reserve0 - amountToGet) * 997n) + 1n;

    const initialAmount1 = amountToSwap * 100n;
    await token1.mint(user, initialAmount1);
    await token1.connect(user).approve(marginlyRouter, initialAmount1);

    const swapCalldata = constructSwap([Dex.QuickSwap], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactOutput(swapCalldata, token1, token0, amountToSwap - 1n, amountToGet)
    ).to.be.revertedWithCustomError(uniswapV2.adapter, 'TooMuchRequested');
  });
});

describe('MarginlyRouter Balancer Vault', () => {
  it('swapExactInput 0 to 1, success', async () => {
    const { marginlyRouter, token0, token1, balancer } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(amountToSwap);
    expect(await token1.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.Balancer], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactInput(swapCalldata, token0, token1, amountToSwap, 0);

    const price = await balancer.vault.price();

    expect(await token0.balanceOf(user)).to.be.equal(0);
    expect(await token1.balanceOf(user)).to.be.equal(price * amountToSwap);
  });

  it('swapExactInput 0 to 1, less than minimal amount', async () => {
    const { marginlyRouter, token0, token1, balancer } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);

    const price = await balancer.vault.price();
    const amountToGetPlusOne = price * amountToSwap + 1n;

    const swapCalldata = constructSwap([Dex.Balancer], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactInput(swapCalldata, token0, token1, amountToSwap, amountToGetPlusOne)
    ).to.be.revertedWith('SWAP_LIMIT');
  });

  it('swapExactInput 1 to 0, success', async () => {
    const { marginlyRouter, token0, token1, balancer } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token1.mint(user, amountToSwap);
    await token1.connect(user).approve(marginlyRouter, amountToSwap);
    expect(await token1.balanceOf(user)).to.be.equal(amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.Balancer], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactInput(swapCalldata, token1, token0, amountToSwap, 0);
    const price = await balancer.vault.price();

    expect(await token1.balanceOf(user)).to.be.equal(0);
    expect(await token0.balanceOf(user)).to.be.equal(amountToSwap / price);
  });

  it('swapExactInput 1 to 0, less than minimal amount', async () => {
    const { marginlyRouter, token0, token1, balancer } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token1.mint(user, amountToSwap);
    await token1.connect(user).approve(marginlyRouter, amountToSwap);

    const price = await balancer.vault.price();
    const amountToGetPlusOne = amountToSwap / price + 1n;

    const swapCalldata = constructSwap([Dex.Balancer], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactInput(swapCalldata, token1, token0, amountToSwap, amountToGetPlusOne)
    ).to.be.revertedWith('SWAP_LIMIT');
  });

  it('swapExactOutput 0 to 1, success', async () => {
    const { marginlyRouter, token0, token1, balancer } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await balancer.vault.price();

    const amountToGet = 1000n;
    const amountTransferred = amountToGet / price;
    const initialAmount0 = amountTransferred * 100n;
    await token0.mint(user, initialAmount0);
    await token0.connect(user).approve(marginlyRouter, initialAmount0);

    expect(await token0.balanceOf(user)).to.be.equal(initialAmount0);
    expect(await token1.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.Balancer], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactOutput(swapCalldata, token0, token1, initialAmount0, amountToGet);

    expect(await token0.balanceOf(user)).to.be.equal(initialAmount0 - amountTransferred);
    expect(await token1.balanceOf(user)).to.be.equal(amountToGet);
  });

  it('swapExactOutput 0 to 1, more than maximal amount', async () => {
    const { marginlyRouter, token0, token1, balancer } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await balancer.vault.price();

    const amountToGet = 1000n;
    const amountToSwap = amountToGet / price;
    const initialAmount0 = amountToSwap * 100n;
    await token0.mint(user, initialAmount0);
    await token0.connect(user).approve(marginlyRouter, initialAmount0);

    const swapCalldata = constructSwap([Dex.Balancer], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactOutput(swapCalldata, token0, token1, amountToSwap - 1n, amountToGet)
    ).to.be.revertedWith('SWAP_LIMIT');
  });

  it('swapExactOutput 1 to 0, success', async () => {
    const { marginlyRouter, token0, token1, balancer } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await balancer.vault.price();

    const amountToGet = 1000n;
    const amountToSwap = amountToGet * price;
    const initialAmount1 = amountToSwap * 100n;
    await token1.mint(user, initialAmount1);
    await token1.connect(user).approve(marginlyRouter, initialAmount1);
    expect(await token1.balanceOf(user)).to.be.equal(initialAmount1);
    expect(await token0.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.Balancer], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactOutput(swapCalldata, token1, token0, initialAmount1, amountToGet);

    expect(await token1.balanceOf(user)).to.be.equal(initialAmount1 - amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(amountToGet);
  });

  it('swapExactOutput 1 to 0, more than maximal amount', async () => {
    const { marginlyRouter, token0, token1, balancer } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await balancer.vault.price();

    const amountToGet = 1000n;
    const amountToSwap = amountToGet * price;
    const initialAmount1 = amountToSwap * 100n;
    await token1.mint(user, initialAmount1);
    await token1.connect(user).approve(marginlyRouter, initialAmount1);

    const swapCalldata = constructSwap([Dex.Balancer], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactOutput(swapCalldata, token1, token0, amountToSwap - 1n, amountToGet)
    ).to.be.revertedWith('SWAP_LIMIT');
  });
});

describe('MarginlyRouter WooFi', () => {
  it('swapExactInput 0 to 1, success', async () => {
    const { marginlyRouter, token0, token1, wooFi } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(amountToSwap);
    expect(await token1.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.Woofi], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactInput(swapCalldata, token0, token1, amountToSwap, 0);

    const price0 = (await wooFi.pool.getTokenState(token0)).price;
    const price1 = (await wooFi.pool.getTokenState(token1)).price;

    expect(await token0.balanceOf(user)).to.be.equal(0);
    const expectedAmount = (price0 * amountToSwap) / price1 - 2n;
    expect(await token1.balanceOf(user)).to.be.equal(expectedAmount);
  });

  it('swapExactInput 0 to 1, less than minimal amount', async () => {
    const { marginlyRouter, token0, token1, wooFi } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);

    const price0 = (await wooFi.pool.getTokenState(token0)).price;
    const price1 = (await wooFi.pool.getTokenState(token1)).price;
    const amountToGetPlusOne = (price0 * amountToSwap) / price1 + 1n;

    const swapCalldata = constructSwap([Dex.Woofi], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactInput(swapCalldata, token0, token1, amountToSwap, amountToGetPlusOne)
    ).to.be.revertedWith('WooPPV2: base2Amount_LT_minBase2Amount');
  });

  it('swapExactInput 1 to 0, success', async () => {
    const { marginlyRouter, token0, token1, wooFi } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token1.mint(user, amountToSwap);
    await token1.connect(user).approve(marginlyRouter, amountToSwap);
    expect(await token1.balanceOf(user)).to.be.equal(amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.Woofi], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactInput(swapCalldata, token1, token0, amountToSwap, 0);
    const price0 = (await wooFi.pool.getTokenState(token0)).price;
    const price1 = (await wooFi.pool.getTokenState(token1)).price;

    expect(await token1.balanceOf(user)).to.be.equal(0);
    const expectedAmount = (price1 * amountToSwap) / price0 - 2n;
    expect(await token0.balanceOf(user)).to.be.equal(expectedAmount);
  });

  it('swapExactInput 1 to 0, less than minimal amount', async () => {
    const { marginlyRouter, token0, token1, wooFi } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token1.mint(user, amountToSwap);
    await token1.connect(user).approve(marginlyRouter, amountToSwap);

    const price0 = (await wooFi.pool.getTokenState(token0)).price;
    const price1 = (await wooFi.pool.getTokenState(token1)).price;

    const amountToGetPlusOne = (price1 * amountToSwap) / price0 + 1n;

    const swapCalldata = constructSwap([Dex.Woofi], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactInput(swapCalldata, token1, token0, amountToSwap, amountToGetPlusOne)
    ).to.be.revertedWith('WooPPV2: base2Amount_LT_minBase2Amount');
  });

  it('swapExactOutput 0 to 1', async () => {
    const { marginlyRouter, token0, token1, wooFi } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price0 = (await wooFi.pool.getTokenState(token0)).price;
    const price1 = (await wooFi.pool.getTokenState(token1)).price;

    const amountToGet = 1000n;
    const amountTransferred = (((price1 * amountToGet) / price0) * 105n) / 100n;
    const initialAmount0 = amountTransferred * 100n;
    await token0.mint(user, initialAmount0);
    await token0.connect(user).approve(marginlyRouter, initialAmount0);

    expect(await token0.balanceOf(user)).to.be.equal(initialAmount0);
    expect(await token1.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.Woofi], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactOutput(swapCalldata, token0, token1, amountTransferred, amountToGet);

    expect(await token0.balanceOf(user)).to.be.lt(initialAmount0);
    expect(await token0.balanceOf(user)).to.be.gt(initialAmount0 - amountTransferred);
    expect(await token1.balanceOf(user)).to.be.equal(amountToGet);
  });

  it('swapExactOutput 1 to 0', async () => {
    const { marginlyRouter, token0, token1, wooFi } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price0 = (await wooFi.pool.getTokenState(token0)).price;
    const price1 = (await wooFi.pool.getTokenState(token1)).price;

    const amountToGet = 1000n;
    const amountTransferred = (((price0 * amountToGet) / price1) * 105n) / 100n;
    const initialAmount1 = amountTransferred * 100n;
    await token1.mint(user, initialAmount1);
    await token1.connect(user).approve(marginlyRouter, amountTransferred);

    expect(await token0.balanceOf(user)).to.be.equal(0);
    expect(await token1.balanceOf(user)).to.be.equal(initialAmount1);

    const swapCalldata = constructSwap([Dex.Woofi], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactOutput(swapCalldata, token1, token0, amountTransferred, amountToGet);

    expect(await token0.balanceOf(user)).to.be.equal(amountToGet);
    expect(await token1.balanceOf(user)).to.be.lt(initialAmount1);
    expect(await token1.balanceOf(user)).to.be.gt(initialAmount1 - amountTransferred);
  });
});

describe('MarginlyRouter DodoV1', () => {
  it('swapExactInput 0 to 1, success', async () => {
    const { marginlyRouter, token0, token1, dodoV1 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(amountToSwap);
    expect(await token1.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.DodoV1], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactInput(swapCalldata, token0, token1, amountToSwap, 0);

    const price = await dodoV1.pool._BASE_TO_QUOTE_PRICE_();

    expect(await token0.balanceOf(user)).to.be.equal(0);
    const expectedAmount = price * amountToSwap;
    expect(await token1.balanceOf(user)).to.be.equal(expectedAmount);
  });

  it('swapExactInput 0 to 1, less than minimal amount', async () => {
    const { marginlyRouter, token0, token1, dodoV1 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);

    const price = await dodoV1.pool._BASE_TO_QUOTE_PRICE_();
    const amountToGetPlusOne = price * amountToSwap + 1n;

    const swapCalldata = constructSwap([Dex.DodoV1], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactInput(swapCalldata, token0, token1, amountToSwap, amountToGetPlusOne)
    ).to.be.revertedWith('SELL_BASE_RECEIVE_NOT_ENOUGH');
  });

  it('swapExactInput 1 to 0, success', async () => {
    const { marginlyRouter, token0, token1, dodoV1 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await dodoV1.pool._BASE_TO_QUOTE_PRICE_();
    const amountToSwap = 1000n;
    const minAmountOut = (amountToSwap * 9n) / 10n / price;

    const token0BalanceBefore = await token0.balanceOf(dodoV1.pool);
    const token1BalanceBefore = await token0.balanceOf(dodoV1.pool);

    await token1.mint(user, amountToSwap);
    await token1.connect(user).approve(marginlyRouter, amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(0);
    expect(await token1.balanceOf(user)).to.be.equal(amountToSwap);

    const swapCalldata = constructSwap([Dex.DodoV1], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactInput(swapCalldata, token1, token0, amountToSwap, minAmountOut);

    expect(await token1.balanceOf(user)).to.be.equal(0);
    const expectedAmount = amountToSwap / price;
    expect(await token0.balanceOf(user)).to.be.equal(expectedAmount);

    expect(await token0.balanceOf(dodoV1.pool)).to.be.not.equal(token0BalanceBefore);
    expect(await token1.balanceOf(dodoV1.pool)).to.be.not.equal(token1BalanceBefore);
  });

  it('swapExactInput 1 to 0, less than minimal amount', async () => {
    const { marginlyRouter, token0, token1, dodoV1 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token1.mint(user, amountToSwap);
    await token1.connect(user).approve(marginlyRouter, amountToSwap);

    const price = await dodoV1.pool._BASE_TO_QUOTE_PRICE_();
    const amountToGetPlusOne = amountToSwap / price + 1n;

    const swapCalldata = constructSwap([Dex.DodoV1], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactInput(swapCalldata, token1, token0, amountToSwap, amountToGetPlusOne)
    ).to.be.revertedWith('BUY_BASE_COST_TOO_MUCH');
  });

  it('swapExactOutput 0 to 1', async () => {
    const { marginlyRouter, token0, token1, dodoV1 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await dodoV1.pool._BASE_TO_QUOTE_PRICE_();

    const amountToGet = 1000n;
    const amountTransferred = ((amountToGet / price) * 105n) / 100n;
    const initialAmount0 = amountTransferred * 100n;
    await token0.mint(user, initialAmount0);
    await token0.connect(user).approve(marginlyRouter, initialAmount0);

    expect(await token0.balanceOf(user)).to.be.equal(initialAmount0);
    expect(await token1.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.DodoV1], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactOutput(swapCalldata, token0, token1, amountTransferred, amountToGet);

    expect(await token0.balanceOf(user)).to.be.lt(initialAmount0);
    expect(await token0.balanceOf(user)).to.be.gt(initialAmount0 - amountTransferred);
    expect(await token1.balanceOf(user)).to.be.equal(amountToGet);
  });

  it('swapExactOutput 1 to 0', async () => {
    const { marginlyRouter, token0, token1, dodoV1 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await dodoV1.pool._BASE_TO_QUOTE_PRICE_();

    const amountToGet = 1000n;
    const amountTransferred = (price * amountToGet * 105n) / 100n;
    const initialAmount1 = amountTransferred * 100n;
    await token1.mint(user, initialAmount1);
    await token1.connect(user).approve(marginlyRouter, amountTransferred);

    expect(await token0.balanceOf(user)).to.be.equal(0);
    expect(await token1.balanceOf(user)).to.be.equal(initialAmount1);

    const swapCalldata = constructSwap([Dex.DodoV1], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactOutput(swapCalldata, token1, token0, amountTransferred, amountToGet);

    expect(await token0.balanceOf(user)).to.be.equal(amountToGet);
    expect(await token1.balanceOf(user)).to.be.lt(initialAmount1);
    expect(await token1.balanceOf(user)).to.be.gt(initialAmount1 - amountTransferred);
  });
});

describe('MarginlyRouter DodoV2', () => {
  it('swapExactInput 0 to 1, success', async () => {
    const { marginlyRouter, token0, token1, dodoV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(amountToSwap);
    expect(await token1.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.DodoV2], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactInput(swapCalldata, token0, token1, amountToSwap, 0);

    const price = await dodoV2.pool._BASE_TO_QUOTE_PRICE_();

    expect(await token0.balanceOf(user)).to.be.equal(0);
    const expectedAmount = price * amountToSwap;
    expect(await token1.balanceOf(user)).to.be.equal(expectedAmount);
  });

  it('swapExactInput 0 to 1, less than minimal amount', async () => {
    const { marginlyRouter, token0, token1, dodoV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);

    const price = await dodoV2.pool._BASE_TO_QUOTE_PRICE_();
    const amountToGetPlusOne = price * amountToSwap + 1n;

    const swapCalldata = constructSwap([Dex.DodoV2], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactInput(swapCalldata, token0, token1, amountToSwap, amountToGetPlusOne)
    ).to.be.revertedWithCustomError(dodoV2.adapter, 'InsufficientAmount');
  });

  it('swapExactInput 1 to 0, success', async () => {
    const { marginlyRouter, token0, token1, dodoV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token1.mint(user, amountToSwap);
    await token1.connect(user).approve(marginlyRouter, amountToSwap);
    expect(await token0.balanceOf(user)).to.be.equal(0);
    expect(await token1.balanceOf(user)).to.be.equal(amountToSwap);

    const swapCalldata = constructSwap([Dex.DodoV2], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactInput(swapCalldata, token1, token0, amountToSwap, 0);

    const price = await dodoV2.pool._BASE_TO_QUOTE_PRICE_();

    expect(await token1.balanceOf(user)).to.be.equal(0);
    const expectedAmount = amountToSwap / price;
    expect(await token0.balanceOf(user)).to.be.equal(expectedAmount);
  });

  it('swapExactInput 1 to 0, less than minimal amount', async () => {
    const { marginlyRouter, token0, token1, dodoV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const amountToSwap = 1000n;
    await token1.mint(user, amountToSwap);
    await token1.connect(user).approve(marginlyRouter, amountToSwap);

    const price = await dodoV2.pool._BASE_TO_QUOTE_PRICE_();
    const amountToGetPlusOne = amountToSwap / price + 1n;

    const swapCalldata = constructSwap([Dex.DodoV2], [BigInt(SWAP_ONE)]);
    await expect(
      marginlyRouter.connect(user).swapExactInput(swapCalldata, token1, token0, amountToSwap, amountToGetPlusOne)
    ).to.be.revertedWithCustomError(dodoV2.adapter, 'InsufficientAmount');
  });

  it('swapExactOutput 0 to 1', async () => {
    const { marginlyRouter, token0, token1, dodoV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await dodoV2.pool._BASE_TO_QUOTE_PRICE_();

    const amountToGet = 1000n;
    const amountTransferred = ((amountToGet / price) * 105n) / 100n;
    const initialAmount0 = amountTransferred * 100n;
    await token0.mint(user, initialAmount0);
    await token0.connect(user).approve(marginlyRouter, initialAmount0);

    expect(await token0.balanceOf(user)).to.be.equal(initialAmount0);
    expect(await token1.balanceOf(user)).to.be.equal(0);

    const swapCalldata = constructSwap([Dex.DodoV2], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactOutput(swapCalldata, token0, token1, amountTransferred, amountToGet);

    expect(await token0.balanceOf(user)).to.be.lt(initialAmount0);
    expect(await token0.balanceOf(user)).to.be.gt(initialAmount0 - amountTransferred);
    expect(await token1.balanceOf(user)).to.be.equal(amountToGet);
  });

  it('swapExactOutput 1 to 0', async () => {
    const { marginlyRouter, token0, token1, dodoV2 } = await loadFixture(createMarginlyRouter);
    const [_, user] = await ethers.getSigners();

    const price = await dodoV2.pool._BASE_TO_QUOTE_PRICE_();

    const amountToGet = 1000n;
    const amountTransferred = (price * amountToGet * 105n) / 100n;
    const initialAmount1 = amountTransferred * 100n;
    await token1.mint(user, initialAmount1);
    await token1.connect(user).approve(marginlyRouter, amountTransferred);

    expect(await token0.balanceOf(user)).to.be.equal(0);
    expect(await token1.balanceOf(user)).to.be.equal(initialAmount1);

    const swapCalldata = constructSwap([Dex.DodoV2], [BigInt(SWAP_ONE)]);
    await marginlyRouter.connect(user).swapExactOutput(swapCalldata, token1, token0, amountTransferred, amountToGet);

    expect(await token0.balanceOf(user)).to.be.equal(amountToGet);
    expect(await token1.balanceOf(user)).to.be.lt(initialAmount1);
    expect(await token1.balanceOf(user)).to.be.gt(initialAmount1 - amountTransferred);
  });
});

describe('Callbacks', () => {
  it('adapter callback fails if sender is unknown', async () => {
    const { marginlyRouter, token0 } = await loadFixture(createMarginlyRouter);
    const [_, user, fraud] = await ethers.getSigners();

    const amountToSwap = 1000;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);

    const encodedData = AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint256'],
      [user.address, token0.target, `0`]
    );

    await expect(
      marginlyRouter.connect(fraud).adapterCallback(fraud, amountToSwap, encodedData)
    ).to.be.revertedWithoutReason();
  });

  it('uniswapV3 callback fails if sender is unknown', async () => {
    const { marginlyRouter, token0, token1, uniswapV3 } = await loadFixture(createMarginlyRouter);
    const [_, user, fraud] = await ethers.getSigners();

    const amountToSwap = 1000;
    await token0.mint(user, amountToSwap);
    await token0.connect(user).approve(marginlyRouter, amountToSwap);

    const encodedData = AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'address', 'address', 'uint256'],
      [token0.target, token1.target, marginlyRouter.target, user.address, token0.target, `0`]
    );

    await expect(
      // @ts-ignore
      uniswapV3.adapter.connect(fraud).uniswapV3SwapCallback(amountToSwap, 0, encodedData)
    ).to.be.revertedWithoutReason();
  });

  it('should raise error when trying to renounce ownership from router', async () => {
    const { marginlyRouter } = await loadFixture(createMarginlyRouter);
    await expect(marginlyRouter.renounceOwnership()).to.be.revertedWithCustomError(marginlyRouter, 'Forbidden');
  });

  it('should raise error when trying to renounce ownership from adapter', async () => {
    const { marginlyRouter } = await loadFixture(createMarginlyRouter);
    const [owner] = await ethers.getSigners();
    const adapterAddress = await marginlyRouter.adapters(0);
    const adapterStorage = AdapterStorage__factory.connect(adapterAddress, owner);
    await expect(adapterStorage.renounceOwnership()).to.be.revertedWithCustomError(adapterStorage, 'Forbidden');
  });
});
