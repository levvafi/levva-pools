import { EventLog, parseUnits } from 'ethers';
import { ethers } from 'hardhat';
import { createTestLogger } from '../utils/logger';
import { initUsdc, initWeth } from '../utils/erc20-init';
import { uniswapFactoryContract, uniswapPoolContract } from '../utils/known-contracts';
import { Dex } from '../utils/chain-ops';
import { GasReporter } from '../utils/GasReporter';
import {
  IUniswapV3Factory,
  IUniswapV3Pool,
  IUSDC,
  IWETH9,
  MarginlyFactory,
  MarginlyFactory__factory,
  MarginlyKeeperAave__factory,
  MarginlyKeeperAlgebra__factory,
  MarginlyKeeperBalancer__factory,
  MarginlyKeeperUniswapV3__factory,
  LevvaTradingPool,
  LevvaTradingPool__factory,
} from '../../../contracts/typechain-types';
import {
  MarginlyKeeperAave,
  MarginlyKeeperUniswapV3,
  MarginlyKeeperBalancer,
  MarginlyKeeperAlgebra,
} from '../../../contracts/typechain-types';
import {
  MarginlyRouter,
  UniswapV3Adapter__factory,
  KyberSwapClassicAdapter__factory,
  BalancerAdapter__factory,
  UniswapV2Adapter__factory,
  DodoV1Adapter__factory,
  DodoV2Adapter__factory,
  MarginlyRouter__factory,
} from '../../../router/typechain-types';

import { UniswapV3TickOracle__factory } from '../../../periphery/typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { Logger } from 'pino';

/// @dev theme paddle front firm patient burger forward little enter pause rule limb
export const FeeHolder = '0x4c576Bf4BbF1d9AB9c359414e5D2b466bab085fa';

/// @dev tone buddy include ridge cheap because marriage sorry jungle question pretty vacuum
export const TechnicalPositionOwner = '0xDda7021A2F58a2C6E0C800692Cde7893b4462FB3';

export type SystemUnderTest = {
  uniswap: IUniswapV3Pool;
  uniswapFactory: IUniswapV3Factory;
  swapRouter: MarginlyRouter;
  marginlyPool: LevvaTradingPool;
  marginlyFactory: MarginlyFactory;
  keeperAave: MarginlyKeeperAave;
  keeperUniswapV3: MarginlyKeeperUniswapV3;
  keeperBalancer: MarginlyKeeperBalancer;
  keeperAlgebra: MarginlyKeeperAlgebra;
  treasury: SignerWithAddress;
  accounts: SignerWithAddress[];
  usdc: IUSDC;
  weth: IWETH9;
  gasReporter: GasReporter;
  logger: Logger;
};

