import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { MarginlyParamsStruct } from '../typechain-types/contracts/MarginlyFactory';
import { createMarginlyFactory } from './shared/fixtures';
import snapshotGasCost from 'optifat-snapshot-gas-cost';
import { MarginlyPool } from '../typechain-types';
import { ethers } from 'hardhat';
import { PositionType, ZeroAddress } from './shared/utils';

describe('MarginlyFactory', () => {
  function getPoolParams() {
    const params: MarginlyParamsStruct = {
      interestRate: 54000, //5,4 %
      fee: 10000, //1%
      maxLeverage: 20,
      swapFee: 1000, // 0.1%
      mcSlippage: 50000, //5%
      positionMinAmount: 1, // 1 WEI
      quoteLimit: 1_000_000_000_000,
    };

    return {
      params,
      defaultSwapCallData: 0,
    };
  }

  it('should create pool', async () => {
    const { factory, uniswapPoolInfo, priceOracle } = await loadFixture(createMarginlyFactory);
    const quoteToken = uniswapPoolInfo.token0;
    const baseToken = uniswapPoolInfo.token1;
    const { params, defaultSwapCallData } = getPoolParams();

    const poolAddress = await factory.createPool.staticCall(
      quoteToken,
      baseToken,
      priceOracle,
      defaultSwapCallData,
      params
    );
    await snapshotGasCost(factory.createPool(quoteToken, baseToken, priceOracle, defaultSwapCallData, params));

    const poolFactory = await ethers.getContractFactory('MarginlyPool');
    const pool = poolFactory.attach(poolAddress) as MarginlyPool;

    const techPositionOwner = await factory.techPositionOwner();
    const techPosition = await pool.positions(techPositionOwner);
    expect(techPosition._type).to.be.eq(PositionType.Lend);
  });

  it('should change router address', async () => {
    const { factory } = await loadFixture(createMarginlyFactory);
    const routerAddress = await factory.swapRouter();

    await factory.changeSwapRouter(factory);

    const currentRouterAddress = await factory.swapRouter();
    expect(currentRouterAddress).to.be.not.eq(routerAddress);
    expect(currentRouterAddress).to.be.eq(factory);
  });

  it('should create the same pools', async () => {
    const { factory, uniswapPoolInfo, priceOracle } = await loadFixture(createMarginlyFactory);
    const quoteToken = uniswapPoolInfo.token0;
    const baseToken = uniswapPoolInfo.token1;
    const { params, defaultSwapCallData } = getPoolParams();

    await factory.createPool(quoteToken, baseToken, priceOracle, defaultSwapCallData, params);

    await factory.createPool(quoteToken, baseToken, priceOracle, defaultSwapCallData, params);
  });

  it('should raise error when trying to renounce ownership', async () => {
    const { factory } = await loadFixture(createMarginlyFactory);

    await expect(factory.renounceOwnership()).to.be.revertedWithCustomError(factory, 'Forbidden');
  });

  it('should raise error when trying to deploy factory with wrong arguments', async () => {
    const factoryFactory = await ethers.getContractFactory('MarginlyFactory');
    const nonZeroAddress = '0x0000000000000000000000000000000000000001';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const constructorArgs: [any, any, any, any, any] = [
      nonZeroAddress,
      nonZeroAddress,
      nonZeroAddress,
      nonZeroAddress,
      nonZeroAddress,
    ];

    for (let i = 0; i < constructorArgs.length; i++) {
      constructorArgs[i] = ZeroAddress;
      await expect(factoryFactory.deploy.call(factoryFactory, ...constructorArgs)).to.be.revertedWithCustomError(
        factoryFactory,
        'WrongValue'
      );
      constructorArgs[i] = nonZeroAddress;
    }
  });
});
