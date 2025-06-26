import { ethers } from 'hardhat';
import {
  AavePriceOracle,
  MarginlyCompositeOracle,
  PendleMarketOracle,
} from '../../../typechain-types/contracts/oracles';
import { getDecimalsDiff, printPrices } from '../shared/common';

describe('Composite oracle PT-asonUSDC/USDC.e with Pendle for PT-asonUSDC/asonUSDC, Aave asonUSDC/USDC.e', () => {
  const ptAsonUSDC14Aug2025 = '0x930441aa7ab17654df5663781ca0c02cc17e6643';
  const aSonUsdc = '0x578Ee1ca3a8E1b54554Da1Bf7C583506C4CD11c6';
  const usdce = '0x29219dd400f2bf60e5a23d13be72b486d4038894';
  const aavePoolAddressProvider = '0x5C2e738F6E27bCE0F7558051Bf90605dD6176900';
  const pendleMarketAddress = '0x3f5ea53d1160177445b1898afbb16da111182418';
  const pendlePtLpOracleAddress = '0x9a9fa8338dd5e5b2188006f1cd2ef26d921650c2';
  const pendleMarketOracleSecondsAgo = 1800;
  const pendleMarketOracleSecondsAgoLiquidation = 15;

  let aaveOracle: AavePriceOracle;
  let pendleMarketOracle: PendleMarketOracle;
  let compositeOracle: MarginlyCompositeOracle;

  before(async () => {
    aaveOracle = await (await ethers.getContractFactory('AavePriceOracle')).deploy(aavePoolAddressProvider);
    await aaveOracle.setPair(usdce, aSonUsdc);

    pendleMarketOracle = await (await ethers.getContractFactory('PendleMarketOracle')).deploy(pendlePtLpOracleAddress);
    await pendleMarketOracle.setPair(
      aSonUsdc,
      ptAsonUSDC14Aug2025,
      pendleMarketAddress,
      pendleMarketOracleSecondsAgo,
      pendleMarketOracleSecondsAgoLiquidation
    );

    compositeOracle = await (await ethers.getContractFactory('MarginlyCompositeOracle')).deploy();
    await compositeOracle.setPair(usdce, aSonUsdc, ptAsonUSDC14Aug2025, aaveOracle, pendleMarketOracle);
  });

  it('pt-aSonUsdc-14Aug2025/USDC.e price', async () => {
    const balancePrice = await pendleMarketOracle.getBalancePrice(aSonUsdc, ptAsonUSDC14Aug2025);
    const mcPrice = await pendleMarketOracle.getMargincallPrice(aSonUsdc, ptAsonUSDC14Aug2025);

    console.log('pt-asonUSDC-14aug2025/asonUSDC');
    printPrices(balancePrice, mcPrice, await getDecimalsDiff(usdce, ptAsonUSDC14Aug2025));

    const asonusdc_usdcePrice = await aaveOracle.getBalancePrice(usdce, aSonUsdc);
    const asonusdc_usdceMcPrice = await aaveOracle.getMargincallPrice(usdce, aSonUsdc);

    console.log('aSonUSDC/UCDC.e');
    printPrices(asonusdc_usdcePrice, asonusdc_usdceMcPrice, await getDecimalsDiff(usdce, aSonUsdc));

    const ptAsonUsdcUSDCeBalancePrice = await compositeOracle.getBalancePrice(usdce, ptAsonUSDC14Aug2025);
    const ptAsonUsdcUSDCeMcPrice = await compositeOracle.getMargincallPrice(usdce, ptAsonUSDC14Aug2025);

    console.log('pt-asonUSDC-14Aug2025/USDC.e');
    printPrices(ptAsonUsdcUSDCeBalancePrice, ptAsonUsdcUSDCeMcPrice, await getDecimalsDiff(usdce, ptAsonUSDC14Aug2025));
  });
});
