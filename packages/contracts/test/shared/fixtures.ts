import { ethers } from 'hardhat';
import {
  MarginlyFactory,
  MarginlyPool,
  TestUniswapFactory,
  TestUniswapPool,
  TestERC20,
  TestSwapRouter,
  MockAavePool,
  MockAavePoolAddressesProvider,
  MockMarginlyPool,
  MockSwapRouter,
  MockMarginlyFactory,
  MarginlyKeeperUniswapV3,
  MockPriceOracle,
  MarginlyKeeperBalancer,
  TestBalancerVault,
  MarginlyKeeperAlgebra,
  TestAlgebraPool,
  MarginlyKeeperAave,
} from '../../typechain-types';
import { MarginlyParamsStruct } from '../../typechain-types/contracts/MarginlyFactory';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import {
  CallType,
  ZERO_ADDRESS,
  paramsDefaultLeverageWithoutIr,
  paramsLowLeverageWithoutIr,
  uniswapV3Swapdata,
} from './utils';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { Addressable, parseEther, parseUnits } from 'ethers';

/// @dev theme paddle front firm patient burger forward little enter pause rule limb
export const FeeHolder = '0x4c576Bf4BbF1d9AB9c359414e5D2b466bab085fa';

/// @dev tone buddy include ridge cheap because marriage sorry jungle question pretty vacuum
export const TechnicalPositionOwner = '0xDda7021A2F58a2C6E0C800692Cde7893b4462FB3';

export interface UniswapPoolInfo {
  token0: TestERC20;
  token1: TestERC20;
  fee: bigint;
  address: string;
  pool: TestUniswapPool;
}

export async function createToken(name: string, symbol: string): Promise<TestERC20> {
  const [_, signer] = await ethers.getSigners();
  const factory = await ethers.getContractFactory('TestERC20');
  const tokenContract = await factory.deploy(name, symbol);
  await signer.sendTransaction({
    to: tokenContract,
    value: parseEther('100'),
  });

  return tokenContract;
}

export async function createUniswapPool(): Promise<{
  uniswapPool: TestUniswapPool;
  token0: TestERC20;
  token1: TestERC20;
}> {
  const tokenA = await createToken('Token0', 'TKA');
  const tokenB = await createToken('Token1', 'TKB');

  const token0 = tokenA.target.toString().toLowerCase() < tokenB.target.toString().toLowerCase() ? tokenA : tokenB;
  const token1 = tokenA.target.toString().toLowerCase() < tokenB.target.toString().toLowerCase() ? tokenB : tokenA;

  const pool = await ethers.getContractFactory('TestUniswapPool');
  return {
    uniswapPool: await pool.deploy(token0, token1),
    token0,
    token1,
  };
}

export async function createUniswapFactory(): Promise<{
  uniswapFactory: TestUniswapFactory;
  uniswapPoolInfo: UniswapPoolInfo;
}> {
  const factory = await ethers.getContractFactory('TestUniswapFactory');
  const contract = await factory.deploy();
  const { uniswapPool: pool, token0, token1 } = await createUniswapPool();
  await contract.addPool(pool);
  const fee = await pool.fee();

  return {
    uniswapFactory: contract,
    uniswapPoolInfo: { pool, token0: token0, token1: token1, fee, address: pool.target.toString() },
  };
}

export async function createSwapRoute(uniswapPool: string): Promise<{ swapRouter: TestSwapRouter }> {
  const factory = await ethers.getContractFactory('TestSwapRouter');
  return {
    swapRouter: await factory.deploy(uniswapPool),
  };
}

export async function createMarginlyPoolImplementation(): Promise<{ poolImplementation: MarginlyPool }> {
  const factory = await ethers.getContractFactory('MarginlyPool');
  return {
    poolImplementation: await factory.deploy(),
  };
}

export async function createPriceOracleMock(): Promise<MockPriceOracle> {
  const factory = await ethers.getContractFactory('MockPriceOracle');
  return await factory.deploy();
}

export async function createMarginlyFactory(baseTokenIsWETH = true): Promise<{
  factory: MarginlyFactory;
  owner: SignerWithAddress;
  uniswapPoolInfo: UniswapPoolInfo;
  swapRouter: TestSwapRouter;
  priceOracle: MockPriceOracle;
}> {
  const { uniswapPoolInfo } = await createUniswapFactory();
  const { swapRouter } = await createSwapRoute(uniswapPoolInfo.address);
  const { poolImplementation } = await createMarginlyPoolImplementation();
  const priceOracle = await createPriceOracleMock();

  await uniswapPoolInfo.token0.mint(swapRouter, parseUnits('100000', 18));
  await uniswapPoolInfo.token1.mint(swapRouter, parseUnits('100000', 18));

  const factoryFactory = await ethers.getContractFactory('MarginlyFactory');
  const [owner] = await ethers.getSigners();
  const factory = (await factoryFactory.deploy(
    poolImplementation,
    swapRouter,
    FeeHolder,
    baseTokenIsWETH ? uniswapPoolInfo.token1 : uniswapPoolInfo.token0,
    TechnicalPositionOwner
  )) as MarginlyFactory;
  return { factory, owner, uniswapPoolInfo, swapRouter, priceOracle };
}

