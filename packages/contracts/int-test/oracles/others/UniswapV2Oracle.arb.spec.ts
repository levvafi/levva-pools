import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { UniswapV2Oracle } from '../../../typechain-types/contracts/oracles';
import { parseEther } from 'ethers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { printPrices } from '../shared/common';

async function initSystem(
  uniswapV2Factory: string,
  wethAddress: string
): Promise<{ oracle: UniswapV2Oracle; signer: SignerWithAddress }> {
  const factory = await ethers.getContractFactory('UniswapV2Oracle');
  const windowSize = 60 * 60;
  const granularity = 60;
  const oracle = await factory.deploy(uniswapV2Factory, windowSize, granularity);

  const [, signer] = await ethers.getSigners();
  const wethContract = await ethers.getContractAt('IWETH9', wethAddress);
  await wethContract.connect(signer).deposit({ value: parseEther('1000') });
  return {
    oracle,
    signer,
  };
}

describe('Arbitrum: UniswapV2Oracle', () => {
  const uniswapV2Factory = '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9';

  const weth = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
  const wbtc = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f';
  const usdc = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';

  const wethUsdcPair = '0xF64Dfe17C8b87F012FCf50FbDA1D62bfA148366a';
  const wbtcWethPair = '0x8c1D83A25eE2dA1643A5d937562682b1aC6C856B';

  let oracle: UniswapV2Oracle;
  let wethHolder: SignerWithAddress;

  before(async () => {
    const sut = await initSystem(uniswapV2Factory, weth);
    oracle = sut.oracle;
    wethHolder = sut.signer;

    await oracle.addPairs(
      [
        { baseToken: weth, quoteToken: usdc },
        { baseToken: wbtc, quoteToken: weth },
      ],
      [
        { secondsAgo: 1800, secondsAgoLiquidation: 60 },
        { secondsAgo: 1800, secondsAgoLiquidation: 60 },
      ]
    );
  });

  it('weth-usdc, weth price decreases', async () => {
    const pairKey = await oracle.pairKeys(0);
    const pairAddress = await oracle.keyToAddress(pairKey);
    const uniswapV2Pair = await ethers.getContractAt('IUniswapV2Pair', pairAddress);
    const wethContract = await ethers.getContractAt('IWETH9', weth);
    for (let i = 0; i < 31; i++) {
      await time.increase(60); // increase time and mine new block
      await oracle.updateAll();
    }

    {
      console.log('Initial prices:');
      const balancePrice = await oracle.getBalancePrice(usdc, weth);
      const mcPrice = await oracle.getMargincallPrice(usdc, weth);
      printPrices(balancePrice, mcPrice, 12n);
    }

    //make swaps and update price
    for (let i = 0; i < 10; i++) {
      await time.increase(60); // increase time and mine new block
      await oracle.updateAll();

      await wethContract.connect(wethHolder).transfer(uniswapV2Pair, parseEther('1'));
      const amount1Out = 10 * 10 ** 6;
      await uniswapV2Pair.connect(wethHolder).swap(0, amount1Out, wethHolder.address, Buffer.from([]));
      await uniswapV2Pair.connect(wethHolder).skim(wethHolder.address);
    }

    {
      console.log('Prices after 10 swaps:');
      const balancePrice = await oracle.getBalancePrice(usdc, weth);
      const mcPrice = await oracle.getMargincallPrice(usdc, weth);
      printPrices(balancePrice, mcPrice, 12n);
    }
  });
});
