import { ethers } from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import {
  TestUniswapPool,
  TestUniswapFactory,
  PythOracle,
  MockPyth,
  ChainlinkOracle,
  MockChainlink,
  TestAlgebraPool,
  TestAlgebraFactory,
  PendleOracle,
  IPriceOracle,
  IPPYLpOracle,
  IPMarketV3,
  TestUniswapV2Factory,
  TestUniswapV2Pair,
  TestCurveEMAPool,
  TestCurveEMAPool__factory,
  MintableERC20,
  MockSequencerFeed,
  PendleMarketOracle,
  CurveOracle,
  TestCurveStableSwapNGPool,
  ICurve,
  MockPriceOracleV2,
  MarginlyCompositeOracle,
  IPPYLpOracle__factory,
  TestCurveStableSwapNGPool__factory,
} from '../../../typechain-types';
import {
  AlgebraTickOracle,
  AlgebraTickOracleDouble,
  UniswapV2Oracle,
  UniswapV3TickOracle,
  UniswapV3TickOracleDouble,
} from '../../../typechain-types';
import { one, oneX96 } from '../int/pendle/common';
import { Addressable, parseUnits } from 'ethers';

export const ZeroAddress = '0x0000000000000000000000000000000000000000';

//Some random addresses for testing purposes
export const Tokens = {
  USDC: '0x223A8AD119A1FAd4822869B7Cf79a74645470ad0',
  WBTC: '0xaA30A674e44F9Ba57D13eBA12ea499d55D24Cb9C',
  RDNT: '0x5D5Fa579300D123a7c01ECe355F82f5c0a379e80',
  MATIC: '0x2c88cC92Feeb3c5DE63f9A452B87aaC2E2510776',
  WETH: '0xeBEc6FA34180Ca3537bdeB4338b1B533a85920af',
  PENDLE: '0x79696e0859A0Af409617e39d817864AFF7565dBd',
  TBTC: '0xAB249FdD9F3e5D90d65007EAf5A6c4Ca05E1E72f',
  GMX: '0xBc030A9e840202971f881A70143B63AC77dbc199',
  TOKEN1: '0x0000000000000000000000000000000000000001',
  TOKEN2: '0x0000000000000000000000000000000000000002',
  TOKEN3: '0x0000000000000000000000000000000000000003',
};

export type Pool = {
  pool: string;
  tokenA: string;
  tokenB: string;
  fee: number;
};

export const initialPools: Pool[] = [
  {
    pool: '0xF338C5351b4Ff13749Dd6d02d22C105626aEd353',
    tokenA: Tokens.USDC,
    tokenB: Tokens.WETH,
    fee: 300,
  },
  {
    pool: '0x9F4780E33C91cB7fFc00C25a021C2c57A1e663D9',
    tokenA: Tokens.USDC,
    tokenB: Tokens.WETH,
    fee: 500,
  },
  {
    pool: '0xFb7056FcdcB97ac76987f6eBCeB54461d4dE5310',
    tokenA: Tokens.USDC,
    tokenB: Tokens.WETH,
    fee: 1000,
  },
  {
    pool: '0x457a4bE785aB1Af8e68132c267329A30c56f6B5C',
    tokenA: Tokens.WETH,
    tokenB: Tokens.WBTC,
    fee: 300,
  },
  {
    pool: '0xb9Cd78A7126326F1af5ddA3b7264E35d1a6F1fF4',
    tokenA: Tokens.USDC,
    tokenB: Tokens.MATIC,
    fee: 300,
  },
  {
    pool: '0x37244f8eD493c1A2FB2004CD104fEEEd2E7d31A8',
    tokenA: Tokens.USDC,
    tokenB: Tokens.RDNT,
    fee: 300,
  },
  {
    pool: '0xc519a974aaCF8dA54d136860fe52f353a5232D15',
    tokenA: Tokens.USDC,
    tokenB: Tokens.WBTC,
    fee: 300,
  },
];

export const PythIds = {
  TBTC: '0x56a3121958b01f99fdc4e1fd01e81050602c7ace3a571918bb55c6a96657cca9',
  BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
};

export type OracleData = {
  oracle: UniswapV3TickOracle;
  pool: TestUniswapPool;
  uniswapFactory: TestUniswapFactory;
  quoteToken: string;
  baseToken: string;
};

async function createUniswapV3TickOracle(quoteToken: string, baseToken: string): Promise<OracleData> {
  const poolFactory = await ethers.getContractFactory('TestUniswapPool');
  const pool = await poolFactory.deploy(quoteToken, baseToken);
  // represents 2500 * 10 ** (-12) price value
  await pool.setTokenPriceAndTickCumulative(14073748835, 198080);

  const factory = await ethers.getContractFactory('TestUniswapFactory');
  const uniswapFactory = await factory.deploy([]);
  await uniswapFactory.addPool(pool);

  const oracleFactory = await ethers.getContractFactory('UniswapV3TickOracle');
  const oracle = await oracleFactory.deploy(uniswapFactory);
  await oracle.setOptions(quoteToken, baseToken, 900, 5, await pool.fee());
  return { oracle, pool, uniswapFactory, quoteToken, baseToken };
}

export async function createUniswapV3TickOracleForward(): Promise<OracleData> {
  return createUniswapV3TickOracle(Tokens.TOKEN1, Tokens.TOKEN2);
}

export async function createUniswapV3TickOracleBackward(): Promise<OracleData> {
  return createUniswapV3TickOracle(Tokens.TOKEN2, Tokens.TOKEN1);
}

export type OracleDoubleData = {
  oracle: UniswapV3TickOracleDouble;
  firstPool: TestUniswapPool;
  secondPool: TestUniswapPool;
  uniswapFactory: TestUniswapFactory;
  quoteToken: string;
  baseToken: string;
  intermediateToken: string;
};

