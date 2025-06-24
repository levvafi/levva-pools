import { ethers } from 'hardhat';
import { AavePriceOracle } from '../../../typechain-types/contracts/oracles';
import { getDecimalsDiff, printPrices } from '../../shared/common';

describe('AaveATokenPriceOracle', () => {
  let oracle: AavePriceOracle;
  before(async () => {
    const poolAddressProvider = '0x5C2e738F6E27bCE0F7558051Bf90605dD6176900';
    const factory = await ethers.getContractFactory('AavePriceOracle');
    oracle = await factory.deploy(poolAddressProvider);
  });

  it('aUSDC-USDC.e', async () => {
    const aSonUSDC = '0x578Ee1ca3a8E1b54554Da1Bf7C583506C4CD11c6';
    const usdc = '0x29219dd400f2bf60e5a23d13be72b486d4038894';

    await oracle.setPair(usdc, aSonUSDC);

    const balancePrice = await oracle.getBalancePrice(usdc, aSonUSDC);
    const mcPrice = await oracle.getMargincallPrice(usdc, aSonUSDC);

    const decimalsDiff = await getDecimalsDiff(usdc, aSonUSDC);
    printPrices(balancePrice, mcPrice, decimalsDiff);

    const inverseBalancePrice = await oracle.getBalancePrice(aSonUSDC, usdc);
    const inverseMcPrice = await oracle.getMargincallPrice(aSonUSDC, usdc);

    const inverseDecimalsDiff = await getDecimalsDiff(aSonUSDC, usdc);
    printPrices(inverseBalancePrice, inverseMcPrice, inverseDecimalsDiff);
  });
});