export function createMarginlyPool() {
  return createMarginlyPoolInternal(true);
}

export function createMarginlyPoolQuoteTokenIsWETH() {
  return createMarginlyPoolInternal(false);
}

async function createMarginlyPoolInternal(baseTokenIsWETH: boolean): Promise<{
  marginlyPool: MarginlyPool;
  factoryOwner: SignerWithAddress;
  uniswapPoolInfo: UniswapPoolInfo;
  quoteContract: TestERC20;
  baseContract: TestERC20;
  swapRouter: TestSwapRouter;
  marginlyFactory: MarginlyFactory;
  priceOracle: MockPriceOracle;
}> {
  const { factory, owner, uniswapPoolInfo, swapRouter, priceOracle } = await createMarginlyFactory(baseTokenIsWETH);

  const quoteToken = uniswapPoolInfo.token0.target;
  const baseToken = uniswapPoolInfo.token1.target;
  const defaultSwapCallData = 0;

  const params: MarginlyParamsStruct = {
    interestRate: 54000, //5,4 %
    fee: 20000, //2%
    maxLeverage: 20,
    swapFee: 1000, // 0.1%
    mcSlippage: 50000, //5%
    positionMinAmount: 12, // 12 Wei
    quoteLimit: 1_000_000,
  };

  const poolAddress = await factory.createPool.staticCall(
    quoteToken,
    baseToken,
    priceOracle,
    defaultSwapCallData,
    params
  );
  await factory.createPool(quoteToken, baseToken, priceOracle, defaultSwapCallData, params);

  const poolFactory = await ethers.getContractFactory('MarginlyPool');
  const pool = poolFactory.attach(poolAddress) as MarginlyPool;

  // mint for the first five signers and approve spend for marginlyPool
  const amountToDeposit = 5000n * 10n ** (await uniswapPoolInfo.token0.decimals());

  const signers = (await ethers.getSigners()).slice(0, 10);
  for (let i = 0; i < signers.length; i++) {
    await uniswapPoolInfo.token0.mint(signers[i].address, amountToDeposit);
    await uniswapPoolInfo.token1.mint(signers[i].address, amountToDeposit);

    await uniswapPoolInfo.token0.connect(signers[i]).approve(poolAddress, amountToDeposit);
    await uniswapPoolInfo.token1.connect(signers[i]).approve(poolAddress, amountToDeposit);
  }

  const techPositionOwner = await ethers.getImpersonatedSigner(TechnicalPositionOwner);
  const wallet = (await ethers.getSigners())[signers.length];
  await wallet.sendTransaction({
    to: TechnicalPositionOwner,
    value: (await wallet.provider.getBalance(wallet)) / 2n,
  });

  await uniswapPoolInfo.token0.mint(TechnicalPositionOwner, amountToDeposit);
  await uniswapPoolInfo.token1.mint(TechnicalPositionOwner, amountToDeposit);

  await uniswapPoolInfo.token0.connect(techPositionOwner).approve(poolAddress, amountToDeposit);
  await uniswapPoolInfo.token1.connect(techPositionOwner).approve(poolAddress, amountToDeposit);

  // await uniswapPoolInfo.token0.mint(pool, amountToDeposit);
  // await uniswapPoolInfo.token1.mint(pool, amountToDeposit);

  const [quoteContract, baseContract] = [uniswapPoolInfo.token0, uniswapPoolInfo.token1];

  return {
    marginlyPool: pool,
    factoryOwner: owner,
    uniswapPoolInfo,
    quoteContract,
    baseContract,
    swapRouter,
    marginlyFactory: factory,
    priceOracle,
  };
}

/**
 * Initialize system with 10 lenders
 * 5 short positions and 5 long positions
 */