async function createUniswapV3TickOracleDouble(
  quoteToken: string,
  baseToken: string,
  intermediateToken: string
): Promise<OracleDoubleData> {
  const poolFactory = await ethers.getContractFactory('TestUniswapPool');
  const firstPool = await poolFactory.deploy(intermediateToken, quoteToken);
  // represents 2500 * 10 ** (-12) price value
  await firstPool.setTokenPriceAndTickCumulative(14073748835, 198080);

  const secondPool = await poolFactory.deploy(intermediateToken, baseToken);
  // represents 44100 * 10 ** (-2) = 21^2 price value
  await secondPool.setTokenPriceAndTickCumulative(5910974510923776, -60894);

  const factory = await ethers.getContractFactory('TestUniswapFactory');
  const uniswapFactory = await factory.deploy([]);
  await uniswapFactory.addPool(firstPool);
  await uniswapFactory.addPool(secondPool);

  const oracleFactory = await ethers.getContractFactory('UniswapV3TickOracleDouble');
  const oracle = await oracleFactory.deploy(uniswapFactory);
  await oracle.setOptions(
    quoteToken,
    baseToken,
    900,
    5,
    await firstPool.fee(),
    await secondPool.fee(),
    intermediateToken
  );
  return { oracle, firstPool, secondPool, uniswapFactory, quoteToken, baseToken, intermediateToken };
}

// Naming convention below: last 3 letters represent token addresses order:
// Q -- quote, B -- base, I -- intermediate
// quoteToken < baseToken < intermediateToken
export async function createUniswapV3TickOracleDoubleQBI() {
  return createUniswapV3TickOracleDouble(Tokens.TOKEN1, Tokens.TOKEN2, Tokens.TOKEN3);
}

// quoteToken < intermediateToken < baseToken
export async function createUniswapV3TickOracleDoubleQIB() {
  return createUniswapV3TickOracleDouble(Tokens.TOKEN1, Tokens.TOKEN3, Tokens.TOKEN2);
}

//  baseToken < quoteToken < intermediateToken
export async function createUniswapV3TickOracleDoubleBQI() {
  return createUniswapV3TickOracleDouble(Tokens.TOKEN2, Tokens.TOKEN1, Tokens.TOKEN3);
}

// baseToken < intermediateToken < quoteToken
export async function createUniswapV3TickOracleDoubleBIQ() {
  return createUniswapV3TickOracleDouble(Tokens.TOKEN3, Tokens.TOKEN1, Tokens.TOKEN2);
}

// intermediateToken < quoteToken < baseToken
export async function createUniswapV3TickOracleDoubleIQB() {
  return createUniswapV3TickOracleDouble(Tokens.TOKEN2, Tokens.TOKEN3, Tokens.TOKEN1);
}

// intermediateToken < baseToken < quoteToken
export async function createUniswapV3TickOracleDoubleIBQ() {
  return createUniswapV3TickOracleDouble(Tokens.TOKEN3, Tokens.TOKEN2, Tokens.TOKEN1);
}

export type CurveOracleData = {
  oracle: CurveOracle;
  pool: TestCurveEMAPool | TestCurveStableSwapNGPool;
  coin0: string | Addressable;
  coin1: string | Addressable;
  quoteToken: MintableERC20;
  baseToken: MintableERC20;
  anotherToken: MintableERC20;
};

async function createCurveOracle(
  poolFactory: TestCurveEMAPool__factory | TestCurveStableSwapNGPool__factory,
  coin0: string | Addressable,
  coin1: string | Addressable,
  baseToken: MintableERC20,
  quoteToken: MintableERC20,
  anotherToken: MintableERC20,
  priceOracleMethodHaveArg: boolean,
  addPool: boolean = true
): Promise<CurveOracleData> {
  const pool = await poolFactory.deploy(coin0, coin1);

  const one = parseUnits('1', 18);
  await pool.setPrices(
    3000n * one, // last_price
    3100n * one, // ema_price
    3200n * one // price_oracle
  );

  const oracleFactory = await ethers.getContractFactory('CurveOracle');
  const oracle = await oracleFactory.deploy();
  if (addPool) {
    await oracle.addPool(pool, quoteToken, baseToken, priceOracleMethodHaveArg);
  }

  return { oracle, pool, coin0, coin1, quoteToken, baseToken, anotherToken };
}

export async function createCurveEMAOracleForward(): Promise<CurveOracleData> {
  const tokenFactory = await ethers.getContractFactory('MintableERC20');
  const usdtToken = await tokenFactory.deploy('USDT', 'Tether USD', 6);
  const wethToken = await tokenFactory.deploy('WETH', 'Wrapped Ether', 18);
  const anotherToken = await tokenFactory.deploy('USDC', 'Circle USD', 6);
  const poolFactory = await ethers.getContractFactory('TestCurveEMAPool');
  return createCurveOracle(poolFactory, wethToken.target, usdtToken.target, usdtToken, wethToken, anotherToken, false);
}

export async function createCurveEMAOracleBackward(): Promise<CurveOracleData> {
  const tokenFactory = await ethers.getContractFactory('MintableERC20');
  const usdtToken = await tokenFactory.deploy('USDT', 'Tether USD', 6);
  const wethToken = await tokenFactory.deploy('WETH', 'Wrapped Ether', 18);
  const anotherToken = await tokenFactory.deploy('USDC', 'Circle USD', 6);
  const poolFactory = await ethers.getContractFactory('TestCurveEMAPool');
  return createCurveOracle(poolFactory, wethToken.target, usdtToken.target, wethToken, usdtToken, anotherToken, false);
}

export async function createCurveEMAOracleWithoutAddingPool(): Promise<CurveOracleData> {
  const tokenFactory = await ethers.getContractFactory('MintableERC20');
  const usdtToken = await tokenFactory.deploy('USDT', 'Tether USD', 6);
  const wethToken = await tokenFactory.deploy('WETH', 'Wrapped Ether', 18);
  const anotherToken = await tokenFactory.deploy('USDC', 'Circle USD', 6);
  const poolFactory = await ethers.getContractFactory('TestCurveEMAPool');
  return createCurveOracle(
    poolFactory,
    wethToken.target,
    usdtToken.target,
    wethToken,
    usdtToken,
    anotherToken,
    false,
    false
  );
}

export async function createCurveNGOracleForward(): Promise<CurveOracleData> {
  const tokenFactory = await ethers.getContractFactory('MintableERC20');
  const usdtToken = await tokenFactory.deploy('USDT', 'Tether USD', 6);
  const wethToken = await tokenFactory.deploy('WETH', 'Wrapped Ether', 18);
  const anotherToken = await tokenFactory.deploy('USDC', 'Circle USD', 6);
  const poolFactory = await ethers.getContractFactory('TestCurveStableSwapNGPool');
  return createCurveOracle(poolFactory, wethToken.target, usdtToken.target, usdtToken, wethToken, anotherToken, true);
}

