import { ethers } from 'hardhat';
import { AavePriceOracle } from '../../../typechain-types/contracts/oracles';
import { getDecimalsDiff, printPrices } from '../shared/common';

describe('AaveATokenPriceOracle', () => {
  let oracle: AavePriceOracle;
  before(async () => {
    const poolAddressProvider = '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e';
    const factory = await ethers.getContractFactory('AavePriceOracle');
    oracle = await factory.deploy(poolAddressProvider);
  });

  it('aUSDC-USDC.e', async () => {
    const aEthUSDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c';
    const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

    await oracle.setPair(usdc, aEthUSDC);

    const balancePrice = await oracle.getBalancePrice(usdc, aEthUSDC);
    const mcPrice = await oracle.getMargincallPrice(usdc, aEthUSDC);

    const decimalsDiff = await getDecimalsDiff(usdc, aEthUSDC);
    printPrices(balancePrice, mcPrice, decimalsDiff);

    const inverseBalancePrice = await oracle.getBalancePrice(aEthUSDC, usdc);
    const inverseMcPrice = await oracle.getMargincallPrice(aEthUSDC, usdc);

    const inverseDecimalsDiff = await getDecimalsDiff(aEthUSDC, usdc);
    printPrices(inverseBalancePrice, inverseMcPrice, inverseDecimalsDiff);
  });
});
