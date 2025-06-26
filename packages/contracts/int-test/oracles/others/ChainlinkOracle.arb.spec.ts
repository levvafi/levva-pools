import { ethers } from 'hardhat';
import { ChainlinkOracle } from '../../../typechain-types/contracts/oracles';
import { getDecimalsDiff, printPrices } from '../shared/common';

describe('ChainlinkOracle', () => {
  let oracle: ChainlinkOracle;
  before(async () => {
    const factory = await ethers.getContractFactory('ChainlinkOracle');
    const sequencerFeed = '0xFdB631F5EE196F0ed6FAa767959853A9F217697D';
    oracle = await factory.deploy(sequencerFeed);
  });

  it('composite (BTC/ETH)  BTC / USD; ETH / USD', async () => {
    const wbtc = '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f';
    const wbtcUsdDataFeed = '0xd0C7101eACbB49F3deCcCc166d238410D6D46d57';
    const weth = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
    const wethUsdDataFeed = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612';
    const usdFake = '0x0000000000000000000000000000000000000000';
    const maxPriceAge = 86400; // 1 day
    await oracle.setPair(usdFake, wbtc, wbtcUsdDataFeed, maxPriceAge);
    await oracle.setPair(usdFake, weth, wethUsdDataFeed, maxPriceAge);
    await oracle.setCompositePair(weth, usdFake, wbtc);

    const balancePrice = await oracle.getBalancePrice(weth, wbtc);
    const mcPrice = await oracle.getMargincallPrice(weth, wbtc);

    const decimalsDiff = await getDecimalsDiff(weth, wbtc);
    printPrices(balancePrice, mcPrice, decimalsDiff);

    const revBalancePrice = await oracle.getBalancePrice(wbtc, weth);
    const revMcPrice = await oracle.getMargincallPrice(wbtc, weth);
    printPrices(revBalancePrice, revMcPrice, -decimalsDiff);
  });

  it('simple pair LINK / ETH', async () => {
    const link = '0xf97f4df75117a78c1a5a0dbb814af92458539fb4';
    const weth = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
    const linkEthDataFeed = '0xb7c8Fb1dB45007F98A68Da0588e1AA524C317f27';
    const maxPriceAge = 86400; // 1 day
    await oracle.setPair(weth, link, linkEthDataFeed, maxPriceAge);

    const balancePrice = await oracle.getBalancePrice(weth, link);
    const mcPrice = await oracle.getMargincallPrice(weth, link);

    const decimalsDiff = await getDecimalsDiff(weth, link);
    printPrices(balancePrice, mcPrice, decimalsDiff);

    const revBalancePrice = await oracle.getBalancePrice(link, weth);
    const revMcPrice = await oracle.getMargincallPrice(link, weth);
    printPrices(revBalancePrice, revMcPrice, -decimalsDiff);
  });

  it('pair to USD: BTC / USD ', async () => {
    const wbtc = '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f';
    const wbtcUsdDataFeed = '0xd0C7101eACbB49F3deCcCc166d238410D6D46d57';
    const usdFake = '0x0000000000000000000000000000000000000000';
    const maxPriceAge = 86400; // 1 day
    await oracle.setPair(usdFake, wbtc, wbtcUsdDataFeed, maxPriceAge);
    const balancePrice = await oracle.getBalancePrice(usdFake, wbtc);
    const mcPrice = await oracle.getMargincallPrice(usdFake, wbtc);

    printPrices(balancePrice, mcPrice, 8n);

    const revBalancePrice = await oracle.getBalancePrice(wbtc, usdFake);
    const revMcPrice = await oracle.getMargincallPrice(wbtc, usdFake);

    printPrices(revBalancePrice, revMcPrice, -8n);
  });
});