export async function createCurveNGOracleBackward(): Promise<CurveOracleData> {
  const tokenFactory = await ethers.getContractFactory('MintableERC20');
  const usdtToken = await tokenFactory.deploy('USDT', 'Tether USD', 6);
  const wethToken = await tokenFactory.deploy('WETH', 'Wrapped Ether', 18);
  const anotherToken = await tokenFactory.deploy('USDC', 'Circle USD', 6);
  const poolFactory = await ethers.getContractFactory('TestCurveStableSwapNGPool');
  return createCurveOracle(poolFactory, wethToken.target, usdtToken.target, wethToken, usdtToken, anotherToken, true);
}

export async function createCurveNGOracleWithoutAddingPool(): Promise<CurveOracleData> {
  const tokenFactory = await ethers.getContractFactory('MintableERC20');
  const usdtToken = await tokenFactory.deploy('USDT', 'Tether USD', 6);
  const wethToken = await tokenFactory.deploy('WETH', 'Wrapped Ether', 18);
  const anotherToken = await tokenFactory.deploy('USDC', 'Circle USD', 6);
  const poolFactory = await ethers.getContractFactory('TestCurveStableSwapNGPool');
  return createCurveOracle(
    poolFactory,
    wethToken.target,
    usdtToken.target,
    wethToken,
    usdtToken,
    anotherToken,
    true,
    false
  );
}

export type PythOracleData = {
  oracle: PythOracle;
  pyth: MockPyth;
  quoteToken: string | Addressable;
  baseToken: string | Addressable;
  pythId: string;
};

async function createPythOracle(
  quoteToken: string | Addressable,
  baseToken: string | Addressable,
  pythId: string
): Promise<PythOracleData> {
  const factory = await ethers.getContractFactory('MockPyth');
  const mockPyth = await factory.deploy();

  const oracleFactory = await ethers.getContractFactory('PythOracle');
  const oracle = await oracleFactory.deploy(mockPyth);
  const maxPriceAge = 86400; // 1 day
  await oracle.setPair(quoteToken, baseToken, pythId, maxPriceAge);
  return {
    oracle,
    pyth: mockPyth,
    pythId,
    quoteToken,
    baseToken,
  };
}

export async function createSomePythOracle() {
  const usdc = await (await ethers.getContractFactory('TestERC20')).deploy('USDC', 'USDC', 6);
  const tbtc = await (await ethers.getContractFactory('TestERC20')).deploy('TBTC', 'TBTC', 18);
  return createPythOracle(usdc.target, tbtc.target, PythIds.TBTC);
}

export type PythCompositeOracleData = {
  oracle: PythOracle;
  pyth: MockPyth;
  quoteToken: string | Addressable;
  intermediateToken: string | Addressable;
  baseToken: string | Addressable;
  quotePythId: string;
  basePythId: string;
};

async function createPythCompositeOracle(
  quoteToken: string | Addressable,
  intermediateToken: string | Addressable,
  baseToken: string | Addressable,
  quotePythId: string,
  basePythId: string
): Promise<PythCompositeOracleData> {
  const factory = await ethers.getContractFactory('MockPyth');
  const mockPyth = await factory.deploy();

  const oracleFactory = await ethers.getContractFactory('PythOracle');
  const oracle = await oracleFactory.deploy(mockPyth);
  const maxPriceAge = 86400; // 1 day
  await oracle.setPair(intermediateToken, quoteToken, quotePythId, maxPriceAge);
  await oracle.setPair(intermediateToken, baseToken, basePythId, maxPriceAge);
  await oracle.setCompositePair(quoteToken, intermediateToken, baseToken);
  return {
    oracle,
    pyth: mockPyth,
    quoteToken,
    intermediateToken,
    baseToken,
    quotePythId,
    basePythId,
  };
}

export async function createSomePythCompositeOracle() {
  const usdc = await (await ethers.getContractFactory('TestERC20')).deploy('USDC', 'USDC', 6);
  const weth = await (await ethers.getContractFactory('TestERC20')).deploy('WETH', 'WETH', 18);
  const wbtc = await (await ethers.getContractFactory('TestERC20')).deploy('WBTC', 'WBTC', 8);

  return createPythCompositeOracle(weth.target, usdc.target, wbtc.target, PythIds.ETH, PythIds.BTC);
}

export type ChainlinkOracleData = {
  oracle: ChainlinkOracle;
  chainlink: MockChainlink;
  sequencerFeed: MockSequencerFeed;
  decimals: number;
  quoteToken: string | Addressable;
  baseToken: string | Addressable;
};

async function createChainlinkOracle(
  quoteToken: string | Addressable,
  baseToken: string | Addressable,
  decimals: number
): Promise<ChainlinkOracleData> {
  const factory = await ethers.getContractFactory('MockChainlink');
  const mockChainlink = await factory.deploy(decimals);
  await mockChainlink.setUpdatedAt(await time.latest());

  const mockSequencerFeed = await (await ethers.getContractFactory('MockSequencerFeed')).deploy();

  const oracleFactory = await ethers.getContractFactory('ChainlinkOracle');
  const oracle = await oracleFactory.deploy(mockSequencerFeed);
  const maxPriceAge = 86400; // 1 day

  await oracle.setPair(quoteToken, baseToken, mockChainlink, maxPriceAge);
  return {
    oracle,
    chainlink: mockChainlink,
    sequencerFeed: mockSequencerFeed,
    decimals,
    quoteToken,
    baseToken,
  };
}

export async function createSomeChainlinkOracle() {
  const usdc = await (await ethers.getContractFactory('TestERC20')).deploy('USDC', 'USDC', 6);
  const tbtc = await (await ethers.getContractFactory('TestERC20')).deploy('TBTC', 'TBTC', 18);

  return createChainlinkOracle(usdc.target, tbtc.target, 8);
}

export type ChainlinkCompositeOracleData = {
  oracle: ChainlinkOracle;
  quoteChainlink: MockChainlink;
  baseChainlink: MockChainlink;
  sequencerFeed: MockSequencerFeed;
  quoteDecimals: bigint;
  baseDecimals: bigint;
  quoteToken: string | Addressable;
  intermediateToken: string | Addressable;
  baseToken: string | Addressable;
};