export async function initializeTestSystem(): Promise<SystemUnderTest> {
  const logger = createTestLogger();
  logger.info('Initializing');
  const accounts = await ethers.getSigners();
  const count = accounts.length - 1;
  for (let i = 0; i < count; ++i) {}
  const treasury = accounts[0];

  const weth = await initWeth(treasury, treasury.provider, logger);
  const usdc = await initUsdc(treasury, treasury.provider, logger);

  const uniswapFactory = uniswapFactoryContract(treasury);
  logger.info(`uniswapFactory: ${await uniswapFactory.getAddress()}`);
  logger.info(`uniswapFactory owner: ${await uniswapFactory.owner()}`);

  const uniswap = uniswapPoolContract(await uniswapFactory.getPool(weth, usdc, 500), treasury.provider);
  logger.info(`uniswap pool for WETH/USDC ${await uniswap.getAddress()}`);

  const uniswapAdapter = await new UniswapV3Adapter__factory()
    .connect(treasury)
    .deploy([{ token0: weth, token1: usdc, pool: uniswap }]);

  const kyberClassicAdapter = await new KyberSwapClassicAdapter__factory()
    .connect(treasury)
    .deploy([{ token0: weth, token1: usdc, pool: '0xD6f8E8068012622d995744cc135A7e8e680E2E76' }]);

  const sushiSwapAdapter = await new UniswapV2Adapter__factory()
    .connect(treasury)
    .deploy([{ token0: weth, token1: usdc, pool: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0' }]);

  const balancerVault = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
  const balancerAdapter = await new BalancerAdapter__factory()
    .connect(treasury)
    .deploy([{ token0: weth, token1: usdc, pool: '0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8' }], balancerVault);

  const dodoV1Adapter = await new DodoV1Adapter__factory()
    .connect(treasury)
    .deploy([{ token0: weth, token1: usdc, pool: '0x75c23271661d9d143DCb617222BC4BEc783eff34' }]);

  const dodoV2Pool = '0xCFA990E9c104F6DB3fbECEe04ad211c39ED3830F';
  await weth.connect(treasury).transfer(dodoV2Pool, parseUnits('110', 18));
  await usdc.connect(treasury).transfer(dodoV2Pool, parseUnits('100000', 6));
  const dodoV2SyncAbi =
    '[{"inputs": [], "name": "sync", "outputs": [], "stateMutability": "nonpayable", "type": "function"}]';
  const dodoV2 = new ethers.Contract(dodoV2Pool, dodoV2SyncAbi);
  await dodoV2.connect(treasury).getFunction('sync').call([]);

  const dodoV2Adapter = await new DodoV2Adapter__factory()
    .connect(treasury)
    .deploy([{ token0: weth, token1: usdc, pool: dodoV2Pool }]);

  const routerConstructorInput = [];
  routerConstructorInput.push({
    dexIndex: Dex.UniswapV3,
    adapter: uniswapAdapter,
  });
  routerConstructorInput.push({
    dexIndex: Dex.Balancer,
    adapter: balancerAdapter,
  });
  routerConstructorInput.push({
    dexIndex: Dex.KyberClassicSwap,
    adapter: kyberClassicAdapter,
  });
  routerConstructorInput.push({
    dexIndex: Dex.SushiSwap,
    adapter: sushiSwapAdapter,
  });
  routerConstructorInput.push({
    dexIndex: Dex.DodoV1,
    adapter: dodoV1Adapter,
  });
  routerConstructorInput.push({
    dexIndex: Dex.DodoV2,
    adapter: dodoV2Adapter,
  });
  const swapRouter = await new MarginlyRouter__factory().connect(treasury).deploy(routerConstructorInput);
  logger.info(`swap router: ${await swapRouter.getAddress()}`);

  const priceOracle = await new UniswapV3TickOracle__factory().connect(treasury).deploy(uniswapFactory);
  logger.info(`price oracle: ${await priceOracle.getAddress()}`);

  const secondsAgo = 1800;
  const secondsAgoLiquidation = 5;
  const uniswapPoolFee = 500;
  await priceOracle.connect(treasury).setOptions(usdc, weth, secondsAgo, secondsAgoLiquidation, uniswapPoolFee);

  const marginlyPoolImplementation = await new LevvaTradingPool__factory().connect(treasury).deploy();
  logger.info(`marginly pool implementation: ${await marginlyPoolImplementation.getAddress()}`);

  const marginlyFactory = await new MarginlyFactory__factory()
    .connect(treasury)
    .deploy(marginlyPoolImplementation, swapRouter, FeeHolder, weth, TechnicalPositionOwner);
  logger.info(`marginlyFactory: ${await marginlyFactory.getAddress()}`);
  logger.info(`marginly owner: ${await marginlyFactory.owner()}`);

  const initialParams = {
    interestRate: 54000, // 5.4%
    fee: 20000, // 2%
    maxLeverage: 20n,
    swapFee: 1000, // 0.1%
    positionSlippage: 20000, // 2%
    mcSlippage: 50000, //5%
    positionMinAmount: 10000000000000000n, // 0,01 ETH
    quoteLimit: 10n ** 12n * 10n ** 6n,
  };

  const defaultSwapCallData = 0;
  const gasReporter = new GasReporter('FIXME', logger);
  const txReceipt = await gasReporter.saveGasUsage(
    'factory.createPool',
    marginlyFactory.createPool(usdc, weth, priceOracle, defaultSwapCallData, initialParams)
  );

  const poolCreatedEvent = txReceipt?.logs
    ?.filter((log) => log instanceof EventLog)
    .find((x) => x.eventName === 'PoolCreated');

  if (poolCreatedEvent?.args === undefined) {
    throw new Error('PoolCreated event is not found');
  }
  const marginlyAddress = poolCreatedEvent.args[4];

  const marginlyPool = LevvaTradingPool__factory.connect(marginlyAddress, treasury.provider);
  logger.info(`marginly <> uniswap: ${marginlyAddress} <> ${await uniswap.getAddress()}`);

  const aavePoolAddressesProviderAddress = '0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e'; //ethereum mainnet
  const keeperAave = await new MarginlyKeeperAave__factory().connect(treasury).deploy(aavePoolAddressesProviderAddress);
  logger.info(`keeperAave: ${await keeperAave.getAddress()}`);

  const keeperUniswapV3 = await new MarginlyKeeperUniswapV3__factory().connect(treasury).deploy();
  logger.info(`keeperUniswapV3: ${await keeperUniswapV3.getAddress()}`);

  const keeperBalancer = await new MarginlyKeeperBalancer__factory().connect(treasury).deploy(balancerVault);
  logger.info(`keeperBalancer: ${await keeperBalancer.getAddress()}`);

  const keeperAlgebra = await new MarginlyKeeperAlgebra__factory().connect(treasury).deploy();
  logger.info(`keeperAlgebra: ${await keeperAlgebra.getAddress()}`);

  logger.info('Initialization completed');

  return {
    accounts,
    treasury,
    usdc,
    weth,
    uniswap,
    uniswapFactory,
    marginlyFactory,
    marginlyPool,
    swapRouter,
    keeperAave,
    keeperUniswapV3,
    keeperBalancer,
    keeperAlgebra,
    gasReporter,
    logger,
  };
}