export async function getInitializedPool(): Promise<{
  marginlyPool: MarginlyPool;
  factoryOwner: SignerWithAddress;
  uniswapPoolInfo: UniswapPoolInfo;
  wallets: SignerWithAddress[];
  shorters: SignerWithAddress[];
  longers: SignerWithAddress[];
  lenders: SignerWithAddress[];
}> {
  const { marginlyPool, factoryOwner, uniswapPoolInfo } = await createMarginlyPool();

  const amountToDeposit = 5000n * 10n ** (await uniswapPoolInfo.token0.decimals());
  const signers = await ethers.getSigners();
  for (let i = 0; i < signers.length; i++) {
    await uniswapPoolInfo.token0.mint(signers[i], amountToDeposit);
    await uniswapPoolInfo.token1.mint(signers[i], amountToDeposit);

    await uniswapPoolInfo.token0.connect(signers[i]).approve(marginlyPool, amountToDeposit);
    await uniswapPoolInfo.token1.connect(signers[i]).approve(marginlyPool, amountToDeposit);
  }

  const accounts = await ethers.getSigners();
  const lenders = accounts.slice(0, 10);
  const shorters = accounts.slice(10, 15);
  const longers = accounts.slice(15, 20);
  const other = accounts.slice(20, 30);
  const price = (await marginlyPool.getBasePrice()).inner;

  for (let i = 0; i < lenders.length; i++) {
    await marginlyPool
      .connect(lenders[i])
      .execute(CallType.DepositBase, 1000, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());
    await marginlyPool
      .connect(lenders[i])
      .execute(CallType.DepositQuote, 5000, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());
  }

  for (let i = 0; i < longers.length; i++) {
    await marginlyPool
      .connect(longers[i])
      .execute(CallType.DepositBase, 1000 + i * 100, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());
    await marginlyPool
      .connect(longers[i])
      .execute(CallType.Long, 500 + i * 20, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());
  }

  for (let i = 0; i < shorters.length; i++) {
    await marginlyPool
      .connect(shorters[i])
      .execute(CallType.DepositQuote, 1000 + i * 100, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());
    await marginlyPool
      .connect(shorters[i])
      .execute(CallType.Short, 500 + i * 20, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());
  }

  // shift time to 1 day
  await time.increase(24 * 60 * 60);

  return { marginlyPool, factoryOwner, uniswapPoolInfo, wallets: other, shorters, longers, lenders };
}

// pool with non-zero deleverage coeffs
export async function getDeleveragedPool(): Promise<{
  marginlyPool: MarginlyPool;
  factoryOwner: SignerWithAddress;
  uniswapPoolInfo: UniswapPoolInfo;
  wallets: SignerWithAddress[];
}> {
  const { marginlyPool, factoryOwner, uniswapPoolInfo } = await createMarginlyPool();

  await marginlyPool.connect(factoryOwner).setParameters(paramsDefaultLeverageWithoutIr);

  const amountToDeposit = 5000n * 10n ** (await uniswapPoolInfo.token0.decimals());
  const signers = await ethers.getSigners();
  for (let i = 0; i < signers.length; i++) {
    await uniswapPoolInfo.token0.mint(signers[i].address, amountToDeposit);
    await uniswapPoolInfo.token1.mint(signers[i].address, amountToDeposit);

    await uniswapPoolInfo.token0.connect(signers[i]).approve(marginlyPool, amountToDeposit);
    await uniswapPoolInfo.token1.connect(signers[i]).approve(marginlyPool, amountToDeposit);
  }

  const accounts = await (await ethers.getSigners()).slice(15, 20);
  const price = (await marginlyPool.getBasePrice()).inner;

  let lender = accounts[0];
  await marginlyPool
    .connect(lender)
    .execute(CallType.DepositBase, 10000, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());
  await marginlyPool
    .connect(lender)
    .execute(CallType.DepositQuote, 10000, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());

  let longer = accounts[1];
  await marginlyPool
    .connect(longer)
    .execute(CallType.DepositBase, 1000, 18000, price, false, ZERO_ADDRESS, uniswapV3Swapdata());

  let shorter = accounts[2];
  await marginlyPool
    .connect(shorter)
    .execute(CallType.DepositQuote, 100000, 20000, price, false, ZERO_ADDRESS, uniswapV3Swapdata());

  await marginlyPool.connect(factoryOwner).setParameters(paramsLowLeverageWithoutIr);
  await marginlyPool.connect(lender).execute(CallType.Reinit, 0, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());
  await marginlyPool.connect(factoryOwner).setParameters(paramsDefaultLeverageWithoutIr);

  await marginlyPool
    .connect(shorter)
    .execute(CallType.ClosePosition, 0, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());
  await marginlyPool
    .connect(shorter)
    .execute(CallType.WithdrawQuote, 100000, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());

  await marginlyPool
    .connect(lender)
    .execute(CallType.WithdrawQuote, 9000, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());

  const quoteDelevCoeff = await marginlyPool.quoteDelevCoeff();
  expect(quoteDelevCoeff).to.be.greaterThan(0);

  shorter = accounts[3];
  await marginlyPool
    .connect(shorter)
    .execute(CallType.DepositQuote, 100, 7200, price, false, ZERO_ADDRESS, uniswapV3Swapdata());

  longer = accounts[4];
  await marginlyPool
    .connect(longer)
    .execute(CallType.DepositBase, 10000, 8000, price, false, ZERO_ADDRESS, uniswapV3Swapdata());

  await marginlyPool.connect(factoryOwner).setParameters(paramsLowLeverageWithoutIr);
  await marginlyPool.connect(lender).execute(CallType.Reinit, 0, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());
  await marginlyPool.connect(factoryOwner).setParameters(paramsDefaultLeverageWithoutIr);

  // 99% of a price as limit is used to avoid precision issues in calculations
  await marginlyPool
    .connect(longer)
    .execute(CallType.ClosePosition, 0, 0, (price * 99n) / 100n, false, ZERO_ADDRESS, uniswapV3Swapdata());
  await marginlyPool
    .connect(longer)
    .execute(CallType.WithdrawBase, 100000, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());

  await marginlyPool
    .connect(lender)
    .execute(CallType.WithdrawBase, 10018, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());
  await marginlyPool
    .connect(lender)
    .execute(CallType.WithdrawQuote, 1001, 0, price, false, ZERO_ADDRESS, uniswapV3Swapdata());

  const baseDelevCoeff = await marginlyPool.baseDelevCoeff();
  expect(baseDelevCoeff).to.be.greaterThan(0);

  const other = accounts.slice(20, 30);

  return { marginlyPool, factoryOwner, uniswapPoolInfo, wallets: other };
}