async function createChainlinkCompositeOracle(
  quoteToken: string | Addressable,
  intermediateToken: string | Addressable,
  baseToken: string | Addressable,
  quoteDecimals: bigint,
  baseDecimals: bigint
): Promise<ChainlinkCompositeOracleData> {
  const factory = await ethers.getContractFactory('MockChainlink');
  const mockQuoteChainlink = await factory.deploy(quoteDecimals);
  const mockBaseChainlink = await factory.deploy(baseDecimals);
  const currentTime = await time.latest();
  await mockBaseChainlink.setUpdatedAt(currentTime);
  await mockQuoteChainlink.setUpdatedAt(currentTime);

  const mockSequencerFeed = await (await ethers.getContractFactory('MockSequencerFeed')).deploy();

  const oracleFactory = await ethers.getContractFactory('ChainlinkOracle');
  const oracle = await oracleFactory.deploy(mockSequencerFeed);
  const maxPriceAge = 86400; // 1 day
  await oracle.setPair(intermediateToken, quoteToken, mockQuoteChainlink, maxPriceAge);
  await oracle.setPair(intermediateToken, baseToken, mockBaseChainlink, maxPriceAge);
  await oracle.setCompositePair(quoteToken, intermediateToken, baseToken);
  return {
    oracle,
    quoteChainlink: mockQuoteChainlink,
    baseChainlink: mockBaseChainlink,
    sequencerFeed: mockSequencerFeed,
    quoteDecimals,
    baseDecimals,
    quoteToken,
    intermediateToken,
    baseToken,
  };
}

export async function createSomeChainlinkCompositeOracle() {
  const usdc = await (await ethers.getContractFactory('TestERC20')).deploy('USDC', 'USDC', 6);
  const weth = await (await ethers.getContractFactory('TestERC20')).deploy('WETH', 'WETH', 18);
  const wbtc = await (await ethers.getContractFactory('TestERC20')).deploy('WBTC', 'WBTC', 8);

  return createChainlinkCompositeOracle(weth.target, usdc.target, wbtc.target, 18n, 8n);
}

export type AlgebraOracleData = {
  oracle: AlgebraTickOracle;
  pool: TestAlgebraPool;
  algebraFactory: TestAlgebraFactory;
  quoteToken: string;
  baseToken: string;
};

async function createAlgebraTickOracle(quoteToken: string, baseToken: string): Promise<AlgebraOracleData> {
  const poolFactory = await ethers.getContractFactory('TestAlgebraPool');
  const pool = await poolFactory.deploy(quoteToken, baseToken);
  // represents 2500 * 10 ** (-12) price value
  await pool.setTokenPriceAndTickCumulative(14073748835, 198080);

  const factory = await ethers.getContractFactory('TestAlgebraFactory');
  const algebraFactory = await factory.deploy();
  await algebraFactory.addPool(pool);

  const oracleFactory = await ethers.getContractFactory('AlgebraTickOracle');
  const oracle = await oracleFactory.deploy(algebraFactory);
  await oracle.setOptions(quoteToken, baseToken, 900, 5);
  return { oracle, pool, algebraFactory, quoteToken, baseToken };
}

export async function createAlgebraTickOracleForward(): Promise<AlgebraOracleData> {
  return createAlgebraTickOracle(Tokens.TOKEN1, Tokens.TOKEN2);
}

export async function createAlgebraTickOracleBackward(): Promise<AlgebraOracleData> {
  return createAlgebraTickOracle(Tokens.TOKEN2, Tokens.TOKEN1);
}

export type AlgebraOracleDoubleData = {
  oracle: AlgebraTickOracleDouble;
  firstPool: TestAlgebraPool;
  secondPool: TestAlgebraPool;
  algebraFactory: TestAlgebraFactory;
  quoteToken: string;
  baseToken: string;
  intermediateToken: string;
};

async function createAlgebraTickOracleDouble(
  quoteToken: string,
  baseToken: string,
  intermediateToken: string
): Promise<AlgebraOracleDoubleData> {
  const poolFactory = await ethers.getContractFactory('TestAlgebraPool');
  const firstPool = await poolFactory.deploy(intermediateToken, quoteToken);
  // represents 2500 * 10 ** (-12) price value
  await firstPool.setTokenPriceAndTickCumulative(14073748835, 198080);

  const secondPool = await poolFactory.deploy(intermediateToken, baseToken);
  // represents 44100 * 10 ** (-2) = 21^2 price value
  await secondPool.setTokenPriceAndTickCumulative(5910974510923776, -60894);

  const factory = await ethers.getContractFactory('TestAlgebraFactory');
  const algebraFactory = await factory.deploy();
  await algebraFactory.addPool(firstPool);
  await algebraFactory.addPool(secondPool);

  const oracleFactory = await ethers.getContractFactory('AlgebraTickOracleDouble');
  const oracle = await oracleFactory.deploy(algebraFactory);
  await oracle.setOptions(quoteToken, baseToken, 900, 5, intermediateToken);
  return { oracle, firstPool, secondPool, algebraFactory, quoteToken, baseToken, intermediateToken };
}

// Naming convention below: last 3 letters represent token addresses order:
// Q -- quote, B -- base, I -- intermediate
// quoteToken < baseToken < intermediateToken
export async function createAlgebraTickOracleDoubleQBI() {
  return createAlgebraTickOracleDouble(Tokens.TOKEN1, Tokens.TOKEN2, Tokens.TOKEN3);
}

// quoteToken < intermediateToken < baseToken
export async function createAlgebraTickOracleDoubleQIB() {
  return createAlgebraTickOracleDouble(Tokens.TOKEN1, Tokens.TOKEN3, Tokens.TOKEN2);
}

//  baseToken < quoteToken < intermediateToken
export async function createAlgebraTickOracleDoubleBQI() {
  return createAlgebraTickOracleDouble(Tokens.TOKEN2, Tokens.TOKEN1, Tokens.TOKEN3);
}

// baseToken < intermediateToken < quoteToken
export async function createAlgebraTickOracleDoubleBIQ() {
  return createAlgebraTickOracleDouble(Tokens.TOKEN3, Tokens.TOKEN1, Tokens.TOKEN2);
}

