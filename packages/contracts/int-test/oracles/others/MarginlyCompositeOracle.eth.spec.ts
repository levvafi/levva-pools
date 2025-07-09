import { ethers } from 'hardhat';
import { MarginlyCompositeOracle, PendleMarketOracle, PythOracle } from '../../../typechain-types/contracts/oracles';
import { getDecimalsDiff, printPrices } from '../shared/common';
import { CurveOracle } from '../../../typechain-types';
import { resetFork } from '../../router/shared/utils';

describe('Composite oracle PT-wstUSR/USR with Pendle for PT-wstUSR/wstUSR, Pyth wstUSR/USR', () => {
  //https://docs.pyth.network/home/pyth-token/pyth-token-addresses
  const pythContractAddress = '0x4305fb66699c3b2702d4d05cf36551390a4c69c6';
  const priceFeedId = '0xb74c2bc175c2dab850ce5a5451608501c293fe8410cb4aba7449dd1c355ab706';
  const wstUsrAddress = '0x1202f5c7b4b9e47a1a484e8b270be34dbbc75055';
  const usrAddress = '0x66a1e37c9b0eaddca17d3662d6c05f4decf3e110';
  const ptWstUsr27Mar2025 = '0xa8c8861b5ccf8cce0ade6811cd2a7a7d3222b0b8';
  const pendleMarketAddress = '0x353d0b2efb5b3a7987fb06d30ad6160522d08426';
  const pendlePtLpOracleAddress = '0x9a9fa8338dd5e5b2188006f1cd2ef26d921650c2';
  const pythMaxPriceAge = 1800;
  const pendleMarketOracleSecondsAgo = 1800;
  const pendleMarketOracleSecondsAgoLiquidation = 15;

  let pythOracle: PythOracle;
  let pendleMarketOracle: PendleMarketOracle;
  let compositeOracle: MarginlyCompositeOracle;

  before(async () => {
    await resetFork(21814800);
    pythOracle = await (await ethers.getContractFactory('PythOracle')).deploy(pythContractAddress);
    await pythOracle.setPair(usrAddress, wstUsrAddress, priceFeedId, pythMaxPriceAge);

    pendleMarketOracle = await (await ethers.getContractFactory('PendleMarketOracle')).deploy(pendlePtLpOracleAddress);
    await pendleMarketOracle.setPair(
      wstUsrAddress,
      ptWstUsr27Mar2025,
      pendleMarketAddress,
      pendleMarketOracleSecondsAgo,
      pendleMarketOracleSecondsAgoLiquidation
    );

    compositeOracle = await (await ethers.getContractFactory('MarginlyCompositeOracle')).deploy();
    await compositeOracle.setPair(usrAddress, wstUsrAddress, ptWstUsr27Mar2025, pythOracle, pendleMarketOracle);
  });

  it('pt-wstUSR-27Mar2025/USR price', async () => {
    const ptWstUsrWstUsrBalancePrice = await pendleMarketOracle.getBalancePrice(wstUsrAddress, ptWstUsr27Mar2025);
    const ptWstUsrWstUsrMCPrice = await pendleMarketOracle.getMargincallPrice(wstUsrAddress, ptWstUsr27Mar2025);

    console.log('pt-wstUSR-27Mar2025/wstUSR');
    printPrices(
      ptWstUsrWstUsrBalancePrice,
      ptWstUsrWstUsrMCPrice,
      await getDecimalsDiff(wstUsrAddress, ptWstUsr27Mar2025)
    );

    const wstUsr_usrPrice = await pythOracle.getBalancePrice(usrAddress, wstUsrAddress);
    const wstUsr_usrPriceMcPrice = await pythOracle.getMargincallPrice(usrAddress, wstUsrAddress);

    console.log('wstUSR/USR');
    printPrices(wstUsr_usrPrice, wstUsr_usrPriceMcPrice, await getDecimalsDiff(usrAddress, wstUsrAddress));

    const wbtcArbBalancePrice = await compositeOracle.getBalancePrice(usrAddress, ptWstUsr27Mar2025);
    const wbtcArbMcPrice = await compositeOracle.getMargincallPrice(usrAddress, ptWstUsr27Mar2025);

    console.log('pt-wstUSR-27Mar2025/USR');
    printPrices(wbtcArbBalancePrice, wbtcArbMcPrice, await getDecimalsDiff(usrAddress, ptWstUsr27Mar2025));
  });
});

