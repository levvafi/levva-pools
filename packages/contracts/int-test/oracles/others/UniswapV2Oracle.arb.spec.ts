import { ethers } from 'hardhat';
import { time, setBalance } from '@nomicfoundation/hardhat-network-helpers';
import { UniswapV2Oracle } from '../../../typechain-types/contracts/oracles';
import { parseEther, parseUnits } from 'ethers';
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
// To use these tests set up appropriate node url in hardhat-fork.config
describe.skip('Arbitrum: UniswapV2Oracle', () => {
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

describe.skip('Blast: BlasterSwap', () => {
  const blasterBridge = '0x4300000000000000000000000000000000000005';

  const blasterSwapFactory = '0x9CC1599D4378Ea41d444642D18AA9Be44f709ffD';
  const weth = '0x4300000000000000000000000000000000000004';
  const usdb = '0x4300000000000000000000000000000000000003';
  const pac = '0x5ffd9EbD27f2fcAB044c0f0a26A45Cb62fa29c06';

  let oracle: UniswapV2Oracle;
  let wethHolder: SignerWithAddress;
  let bridgeAccount: SignerWithAddress;

  before(async () => {
    const sut = await initSystem(blasterSwapFactory, weth);
    oracle = sut.oracle;
    wethHolder = sut.signer;

    bridgeAccount = await ethers.getImpersonatedSigner(blasterBridge);

    await oracle.addPairs(
      [
        { baseToken: weth, quoteToken: usdb },
        { quoteToken: weth, baseToken: pac },
        { quoteToken: usdb, baseToken: pac },
      ],
      [
        { secondsAgo: 1800, secondsAgoLiquidation: 60 },
        { secondsAgo: 1800, secondsAgoLiquidation: 60 },
        { secondsAgo: 1800, secondsAgoLiquidation: 60 },
      ]
    );

    await setBalance(bridgeAccount.address, parseEther('10'));

    const usdbContract = await ethers.getContractAt('IMintableERC20', usdb);
    await usdbContract.connect(bridgeAccount).mint(wethHolder.address, parseUnits('1000', 18));
  });

  it('weth-usdb', async () => {
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
      const balancePrice = await oracle.getBalancePrice(usdb, weth);
      const mcPrice = await oracle.getMargincallPrice(usdb, weth);
      printPrices(balancePrice, mcPrice, 0n);
    }

    //make swaps and update price
    for (let i = 0; i < 10; i++) {
      await time.increase(60); // increase time and mine new block
      await oracle.updateAll();

      await wethContract.transfer(uniswapV2Pair, parseEther('1'));
      const amount0Out = 3000n * 10n ** 18n;
      await uniswapV2Pair.connect(wethHolder).swap(amount0Out, 0, wethHolder.address, Buffer.from([]));
      await uniswapV2Pair.connect(wethHolder).skim(wethHolder.address);
    }

    {
      console.log('Prices after 10 swaps:');
      const balancePrice = await oracle.getBalancePrice(usdb, weth);
      const mcPrice = await oracle.getMargincallPrice(usdb, weth);
      printPrices(balancePrice, mcPrice, 0n);
    }
  });

  it('pac-weth', async () => {
    const pairKey = await oracle.pairKeys(1);
    const pairAddress = await oracle.keyToAddress(pairKey);
    const uniswapV2Pair = await ethers.getContractAt('IUniswapV2Pair', pairAddress);
    const wethContract = await ethers.getContractAt('IWETH9', weth);
    for (let i = 0; i < 31; i++) {
      await time.increase(60); // increase time and mine new block
      await oracle.updateAll();
    }

    {
      console.log('Initial prices:');
      const balancePrice = await oracle.getBalancePrice(weth, pac);
      const mcPrice = await oracle.getMargincallPrice(weth, pac);
      printPrices(balancePrice, mcPrice, 0n);
    }

    //make swaps and update price
    for (let i = 0; i < 10; i++) {
      await time.increase(60); // increase time and mine new block
      await oracle.updateAll();

      await wethContract.transfer(uniswapV2Pair, parseEther('1'));
      const amount1Out = 20n * 10n ** 18n;
      await uniswapV2Pair.connect(wethHolder).swap(0, amount1Out, wethHolder.address, Buffer.from([]));
      await uniswapV2Pair.connect(wethHolder).skim(wethHolder.address);
    }

    {
      console.log('Prices after 10 swaps:');
      const balancePrice = await oracle.getBalancePrice(weth, pac);
      const mcPrice = await oracle.getMargincallPrice(weth, pac);
      printPrices(balancePrice, mcPrice, 0n);
    }
  });

  it('pac-usdb', async () => {
    const pairKey = await oracle.pairKeys(2);
    const pairAddress = await oracle.keyToAddress(pairKey);
    const uniswapV2Pair = await ethers.getContractAt('IUniswapV2Pair', pairAddress);
    const usdbContract = await ethers.getContractAt('IERC20', usdb);
    for (let i = 0; i < 31; i++) {
      await time.increase(60); // increase time and mine new block
      await oracle.updateAll();
    }

    {
      console.log('Initial prices:');
      const balancePrice = await oracle.getBalancePrice(usdb, pac);
      const mcPrice = await oracle.getMargincallPrice(usdb, pac);
      printPrices(balancePrice, mcPrice, 0n);
    }

    //make swaps and update price
    for (let i = 0; i < 10; i++) {
      await time.increase(60); // increase time and mine new block
      await oracle.updateAll();

      await usdbContract.transfer(uniswapV2Pair, parseEther('10'));
      const amount1Out = 100n * 10n ** 18n;
      await uniswapV2Pair.connect(wethHolder).swap(0, amount1Out, wethHolder.address, Buffer.from([]));
      await uniswapV2Pair.connect(wethHolder).skim(wethHolder.address);
    }

    {
      console.log('Prices after 10 swaps:');
      const balancePrice = await oracle.getBalancePrice(usdb, pac);
      const mcPrice = await oracle.getMargincallPrice(usdb, pac);
      printPrices(balancePrice, mcPrice, 0n);
    }
  });
});

describe.skip('Blast: ThrusterV2', () => {
  const blasterBridge = '0x4300000000000000000000000000000000000005';

  const ThrusterV2Factory = '0xb4A7D971D0ADea1c73198C97d7ab3f9CE4aaFA13';
  const weth = '0x4300000000000000000000000000000000000004';
  const usdb = '0x4300000000000000000000000000000000000003';
  const doge = '0x3d989F66bD575047CB4998e20e1fe51dbCCC0172';

  let oracle: UniswapV2Oracle;
  let wethHolder: SignerWithAddress;
  let bridgeAccount: SignerWithAddress;

  before(async () => {
    const sut = await initSystem(ThrusterV2Factory, weth);
    oracle = sut.oracle;
    wethHolder = sut.signer;

    bridgeAccount = await ethers.getImpersonatedSigner(blasterBridge);

    await oracle.addPairs([{ quoteToken: weth, baseToken: doge }], [{ secondsAgo: 1800, secondsAgoLiquidation: 60 }]);

    await setBalance(bridgeAccount.address, parseEther('10'));

    const usdbContract = await ethers.getContractAt('IMintableERC20', usdb);
    await usdbContract.connect(bridgeAccount).mint(wethHolder.address, parseUnits('1000', 18));
  });

  it('doge-weth', async () => {
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
      const balancePrice = await oracle.getBalancePrice(weth, doge);
      const mcPrice = await oracle.getMargincallPrice(weth, doge);
      printPrices(balancePrice, mcPrice, -8n);
    }

    //make swaps and update price
    for (let i = 0; i < 10; i++) {
      await time.increase(60); // increase time and mine new block
      await oracle.updateAll();

      await wethContract.transfer(uniswapV2Pair, parseEther('0.01'));
      const amount1Out = 300n * 10n ** 10n;
      await uniswapV2Pair.connect(wethHolder).swap(0, amount1Out, wethHolder.address, Buffer.from([]));
      await uniswapV2Pair.connect(wethHolder).skim(wethHolder.address);
    }

    {
      console.log('Prices after 10 swaps:');
      const balancePrice = await oracle.getBalancePrice(weth, doge);
      const mcPrice = await oracle.getMargincallPrice(weth, doge);
      printPrices(balancePrice, mcPrice, -8n);
    }
  });
});