export async function createAavePool(): Promise<MockAavePool> {
  const factory = await ethers.getContractFactory('MockAavePool');
  return factory.deploy();
}

export async function createAavePoolAddressProvider(
  poolAddress: string | Addressable
): Promise<MockAavePoolAddressesProvider> {
  const factory = await ethers.getContractFactory('MockAavePoolAddressesProvider');
  return factory.deploy(poolAddress);
}

export async function createMockMarginlyFactory(swapRouterAddress: string | Addressable): Promise<MockMarginlyFactory> {
  const factory = await ethers.getContractFactory('MockMarginlyFactory');
  return factory.deploy(swapRouterAddress);
}

export async function createMockMarginlyPool(
  marginlyFactory: string | Addressable,
  quoteToken: string | Addressable,
  baseToken: string | Addressable
): Promise<MockMarginlyPool> {
  const factory = await ethers.getContractFactory('MockMarginlyPool');
  return factory.deploy(marginlyFactory, quoteToken, baseToken);
}

export async function createSwapRouter(
  quoteToken: string | Addressable,
  baseToken: string | Addressable
): Promise<MockSwapRouter> {
  const factory = await ethers.getContractFactory('MockSwapRouter');
  return factory.deploy(quoteToken, baseToken);
}

export async function createMarginlyKeeperContract(): Promise<{
  marginlyKeeper: MarginlyKeeperAave;
  swapRouter: MockSwapRouter;
  baseToken: TestERC20;
  quoteToken: TestERC20;
  marginlyPool: MockMarginlyPool;
}> {
  const aavePool = await createAavePool();
  const addressesProvider = await createAavePoolAddressProvider(aavePool);
  const baseToken = await createToken('Base token', 'BT');
  const quoteToken = await createToken('Quote token', 'QT');
  const swapRouter = await createSwapRouter(quoteToken, baseToken);
  const marginlyFactory = await createMockMarginlyFactory(swapRouter);
  const marginlyPool = await createMockMarginlyPool(marginlyFactory, quoteToken, baseToken);

  const decimals = await baseToken.decimals();
  const mintAmount = 10000000000n * 10n ** decimals;

  await baseToken.mint(marginlyPool, mintAmount);
  await quoteToken.mint(marginlyPool, mintAmount);

  await baseToken.mint(swapRouter, mintAmount);
  await quoteToken.mint(swapRouter, mintAmount);

  await baseToken.mint(aavePool, mintAmount);
  await quoteToken.mint(aavePool, mintAmount);

  const factory = await ethers.getContractFactory('MarginlyKeeperAave');
  const marginlyKeeper = await factory.deploy(addressesProvider);

  return {
    marginlyKeeper,
    swapRouter,
    baseToken,
    quoteToken,
    marginlyPool,
  };
}