describe('Composite oracle Spectra PT-wstUSR/USR, Pyth wstUSR/USR', () => {
  //https://docs.pyth.network/home/pyth-token/pyth-token-addresses
  const pythContractAddress = '0x4305fb66699c3b2702d4d05cf36551390a4c69c6';
  const priceFeedId = '0xb74c2bc175c2dab850ce5a5451608501c293fe8410cb4aba7449dd1c355ab706';
  const wstUsrAddress = '0x1202f5c7b4b9e47a1a484e8b270be34dbbc75055';
  const usrAddress = '0x66a1e37c9b0eaddca17d3662d6c05f4decf3e110';
  const ptWstUsr26Jun2025 = '0x4a977653c58cfd82d42fd706cf68a0c1b6d0ca56';
  const spectraPool = '0x16d050778b6599ce94993d2ff83f8da7136421a9';
  const pythMaxPriceAge = 1800;

  let pythOracle: PythOracle;
  let curveOracle: CurveOracle;
  let compositeOracle: MarginlyCompositeOracle;

  before(async () => {
    pythOracle = await (await ethers.getContractFactory('PythOracle')).deploy(pythContractAddress);
    await pythOracle.setPair(usrAddress, wstUsrAddress, priceFeedId, pythMaxPriceAge);

    curveOracle = await (await ethers.getContractFactory('CurveOracle')).deploy();
    await curveOracle.addPool(spectraPool, wstUsrAddress, ptWstUsr26Jun2025, false);
    await curveOracle.addPool(spectraPool, ptWstUsr26Jun2025, wstUsrAddress, false);

    compositeOracle = await (await ethers.getContractFactory('MarginlyCompositeOracle')).deploy();
    await compositeOracle.setPair(usrAddress, wstUsrAddress, ptWstUsr26Jun2025, pythOracle, curveOracle);
  });

  it('pt-wstUSR-27Mar2025/USR price', async () => {
    const ptWstUsrWstUsrBalancePrice = await curveOracle.getBalancePrice(wstUsrAddress, ptWstUsr26Jun2025);
    const ptWstUsrWstUsrMCPrice = await curveOracle.getMargincallPrice(wstUsrAddress, ptWstUsr26Jun2025);

    console.log('pt-wstUSR-27Mar2025/wstUSR');
    printPrices(
      ptWstUsrWstUsrBalancePrice,
      ptWstUsrWstUsrMCPrice,
      await getDecimalsDiff(wstUsrAddress, ptWstUsr26Jun2025)
    );

    const wstUsr_usrPrice = await pythOracle.getBalancePrice(usrAddress, wstUsrAddress);
    const wstUsr_usrPriceMcPrice = await pythOracle.getMargincallPrice(usrAddress, wstUsrAddress);

    console.log('wstUSR/USR');
    printPrices(wstUsr_usrPrice, wstUsr_usrPriceMcPrice, await getDecimalsDiff(usrAddress, wstUsrAddress));

    const wbtcArbBalancePrice = await compositeOracle.getBalancePrice(usrAddress, ptWstUsr26Jun2025);
    const wbtcArbMcPrice = await compositeOracle.getMargincallPrice(usrAddress, ptWstUsr26Jun2025);

    console.log('pt-wstUSR-27Mar2025/USR');
    printPrices(wbtcArbBalancePrice, wbtcArbMcPrice, await getDecimalsDiff(usrAddress, ptWstUsr26Jun2025));
  });
});