// intermediateToken < quoteToken < baseToken
export async function createAlgebraTickOracleDoubleIQB() {
  return createAlgebraTickOracleDouble(Tokens.TOKEN2, Tokens.TOKEN3, Tokens.TOKEN1);
}

// intermediateToken < baseToken < quoteToken
export async function createAlgebraTickOracleDoubleIBQ() {
  return createAlgebraTickOracleDouble(Tokens.TOKEN3, Tokens.TOKEN2, Tokens.TOKEN1);
}
export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: bigint;
}

export interface PendleOracleCaseParams {
  pt: TokenInfo;
  sy: TokenInfo;
  yqt: TokenInfo;
  qt: TokenInfo;
  secondsAgo: number;
  secondsAgoLiquidation: number;
  oracle: PendleOracle;
  pendlePtLpOracle: IPPYLpOracle;
  secondaryPoolOracle: IPriceOracle;
  pendleMarket: IPMarketV3;
}

export async function createPendleCaseEzETH27Jun2024(): Promise<PendleOracleCaseParams> {
  const camelotPoolFactory = '0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B';
  const pt = <TokenInfo>{
    address: '0x8EA5040d423410f1fdc363379Af88e1DB5eA1C34',
    symbol: 'PT-ezETH-27JUN2024',
    decimals: 18n,
  };

  const sy = <TokenInfo>{
    address: '0x0dE802e3D6Cc9145A150bBDc8da9F988a98c5202',
    symbol: 'SY-ezETH',
    decimals: 18n,
  };

  const yqt = <TokenInfo>{
    address: '0x2416092f143378750bb29b79eD961ab195CcEea5',
    symbol: 'ezETH',
    decimals: 18n,
  };

  const qt = <TokenInfo>{
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    symbol: 'WETH',
    decimals: 18n,
  };

  const secondsAgo = 1000;
  const secondsAgoLiquidation = 100;
  const pendleMarket = '0x5E03C94Fc5Fb2E21882000A96Df0b63d2c4312e2';
  const pendlePtLpOracle = '0x1Fd95db7B7C0067De8D45C0cb35D59796adfD187';
  // const camelotPool = '0xaa45265a94c93802be9511e426933239117e658f';
  const secondaryPoolOracle = await (await ethers.getContractFactory('AlgebraTickOracle')).deploy(camelotPoolFactory);
  await secondaryPoolOracle.setOptions(qt.address, yqt.address, secondsAgo, secondsAgoLiquidation);

  const oracle = await (await ethers.getContractFactory('PendleOracle')).deploy(pendlePtLpOracle);
  await oracle.setPair(
    qt.address,
    pt.address,
    pendleMarket,
    secondaryPoolOracle,
    yqt.address,
    secondsAgo,
    secondsAgoLiquidation
  );

  return {
    oracle,
    pt,
    qt,
    secondaryPoolOracle,
    secondsAgo,
    secondsAgoLiquidation,
    sy,
    yqt,
    pendleMarket: await ethers.getContractAt('PendleMarketV3', pendleMarket),
    pendlePtLpOracle: IPPYLpOracle__factory.connect(pendlePtLpOracle),
  };
}

export async function createPendleCaseWeETH27Jun2024(): Promise<PendleOracleCaseParams> {
  const uniswapPoolFactory = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
  const pt = <TokenInfo>{
    address: '0x1c27Ad8a19Ba026ADaBD615F6Bc77158130cfBE4',
    symbol: 'PT-weETH-27JUN2024',
    decimals: 18n,
  };

  const sy = <TokenInfo>{
    address: '0xa6C895EB332E91c5b3D00B7baeEAae478cc502DA',
    symbol: 'SY-weETH',
    decimals: 18n,
  };

  const yqt = <TokenInfo>{
    address: '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe',
    symbol: 'weETH',
    decimals: 18n,
  };

  const qt = <TokenInfo>{
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    symbol: 'WETH',
    decimals: 18n,
  };

  const secondsAgo = 1000;
  const secondsAgoLiquidation = 100;
  const pendleMarket = '0x952083cde7aaa11AB8449057F7de23A970AA8472';
  const pendlePtLpOracle = '0x1Fd95db7B7C0067De8D45C0cb35D59796adfD187';
  // const uniswapPool = '0x14353445c8329Df76e6f15e9EAD18fA2D45A8BB6';
  const uniswapPoolFee = 100;
  const secondaryPoolOracle = await (await ethers.getContractFactory('UniswapV3TickOracle')).deploy(uniswapPoolFactory);
  await secondaryPoolOracle.setOptions(qt.address, yqt.address, secondsAgo, secondsAgoLiquidation, uniswapPoolFee);

  const oracle = await (await ethers.getContractFactory('PendleOracle')).deploy(pendlePtLpOracle);
  await oracle.setPair(
    qt.address,
    pt.address,
    pendleMarket,
    secondaryPoolOracle,
    yqt.address,
    secondsAgo,
    secondsAgoLiquidation
  );

  return {
    oracle,
    pt,
    qt,
    secondaryPoolOracle,
    secondsAgo,
    secondsAgoLiquidation,
    sy,
    yqt,
    pendleMarket: await ethers.getContractAt('PendleMarketV3', pendleMarket),
    pendlePtLpOracle: IPPYLpOracle__factory.connect(pendlePtLpOracle),
  };
}

export async function createPendleCaseUSDe29Aug2024(): Promise<PendleOracleCaseParams> {
  const camelotFactory = '0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B';
  const pt = <TokenInfo>{
    address: '0xad853EB4fB3Fe4a66CdFCD7b75922a0494955292',
    symbol: 'PT-USDe-29AUG2024',
    decimals: 18n,
  };

  const sy = <TokenInfo>{
    address: '0xb3C24D9dcCC2Ec5f778742389ffe448E295B84e0',
    symbol: 'SY-USDe',
    decimals: 18n,
  };

  const yqt = <TokenInfo>{
    address: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34',
    symbol: 'USDe',
    decimals: 18n,
  };

  const qt = <TokenInfo>{
    address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    symbol: 'USDC',
    decimals: 6n,
  };

  const secondsAgo = 1000;
  const secondsAgoLiquidation = 100;
  const pendleMarket = '0x2dfaf9a5e4f293bceede49f2dba29aacdd88e0c4';
  const pendlePtLpOracle = '0x1Fd95db7B7C0067De8D45C0cb35D59796adfD187';
  // const uniswapPool = '0x14353445c8329Df76e6f15e9EAD18fA2D45A8BB6';
  const secondaryPoolOracle = await (await ethers.getContractFactory('AlgebraTickOracle')).deploy(camelotFactory);
  await secondaryPoolOracle.setOptions(qt.address, yqt.address, secondsAgo, secondsAgoLiquidation);

  const oracle = await (await ethers.getContractFactory('PendleOracle')).deploy(pendlePtLpOracle);
  await oracle.setPair(
    qt.address,
    pt.address,
    pendleMarket,
    secondaryPoolOracle,
    yqt.address,
    secondsAgo,
    secondsAgoLiquidation
  );

  return {
    oracle,
    pt,
    qt,
    secondaryPoolOracle,
    secondsAgo,
    secondsAgoLiquidation,
    sy,
    yqt,
    pendleMarket: await ethers.getContractAt('PendleMarketV3', pendleMarket),
    pendlePtLpOracle: IPPYLpOracle__factory.connect(pendlePtLpOracle),
  };
}

