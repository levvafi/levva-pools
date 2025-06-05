import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import {
  createCurveEMAOracleBackward,
  createCurveEMAOracleForward,
  createCurveEMAOracleWithoutAddingPool,
  createCurveNGOracleBackward,
  createCurveNGOracleForward,
  createCurveNGOracleWithoutAddingPool,
  ZeroAddress,
} from './shared/fixtures';
import { ethers } from 'hardhat';
import { TestCurveEMAPool } from '../typechain-types';
import { Addressable } from 'ethers';

const X96One = 1n << 96n;

function assertOracleParamsIsEmpty(oracleParams: {
  pool: string | Addressable;
  isToken0Quote: boolean;
  baseDecimals: bigint;
  quoteDecimals: bigint;
}) {
  expect(oracleParams.pool).to.be.equal(ZeroAddress);
  expect(oracleParams.baseDecimals).to.be.equal(0);
  expect(oracleParams.quoteDecimals).to.be.equal(0);
  expect(oracleParams.isToken0Quote).to.be.equal(false);
}

function assertOracleParamsIsFilled(
  oracleParams: {
    pool: string | Addressable;
    isToken0Quote: boolean;
    priceOracleMethodHasArg: boolean;
    baseDecimals: bigint;
    quoteDecimals: bigint;
  },
  actualPool: string | Addressable,
  isToken0Quote: boolean,
  priceOracleMethodHasArg: boolean,
  baseDecimals: bigint,
  quoteDecimals: bigint
) {
  expect(oracleParams.pool).to.be.equal(actualPool);
  expect(oracleParams.baseDecimals).to.be.equal(baseDecimals);
  expect(oracleParams.quoteDecimals).to.be.equal(quoteDecimals);
  expect(oracleParams.isToken0Quote).to.be.equal(isToken0Quote);
  expect(oracleParams.priceOracleMethodHasArg).to.be.equal(priceOracleMethodHasArg);
}

describe('CurveEMAPriceOracle', () => {
  it('forward', async () => {
    const { oracle, pool, quoteToken, baseToken } = await loadFixture(createCurveEMAOracleForward);

    const quoteDecimals = await quoteToken.decimals();
    const baseDecimals = await baseToken.decimals();

    const params = await oracle.getParams(quoteToken, baseToken);
    assertOracleParamsIsFilled(params, pool.target, true, false, baseDecimals, quoteDecimals);

    const priceFromPool = await (pool as TestCurveEMAPool).price_oracle();

    const balancePriceX96 = await oracle.getBalancePrice(quoteToken, baseToken);
    const margincallPriceX96 = await oracle.getMargincallPrice(quoteToken, baseToken);

    const decimalsMultiplier = 10n ** (18n + baseDecimals - quoteDecimals);
    const expectedBalancePriceX96 = (priceFromPool * X96One) / decimalsMultiplier;
    const expectedMargincallPriceX96 = expectedBalancePriceX96;

    expect(balancePriceX96).to.be.equal(expectedBalancePriceX96);
    expect(margincallPriceX96).to.be.equal(expectedMargincallPriceX96);
  });

  it('backward', async () => {
    const { oracle, pool, quoteToken, baseToken } = await loadFixture(createCurveEMAOracleBackward);

    const quoteDecimals = await quoteToken.decimals();
    const baseDecimals = await baseToken.decimals();

    const params = await oracle.getParams(quoteToken, baseToken);
    assertOracleParamsIsFilled(params, pool.target, false, false, baseDecimals, quoteDecimals);

    let priceFromPool = await (pool as TestCurveEMAPool).price_oracle();

    const balancePriceX96 = await oracle.getBalancePrice(quoteToken, baseToken);
    const margincallPriceX96 = await oracle.getMargincallPrice(quoteToken, baseToken);

    const decimalsMultiplier = 10n ** (18n + quoteDecimals - baseDecimals);
    const expectedBalancePriceX96 = (X96One * decimalsMultiplier) / priceFromPool;
    const expectedMargincallPriceX96 = expectedBalancePriceX96;

    expect(balancePriceX96).to.be.equal(expectedBalancePriceX96);
    expect(margincallPriceX96).to.be.equal(expectedMargincallPriceX96);
  });

  it('zero price', async () => {
    const { oracle, pool, quoteToken, baseToken } = await loadFixture(createCurveEMAOracleBackward);
    await pool.setPrices(0, 0, 0);

    await expect(oracle.getBalancePrice(quoteToken, baseToken)).to.be.revertedWithCustomError(oracle, 'ZeroPrice');
    await expect(oracle.getMargincallPrice(quoteToken, baseToken)).to.be.revertedWithCustomError(oracle, 'ZeroPrice');
  });

  it('add pool rights', async () => {
    const [, user] = await ethers.getSigners();
    const {
      oracle: oracleOwnerConnected,
      pool,
      quoteToken,
      baseToken,
    } = await loadFixture(createCurveEMAOracleWithoutAddingPool);

    const quoteDecimals = await quoteToken.decimals();
    const baseDecimals = await baseToken.decimals();

    const paramsBefore = await oracleOwnerConnected.getParams(quoteToken, baseToken);
    assertOracleParamsIsEmpty(paramsBefore);

    const oracleUserConnected = oracleOwnerConnected.connect(user);
    await expect(oracleUserConnected.addPool(pool, quoteToken, baseToken, false)).to.be.revertedWithCustomError(
      oracleUserConnected,
      'OwnableUnauthorizedAccount'
    );

    await oracleOwnerConnected.addPool(pool, quoteToken, baseToken, false);
    const paramsAfter = await oracleOwnerConnected.getParams(quoteToken, baseToken);
    assertOracleParamsIsFilled(paramsAfter, pool.target, false, false, baseDecimals, quoteDecimals);
  });

  it('add pool invalid', async () => {
    const { oracle, pool, quoteToken, baseToken, anotherToken } = await loadFixture(
      createCurveEMAOracleWithoutAddingPool
    );

    await expect(oracle.addPool(ZeroAddress, baseToken, quoteToken, false)).to.be.revertedWithCustomError(
      oracle,
      'ZeroAddress'
    );
    await expect(oracle.addPool(pool, ZeroAddress, quoteToken, false)).to.be.revertedWithCustomError(
      oracle,
      'ZeroAddress'
    );
    await expect(oracle.addPool(pool, baseToken, ZeroAddress, false)).to.be.revertedWithCustomError(
      oracle,
      'ZeroAddress'
    );
    await expect(oracle.addPool(pool, baseToken, baseToken, false)).to.be.revertedWithCustomError(
      oracle,
      'InvalidTokenAddress'
    );
    await expect(oracle.addPool(pool, baseToken, anotherToken, false)).to.be.revertedWithCustomError(
      oracle,
      'InvalidTokenAddress'
    );
    await expect(oracle.addPool(pool, anotherToken, quoteToken, false)).to.be.revertedWithCustomError(
      oracle,
      'InvalidTokenAddress'
    );
    await expect(oracle.addPool(pool, quoteToken, baseToken, true)).to.be.revertedWithoutReason();

    await oracle.addPool(pool, quoteToken, baseToken, false);

    await expect(oracle.addPool(pool, quoteToken, baseToken, false)).to.be.revertedWithCustomError(
      oracle,
      'PairAlreadyExist'
    );
  });
});