export async function createMarginlyKeeperUniswapV3Contract(): Promise<{
  marginlyKeeperUniswapV3: MarginlyKeeperUniswapV3;
  swapRouter: MockSwapRouter;
  baseToken: TestERC20;
  quoteToken: TestERC20;
  marginlyPool: MockMarginlyPool;
  uniswapPool: TestUniswapPool;
}> {
  const baseToken = await createToken('Base token', 'BT');
  const quoteToken = await createToken('Quote token', 'QT');

  const swapRouter = await createSwapRouter(quoteToken, baseToken);
  const marginlyFactory = await createMockMarginlyFactory(swapRouter);
  const marginlyPool = await createMockMarginlyPool(marginlyFactory, quoteToken, baseToken);
  const marginlyKeeperUniswapV3 = await (await ethers.getContractFactory('MarginlyKeeperUniswapV3')).deploy();
  const uniswapPool = await (await ethers.getContractFactory('TestUniswapPool')).deploy(quoteToken, baseToken);

  const decimals = await baseToken.decimals();
  const mintAmount = 10000000000n * 10n ** decimals;

  await baseToken.mint(marginlyPool, mintAmount);
  await quoteToken.mint(marginlyPool, mintAmount);

  await baseToken.mint(swapRouter, mintAmount);
  await quoteToken.mint(swapRouter, mintAmount);

  await baseToken.mint(uniswapPool, mintAmount);
  await quoteToken.mint(uniswapPool, mintAmount);

  return {
    marginlyKeeperUniswapV3,
    swapRouter,
    baseToken,
    quoteToken,
    marginlyPool,
    uniswapPool,
  };
}

export async function createMarginlyKeeperBalancer(): Promise<{
  keeper: MarginlyKeeperBalancer;
  swapRouter: MockSwapRouter;
  baseToken: TestERC20;
  quoteToken: TestERC20;
  marginlyPool: MockMarginlyPool;
  balancerVault: TestBalancerVault;
}> {
  const baseToken = await createToken('Base token', 'BT');
  const quoteToken = await createToken('Quote token', 'QT');

  const swapRouter = await createSwapRouter(quoteToken, baseToken);
  const marginlyFactory = await createMockMarginlyFactory(swapRouter);
  const marginlyPool = await createMockMarginlyPool(marginlyFactory, quoteToken, baseToken);
  const balancerVault = await (await ethers.getContractFactory('TestBalancerVault')).deploy();
  const keeper = await (await ethers.getContractFactory('MarginlyKeeperBalancer')).deploy(balancerVault);

  const decimals = await baseToken.decimals();
  const mintAmount = 10000000000n * 10n ** decimals;

  await baseToken.mint(marginlyPool, mintAmount);
  await quoteToken.mint(marginlyPool, mintAmount);

  await baseToken.mint(swapRouter, mintAmount);
  await quoteToken.mint(swapRouter, mintAmount);

  await baseToken.mint(balancerVault, mintAmount);
  await quoteToken.mint(balancerVault, mintAmount);

  return {
    keeper,
    swapRouter,
    baseToken,
    quoteToken,
    marginlyPool,
    balancerVault,
  };
}

export async function createMarginlyKeeperAlgebra(): Promise<{
  keeper: MarginlyKeeperAlgebra;
  swapRouter: MockSwapRouter;
  baseToken: TestERC20;
  quoteToken: TestERC20;
  marginlyPool: MockMarginlyPool;
  algebraPool: TestAlgebraPool;
}> {
  const baseToken = await createToken('Base token', 'BT');
  const quoteToken = await createToken('Quote token', 'QT');

  const swapRouter = await createSwapRouter(quoteToken, baseToken);
  const marginlyFactory = await createMockMarginlyFactory(swapRouter);
  const marginlyPool = await createMockMarginlyPool(marginlyFactory, quoteToken, baseToken);
  const keeper = await (await ethers.getContractFactory('MarginlyKeeperAlgebra')).deploy();
  const algebraPool = await (await ethers.getContractFactory('TestAlgebraPool')).deploy(quoteToken, baseToken);

  const decimals = await baseToken.decimals();
  const mintAmount = 10000000000n * 10n ** decimals;

  await baseToken.mint(marginlyPool, mintAmount);
  await quoteToken.mint(marginlyPool, mintAmount);

  await baseToken.mint(swapRouter, mintAmount);
  await quoteToken.mint(swapRouter, mintAmount);

  await baseToken.mint(algebraPool, mintAmount);
  await quoteToken.mint(algebraPool, mintAmount);

  return {
    keeper,
    swapRouter,
    baseToken,
    quoteToken,
    marginlyPool,
    algebraPool,
  };
}