export async function createPendleCaseRsETH27Jun2024(): Promise<PendleOracleCaseParams> {
  const camelotPoolFactory = '0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B';
  const pt = <TokenInfo>{
    address: '0xAFD22F824D51Fb7EeD4778d303d4388AC644b026',
    symbol: 'PT-rsETH-27JUN2024',
    decimals: 18n,
  };

  const sy = <TokenInfo>{
    address: '0xf176fB51F4eB826136a54FDc71C50fCd2202E272',
    symbol: 'SY-rsETH',
    decimals: 18n,
  };

  const yqt = <TokenInfo>{
    address: '0x4186BFC76E2E237523CBC30FD220FE055156b41F',
    symbol: 'rsETH',
    decimals: 18n,
  };

  const qt = <TokenInfo>{
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    symbol: 'WETH',
    decimals: 18n,
  };

  const secondsAgo = 1000;
  const secondsAgoLiquidation = 100;
  const pendleMarket = '0x6Ae79089b2CF4be441480801bb741A531d94312b';
  const pendlePtLpOracle = '0x1Fd95db7B7C0067De8D45C0cb35D59796adfD187';
  // const camelotPool = '0xb355ccE5CBAF411bd56e3b092F5AA10A894083ae';
  const secondaryPoolOracle = await (await ethers.getContractFactory('AlgebraTickOracle')).deploy(camelotPoolFactory);
  await secondaryPoolOracle.setOptions(qt.address, yqt.address, secondsAgo, secondsAgoLiquidation);

  const oracle = await (await ethers.getContractFactory('PendleOracle')).deploy(pendlePtLpOracle);
  await oracle.setPair(
    qt.address,
    pt.address,
    pendleMarket,
    secondaryPoolOracle,
    yqt.address,
    secondsAgo,
    secondsAgoLiquidation
  );

  return {
    oracle,
    pt,
    qt,
    secondaryPoolOracle,
    secondsAgo,
    secondsAgoLiquidation,
    sy,
    yqt,
    pendleMarket: await ethers.getContractAt('PendleMarketV3', pendleMarket),
    pendlePtLpOracle: IPPYLpOracle__factory.connect(pendlePtLpOracle),
  };
}

export async function createPendleCaseWstEth28Mar2024(): Promise<PendleOracleCaseParams> {
  const uniswapPoolFactory = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
  const pt = <TokenInfo>{
    address: '0x5A4e68E1F82dD4eAFBda13e47E0EC3cc452ED521',
    symbol: 'PT-wstETH-28MAR2024',
    decimals: 18n,
  };

  const sy = <TokenInfo>{
    address: '0x80c12D5b6Cc494632Bf11b03F09436c8B61Cc5Df',
    symbol: 'SY-wstETH',
    decimals: 18n,
  };

  const yqt = <TokenInfo>{
    address: '0x5979D7b546E38E414F7E9822514be443A4800529',
    symbol: 'wstETH',
    decimals: 18n,
  };

  const qt = <TokenInfo>{
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    symbol: 'WETH',
    decimals: 18n,
  };

  const secondsAgo = 1000;
  const secondsAgoLiquidation = 100;
  const pendleMarket = '0x58F50De493B6bE3585558F95F208dE489C296E24';
  const pendlePtLpOracle = '0x1Fd95db7B7C0067De8D45C0cb35D59796adfD187';
  // const uniswapPool = '0x109830a1AAaD605BbF02a9dFA7B0B92EC2FB7dAa';
  const uniswapPoolFee = 100;
  const secondaryPoolOracle = await (await ethers.getContractFactory('UniswapV3TickOracle')).deploy(uniswapPoolFactory);
  await secondaryPoolOracle.setOptions(qt.address, yqt.address, secondsAgo, secondsAgoLiquidation, uniswapPoolFee);

  const oracle = await (await ethers.getContractFactory('PendleOracle')).deploy(pendlePtLpOracle);
  await oracle.setPair(
    qt.address,
    pt.address,
    pendleMarket,
    secondaryPoolOracle,
    yqt.address,
    secondsAgo,
    secondsAgoLiquidation
  );

  return {
    oracle,
    pt,
    qt,
    secondaryPoolOracle,
    secondsAgo,
    secondsAgoLiquidation,
    sy,
    yqt,
    pendleMarket: await ethers.getContractAt('PendleMarketV3', pendleMarket),
    pendlePtLpOracle: IPPYLpOracle__factory.connect(pendlePtLpOracle),
  };
}

