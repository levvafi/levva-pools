import { expect } from 'chai';
import { ethers } from 'hardhat';
import { deployPendleBundlerWithPool } from './shared/fixtures';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { IERC20__factory } from '../../typechain-types';
import { PENDLE_MARKET_WSTETH_30_12_27, WSTETH } from './shared/registry';
import { parseUnits, ZeroAddress } from 'ethers';
import { EthereumMainnetERC20BalanceOfSlot, setTokenBalance } from './shared/tokens';

describe('LevvaPendleBundler', () => {
  it('long PT token, base amount', async () => {
    const { pool, bundler } = await loadFixture(deployPendleBundlerWithPool);
    const wstEth = IERC20__factory.connect(WSTETH, ethers.provider);

    const [_, user] = await ethers.getSigners();

    const approxParams = {
      guessMin: 0n,
      guessMax: parseUnits('2', 18),
      guessOffchain: 0n,
      maxIteration: 20n,
      eps: 10n ** 9n,
    };

    const wstEthAmountIn = parseUnits('1', 18);
    await setTokenBalance(wstEth.target, EthereumMainnetERC20BalanceOfSlot.WSTETH, user.address, wstEthAmountIn);
    const tokenInput = {
      tokenIn: WSTETH,
      netTokenIn: wstEthAmountIn,
      tokenMintSy: WSTETH,
      pendleSwap: ZeroAddress,
      swapData: {
        swapType: 0n,
        extRouter: ZeroAddress,
        extCalldata: Uint8Array.from([]),
        needScale: false,
      },
    };
    const limitOrderData = {
      limitRouter: ZeroAddress,
      epsSkipMarket: 0n,
      normalFills: [],
      flashFills: [],
      optData: Uint8Array.from([]),
    };

    await wstEth.connect(user).approve(bundler, wstEthAmountIn);
    const price = (await pool.getBasePrice()).inner;
    const longAmount = 10n * wstEthAmountIn;
    await bundler
      .connect(user)
      .enter(
        pool,
        PENDLE_MARKET_WSTETH_30_12_27,
        0,
        longAmount,
        false,
        (price * 101n) / 100n,
        approxParams,
        tokenInput,
        limitOrderData
      );

    const position = await pool.positions(user);
    expect(position._type).to.be.eq(3);
    expect(position.discountedBaseAmount).to.gt(longAmount);
    expect(position.discountedQuoteAmount).to.gt((longAmount * price) / 2n ** 96n);
  });

  it('long PT token, quote amount', async () => {
    const { pool, bundler } = await loadFixture(deployPendleBundlerWithPool);
    const wstEth = IERC20__factory.connect(WSTETH, ethers.provider);

    const [_, user] = await ethers.getSigners();

    const approxParams = {
      guessMin: 0n,
      guessMax: parseUnits('2', 18),
      guessOffchain: 0n,
      maxIteration: 20n,
      eps: 10n ** 9n,
    };

    const wstEthAmountIn = parseUnits('1', 18);
    await setTokenBalance(wstEth.target, EthereumMainnetERC20BalanceOfSlot.WSTETH, user.address, wstEthAmountIn);
    const tokenInput = {
      tokenIn: WSTETH,
      netTokenIn: wstEthAmountIn,
      tokenMintSy: WSTETH,
      pendleSwap: ZeroAddress,
      swapData: {
        swapType: 0n,
        extRouter: ZeroAddress,
        extCalldata: Uint8Array.from([]),
        needScale: false,
      },
    };
    const limitOrderData = {
      limitRouter: ZeroAddress,
      epsSkipMarket: 0n,
      normalFills: [],
      flashFills: [],
      optData: Uint8Array.from([]),
    };

    await wstEth.connect(user).approve(bundler, wstEthAmountIn);
    const price = (await pool.getBasePrice()).inner;
    const wethDebt = parseUnits('10', 18);
    await bundler
      .connect(user)
      .enter(
        pool,
        PENDLE_MARKET_WSTETH_30_12_27,
        0,
        wethDebt,
        true,
        (price * 101n) / 100n,
        approxParams,
        tokenInput,
        limitOrderData
      );

    const position = await pool.positions(user);
    expect(position._type).to.be.eq(3);
    expect(position.discountedBaseAmount).to.gt((wethDebt * 2n ** 96n) / price);
    expect(position.discountedQuoteAmount).to.be.eq(wethDebt);
  });
});
