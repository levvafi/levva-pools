import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { createTestSwapInfo } from './shared/fixtures';
import { constructSwap, Dex, SWAP_ONE } from './shared/utils';

describe('SwapInfo decoding', () => {
  it('default', async () => {
    const swapInfoTest = await loadFixture(createTestSwapInfo);
    const defaultUniswapV3Swap = 0;
    const decodingResult = await swapInfoTest.decodeSwapInfo(defaultUniswapV3Swap, SWAP_ONE, SWAP_ONE);
    expect(decodingResult[1]).to.be.equal(1);

    const swapInfo = decodingResult[0][0];
    expect(swapInfo.dexIndex).to.be.equal(Dex.UniswapV3);
    expect(swapInfo.dexAmountIn).to.be.equal(1 << 15);
    expect(swapInfo.dexAmountOut).to.be.equal(1 << 15);
  });

  it('only uniswapV3', async () => {
    const swapInfoTest = await loadFixture(createTestSwapInfo);
    const onlyUniswapV3Swap = constructSwap([Dex.UniswapV3], [BigInt(SWAP_ONE)]);
    const decodingResult = await swapInfoTest.decodeSwapInfo(onlyUniswapV3Swap, SWAP_ONE, SWAP_ONE);
    expect(decodingResult[1]).to.be.equal(1);

    const swapInfo = decodingResult[0][0];
    expect(swapInfo.dexIndex).to.be.equal(Dex.UniswapV3);
    expect(swapInfo.dexAmountIn).to.be.equal(1 << 15);
    expect(swapInfo.dexAmountOut).to.be.equal(1 << 15);
  });

  it('split randomly between 2 Dexs', async () => {
    const swapInfoTest = await loadFixture(createTestSwapInfo);

    const firstDexRatio = BigInt(Math.floor(Math.random() * SWAP_ONE));
    const secondDexRatio = BigInt(SWAP_ONE) - firstDexRatio;

    const dexNumber = Object.entries(Dex).length;
    const firstDex = BigInt(Math.floor(Math.random() * dexNumber));
    let secondDex;

    do {
      secondDex = BigInt(Math.floor(Math.random() * dexNumber));
    } while (secondDex === firstDex);

    console.log([firstDex, secondDex]);
    console.log([firstDexRatio, secondDexRatio]);

    const swap = constructSwap([firstDex, secondDex], [firstDexRatio, secondDexRatio]);
    const decodingResult = await swapInfoTest.decodeSwapInfo(swap, SWAP_ONE, SWAP_ONE);
    expect(decodingResult[1]).to.be.equal(2);

    const swapInfoFirst = decodingResult[0][1];
    expect(swapInfoFirst.dexIndex).to.be.equal(firstDex);
    expect(swapInfoFirst.dexAmountIn).to.be.equal(firstDexRatio);
    expect(swapInfoFirst.dexAmountOut).to.be.equal(firstDexRatio);

    const swapInfoSecond = decodingResult[0][0];
    expect(swapInfoSecond.dexIndex).to.be.equal(secondDex);
    expect(swapInfoSecond.dexAmountIn).to.be.equal(secondDexRatio);
    expect(swapInfoSecond.dexAmountOut).to.be.equal(secondDexRatio);
  });

  it('Wrong swap ratios', async () => {
    const swapInfoTest = await loadFixture(createTestSwapInfo);

    const firstDexRatio = BigInt(Math.floor(Math.random() * SWAP_ONE));
    let secondDexRatio;
    do {
      secondDexRatio = BigInt(Math.floor(Math.random() * SWAP_ONE));
    } while (secondDexRatio === BigInt(SWAP_ONE) - firstDexRatio);

    const dexNumber = Object.entries(Dex).length;
    const firstDex = BigInt(Math.floor(Math.random() * dexNumber));
    let secondDex;

    do {
      secondDex = BigInt(Math.floor(Math.random() * dexNumber));
    } while (secondDex === firstDex);

    console.log([firstDex, secondDex]);
    console.log([firstDexRatio, secondDexRatio]);

    const swap = constructSwap([firstDex, secondDex], [firstDexRatio, secondDexRatio]);
    await expect(swapInfoTest.decodeSwapInfo(swap, SWAP_ONE, SWAP_ONE)).to.be.revertedWithCustomError(
      swapInfoTest,
      'WrongSwapRatios'
    );
  });

  it('Wrong swaps number', async () => {
    const swapInfoTest = await loadFixture(createTestSwapInfo);

    const firstDexRatio = BigInt(Math.floor(Math.random() * SWAP_ONE));
    const secondDexRatio = BigInt(SWAP_ONE) - firstDexRatio;

    const dexNumber = Object.entries(Dex).length;
    const firstDex = BigInt(Math.floor(Math.random() * dexNumber));
    let secondDex;

    do {
      secondDex = BigInt(Math.floor(Math.random() * dexNumber));
    } while (secondDex === firstDex);

    console.log([firstDex, secondDex]);
    console.log([firstDexRatio, secondDexRatio]);

    const swap = constructSwap([firstDex, secondDex], [firstDexRatio, secondDexRatio]) - 2n;
    await expect(swapInfoTest.decodeSwapInfo(swap, SWAP_ONE, SWAP_ONE)).to.be.revertedWithCustomError(
      swapInfoTest,
      'WrongSwapsNumber'
    );
  });

  it('WrongSwapsNumber: not zero in the end', async () => {
    const swapInfoTest = await loadFixture(createTestSwapInfo);

    const dexNumber = Object.entries(Dex).length;
    const dex = BigInt(Math.floor(Math.random() * dexNumber));

    console.log([dex]);

    let swap = constructSwap([dex], [BigInt(SWAP_ONE)]);
    swap = swap + 2n ** BigInt(Math.ceil(Math.log2(Number(swap)) + 8));
    await expect(swapInfoTest.decodeSwapInfo(swap, SWAP_ONE, SWAP_ONE)).to.be.revertedWithCustomError(
      swapInfoTest,
      'WrongSwapsNumber'
    );
  });
});