export async function createPendleUnitTestCase(): Promise<PendleOracleCaseParams> {
  const mintableErc20Factory = await ethers.getContractFactory('MintableERC20');
  const ptContract = await mintableErc20Factory.deploy('PT', 'PT', 18);
  const syContract = await mintableErc20Factory.deploy('SY', 'SY', 18);
  const ytContract = await mintableErc20Factory.deploy('YT', 'YT', 18);
  const yqtContract = await mintableErc20Factory.deploy('YQT', 'YQT', 18);
  const qtContract = await mintableErc20Factory.deploy('QT', 'QT', 18);

  const pt = <TokenInfo>{
    address: await ptContract.getAddress(),
    symbol: 'PT',
    decimals: 18n,
  };

  const sy = <TokenInfo>{
    address: await syContract.getAddress(),
    symbol: 'SY',
    decimals: 18n,
  };

  const yqt = <TokenInfo>{
    address: await yqtContract.getAddress(),
    symbol: 'YQT',
    decimals: 18n,
  };

  const qt = <TokenInfo>{
    address: await qtContract.getAddress(),
    symbol: 'QT',
    decimals: 18n,
  };

  // 0.93
  const ptToAssetRate = (one * 93n) / 100n;
  // 0.91
  const lpToAssetRate = (one * 91n) / 100n;
  // 0.88
  const ptToSyRate = (one * 88n) / 100n;
  // 0.85
  const lpToSyRate = (one * 85n) / 100n;

  const pendlePtLpOracle = await (
    await ethers.getContractFactory('TestPendlePtLpOracle')
  ).deploy(ptToAssetRate, lpToAssetRate, ptToSyRate, lpToSyRate);

  const balancePrice = (oneX96 * 97n) / 100n;
  const margincallPrice = (oneX96 * 96n) / 100n;
  const secondaryPoolOracle = await (await ethers.getContractFactory('MockPriceOracle')).deploy();
  await secondaryPoolOracle.setPrice(balancePrice, margincallPrice);

  const currentBlock = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
  if (currentBlock === null) {
    throw new Error('Failed to obtain current block');
  }
  const expiryTimestamp = currentBlock.timestamp + 10 * 24 * 60 * 60;

  const pendleMarket = await (
    await ethers.getContractFactory('MockPendleMarket')
  ).deploy(ptContract, syContract, ytContract, expiryTimestamp);

  const secondsAgo = 900;
  const secondsAgoLiquidation = 5;
  const oracle = await (await ethers.getContractFactory('PendleOracle')).deploy(pendlePtLpOracle);
  await oracle.setPair(
    qt.address,
    pt.address,
    pendleMarket,
    secondaryPoolOracle,
    yqt.address,
    secondsAgo,
    secondsAgoLiquidation
  );

  return {
    oracle,
    pt,
    qt,
    secondaryPoolOracle,
    secondsAgo,
    secondsAgoLiquidation,
    sy,
    yqt,
    pendleMarket: pendleMarket as unknown as IPMarketV3,
    pendlePtLpOracle,
  };
}

export type TokenPair = {
  baseToken: string;
  quoteToken: string;
};

export type UniswapV2OracleData = {
  oracle: UniswapV2Oracle;
  pairs: TestUniswapV2Pair[];
  tokenPairs: TokenPair[];
  factory: TestUniswapV2Factory;
};

export async function createUniswapV2Oracle(): Promise<UniswapV2OracleData> {
  const windowSize = 60 * 60;
  const granularity = 60;

  const pairFactory = await ethers.getContractFactory('TestUniswapV2Factory');
  const factory = await pairFactory.deploy();

  const tokenPairs: TokenPair[] = [
    { baseToken: Tokens.WETH, quoteToken: Tokens.USDC },
    { quoteToken: Tokens.WETH, baseToken: Tokens.WBTC },
  ];
  const pairs = [];

  await factory.createPair(Tokens.USDC, Tokens.WETH);
  const usdcWethPair = await ethers.getContractAt('TestUniswapV2Pair', await factory.getPair(Tokens.USDC, Tokens.WETH));
  await usdcWethPair.setPriceCumulatives(
    8336972277168571907928125483464622022025251163418n,
    79842860134165886894026243979741n
  );
  await usdcWethPair.setReserves(7310295511n, 2042135526372070598n, 1711622327n);
  pairs.push(usdcWethPair);

  await factory.createPair(Tokens.WBTC, Tokens.WETH);
  const wbtcWethPair = await ethers.getContractAt('TestUniswapV2Pair', await factory.getPair(Tokens.WBTC, Tokens.WETH));
  await wbtcWethPair.setPriceCumulatives(
    2717295059900711890375220838382472017626120416460370n,
    82428671486905729838010896445n
  );
  await wbtcWethPair.setReserves(1568827n, 308864561753000328n, 1711618918n);
  pairs.push(wbtcWethPair);

  const oracleFactory = await ethers.getContractFactory('UniswapV2Oracle');
  const oracle = await oracleFactory.deploy(factory, windowSize, granularity);

  return {
    oracle,
    pairs,
    tokenPairs,
    factory,
  };
}

export async function createUniswapV2OracleWithPairs(): Promise<UniswapV2OracleData> {
  const oracleData = await createUniswapV2Oracle();

  await oracleData.oracle.addPairs(
    [
      { baseToken: Tokens.WETH, quoteToken: Tokens.USDC },
      { baseToken: Tokens.WBTC, quoteToken: Tokens.WETH },
    ],
    [
      { secondsAgo: 1800, secondsAgoLiquidation: 60 },
      { secondsAgo: 3600, secondsAgoLiquidation: 60 },
    ]
  );

  return oracleData;
}

export async function createUniswapV2OracleWithPairsAndObservations(): Promise<UniswapV2OracleData> {
  const oracleData = await createUniswapV2OracleWithPairs();

  for (let i = 0; i < 61; i++) {
    await time.increase(59);
    await oracleData.oracle.updateAll();
  }

  return oracleData;
}

export interface PendleMarketOracleCaseParams {
  pt: TokenInfo;
  sy: MintableERC20;
  ib: TokenInfo;
  secondsAgo: number;
  secondsAgoLiquidation: number;
  oracle: PendleMarketOracle;
  pendlePtLpOracle: IPPYLpOracle;
  pendleMarket: IPMarketV3;
}