describe('CurveOracle for CurveStableSwapNG', () => {
  it('forward', async () => {
    const { oracle, pool, quoteToken, baseToken } = await loadFixture(createCurveNGOracleForward);

    const quoteDecimals = await quoteToken.decimals();
    const baseDecimals = await baseToken.decimals();

    const params = await oracle.getParams(quoteToken, baseToken);
    assertOracleParamsIsFilled(params, pool.target, true, true, baseDecimals, quoteDecimals);

    const priceFromPool = await pool.price_oracle(0);

    const balancePriceX96 = await oracle.getBalancePrice(quoteToken, baseToken);
    const margincallPriceX96 = await oracle.getMargincallPrice(quoteToken, baseToken);

    const decimalsMultiplier = 10n ** (18n + baseDecimals - quoteDecimals);
    const expectedBalancePriceX96 = (priceFromPool * X96One) / decimalsMultiplier;
    const expectedMargincallPriceX96 = expectedBalancePriceX96;

    expect(balancePriceX96).to.be.equal(expectedBalancePriceX96);
    expect(margincallPriceX96).to.be.equal(expectedMargincallPriceX96);
  });

  it('backward', async () => {
    const { oracle, pool, quoteToken, baseToken } = await loadFixture(createCurveNGOracleBackward);

    const quoteDecimals = await quoteToken.decimals();
    const baseDecimals = await baseToken.decimals();

    const params = await oracle.getParams(quoteToken, baseToken);
    assertOracleParamsIsFilled(params, pool.target, false, true, baseDecimals, quoteDecimals);

    let priceFromPool = await pool.price_oracle(0);

    const balancePriceX96 = await oracle.getBalancePrice(quoteToken, baseToken);
    const margincallPriceX96 = await oracle.getMargincallPrice(quoteToken, baseToken);

    const decimalsMultiplier = 10n ** (18n + quoteDecimals - baseDecimals);
    const expectedBalancePriceX96 = (X96One * decimalsMultiplier) / priceFromPool;
    const expectedMargincallPriceX96 = expectedBalancePriceX96;

    expect(balancePriceX96).to.be.equal(expectedBalancePriceX96);
    expect(margincallPriceX96).to.be.equal(expectedMargincallPriceX96);
  });

  it('zero price', async () => {
    const { oracle, pool, quoteToken, baseToken } = await loadFixture(createCurveNGOracleBackward);
    await pool.setPrices(0, 0, 0);

    await expect(oracle.getBalancePrice(quoteToken, baseToken)).to.be.revertedWithCustomError(oracle, 'ZeroPrice');
    await expect(oracle.getMargincallPrice(quoteToken, baseToken)).to.be.revertedWithCustomError(oracle, 'ZeroPrice');
  });

  it('add pool invalid', async () => {
    const { oracle, pool, quoteToken, baseToken, anotherToken } = await loadFixture(
      createCurveNGOracleWithoutAddingPool
    );
    await expect(oracle.addPool(pool, baseToken, anotherToken, true)).to.be.revertedWithCustomError(
      oracle,
      'InvalidTokenAddress'
    );
    await expect(oracle.addPool(pool, anotherToken, quoteToken, true)).to.be.revertedWithCustomError(
      oracle,
      'InvalidTokenAddress'
    );
    await expect(oracle.addPool(pool, quoteToken, baseToken, false)).to.be.revertedWithoutReason();

    await oracle.addPool(pool, quoteToken, baseToken, true);

    await expect(oracle.addPool(pool, quoteToken, baseToken, true)).to.be.revertedWithCustomError(
      oracle,
      'PairAlreadyExist'
    );
  });
});