export async function createPendleMarketOracleWithoutPairs(): Promise<PendleMarketOracleCaseParams> {
  const mintableErc20Factory = await ethers.getContractFactory('MintableERC20');
  const ptContract = await mintableErc20Factory.deploy('PT', 'PT', 18);
  const syContract = await mintableErc20Factory.deploy('SY', 'SY', 18);
  const ytContract = await mintableErc20Factory.deploy('YT', 'YT', 18);
  const ibContract = await mintableErc20Factory.deploy('IB', 'IB', 18);

  const pt = <TokenInfo>{
    address: await ptContract.getAddress(),
    symbol: 'PT',
    decimals: 18n,
  };

  const sy = <TokenInfo>{
    address: await syContract.getAddress(),
    symbol: 'SY',
    decimals: 18n,
  };

  const ib = <TokenInfo>{
    address: await ibContract.getAddress(),
    symbol: 'IB',
    decimals: 18n,
  };

  // 0.93
  const ptToAssetRate = (one * 93n) / 100n;
  // 0.91
  const lpToAssetRate = (one * 91n) / 100n;
  // 0.88
  const ptToSyRate = (one * 88n) / 100n;
  // 0.85
  const lpToSyRate = (one * 85n) / 100n;

  const pendlePtLpOracle = await (
    await ethers.getContractFactory('TestPendlePtLpOracle')
  ).deploy(ptToAssetRate, lpToAssetRate, ptToSyRate, lpToSyRate);

  const currentBlock = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
  if (currentBlock === null) {
    throw new Error('Failed to obtain current block');
  }
  const expiryTimestamp = currentBlock.timestamp + 10 * 24 * 60 * 60;

  const pendleMarket = await (
    await ethers.getContractFactory('MockPendleMarket')
  ).deploy(ptContract, syContract, ytContract, expiryTimestamp);

  const secondsAgo = 900;
  const secondsAgoLiquidation = 5;
  const oracle = await (await ethers.getContractFactory('PendleMarketOracle')).deploy(pendlePtLpOracle);

  return {
    oracle,
    pt,
    ib,
    secondsAgo,
    secondsAgoLiquidation,
    sy: syContract,
    pendleMarket: pendleMarket as unknown as IPMarketV3,
    pendlePtLpOracle,
  };
}

export async function createPendleMarketOracle(): Promise<PendleMarketOracleCaseParams> {
  const caseParams = await createPendleMarketOracleWithoutPairs();
  await caseParams.oracle.setPair(
    caseParams.ib.address,
    caseParams.pt.address,
    caseParams.pendleMarket,
    caseParams.secondsAgo,
    caseParams.secondsAgoLiquidation
  );

  return caseParams;
}

export async function createPendleMarketOracleAfterMaturity(): Promise<PendleMarketOracleCaseParams> {
  const caseParams = await createPendleMarketOracle();
  await ethers.provider.send('evm_increaseTime', [12 * 24 * 60 * 60]);
  await ethers.provider.send('evm_mine', []);
  return caseParams;
}

export interface CurveOracleCaseParams {
  pool: ICurve;
  baseToken: TokenInfo;
  quoteToken: TokenInfo;
  oracle: CurveOracle;
  priceOracleMethodHasArg: boolean;
  isToken0QuoteToken: boolean;
}

export async function createCurveCaseFrxEthWeth(): Promise<CurveOracleCaseParams> {
  const poolAddress = '0x1DeB3b1cA6afca0FF9C5cE9301950dC98Ac0D523';
  const baseToken = <TokenInfo>{
    address: '0x178412e79c25968a32e89b11f63B33F733770c2A',
    symbol: 'frxETH',
    decimals: 18n,
  };

  const quoteToken = <TokenInfo>{
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    symbol: 'WETH',
    decimals: 18n,
  };

  const oracle = await (await ethers.getContractFactory('CurveOracle')).deploy();

  await oracle.addPool(poolAddress, quoteToken.address, baseToken.address, false);
  const pool = await ethers.getContractAt('ICurve', poolAddress);
  return {
    pool,
    baseToken,
    quoteToken,
    oracle,
    priceOracleMethodHasArg: false,
    isToken0QuoteToken: true,
  };
}

export async function createCurveCaseCrvUsdUsdc(): Promise<CurveOracleCaseParams> {
  const poolAddress = '0xec090cf6DD891D2d014beA6edAda6e05E025D93d';
  const baseToken = <TokenInfo>{
    address: '0x498Bf2B1e120FeD3ad3D42EA2165E9b73f99C1e5',
    symbol: 'crvUSD',
    decimals: 18n,
  };

  const quoteToken = <TokenInfo>{
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    symbol: 'USDC',
    decimals: 6n,
  };

  const oracle = await (await ethers.getContractFactory('CurveOracle')).deploy();

  await oracle.addPool(poolAddress, quoteToken.address, baseToken.address, true);
  const pool = await ethers.getContractAt('ICurve', poolAddress);
  return {
    pool,
    baseToken,
    quoteToken,
    oracle,
    priceOracleMethodHasArg: true,
    isToken0QuoteToken: false,
  };
}

export async function createEmptyMarginlyCompositeOracle(): Promise<MarginlyCompositeOracle> {
  const compositeOracle = await (await ethers.getContractFactory('MarginlyCompositeOracle')).deploy();
  return compositeOracle;
}

type MarginlyCompositeOracleData = {
  oracle: MarginlyCompositeOracle;
  quoteToken: TokenInfo;
  intermediateToken: TokenInfo;
  baseToken: TokenInfo;
  quoteIntermediateOracle: MockPriceOracleV2;
  baseIntermediateOracle: MockPriceOracleV2;
};

export async function createMarginlyCompositeOracle(): Promise<MarginlyCompositeOracleData> {
  const compositeOracle = await createEmptyMarginlyCompositeOracle();
  const usdc: TokenInfo = {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    symbol: 'USDC',
    decimals: 6n,
  };

  const arb: TokenInfo = {
    address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    symbol: 'ARB',
    decimals: 18n,
  };

  const weth = <TokenInfo>{
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    symbol: 'WETH',
    decimals: 18n,
  };

  const oracle = await (await ethers.getContractFactory('MockPriceOracleV2')).deploy();
  {
    const mcPrice = 70757347443141900n; // arb/usdc = 0.89
    const balancePrice = 74757347443141900n; // arb/usdc = 0.94
    await oracle.setPrice(usdc.address, arb.address, balancePrice, mcPrice);
  }

  {
    const mcPrice = 293713709653472000000000000000000n; // weth/abr = 3 707,188
    const balancePrice = 306017264062733000000000000000000n; // weth/abr = 3 862,480
    await oracle.setPrice(arb.address, weth.address, balancePrice, mcPrice);
  }

  await compositeOracle.setPair(usdc.address, arb.address, weth.address, oracle, oracle);

  return {
    oracle: compositeOracle,
    quoteToken: usdc,
    intermediateToken: arb,
    baseToken: weth,
    quoteIntermediateOracle: oracle,
    baseIntermediateOracle: oracle,
  };
}
