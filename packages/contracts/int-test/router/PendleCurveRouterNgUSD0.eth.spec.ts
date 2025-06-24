import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC20,
  MarginlyRouter,
  MarginlyRouter__factory,
  PendleCurveRouterNgAdapter,
  PendleCurveRouterNgAdapter__factory,
} from '../../typechain-types';
import { constructSwap, Dex, resetFork, showGasUsage, SWAP_ONE, assertSwapEvent } from './shared/utils';
import { formatUnits, parseUnits } from 'ethers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { EthereumMainnetERC20BalanceOfSlot, setTokenBalance } from './shared/tokens';

async function initializeRouter(): Promise<{
  ptToken: ERC20;
  usdcToken: ERC20;
  usd0PlusPlusToken: ERC20;
  router: MarginlyRouter;
  pendleCurveAdapter: PendleCurveRouterNgAdapter;
  owner: SignerWithAddress;
  user: SignerWithAddress;
}> {
  const [owner, user] = await ethers.getSigners();
  const ptToken = await ethers.getContractAt('ERC20', '0xd86f4d98b34108cb4c059d540bd513f09b2ddd30');
  const usdcToken = await ethers.getContractAt('ERC20', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  const usd0PlusPlusToken = await ethers.getContractAt('ERC20', '0x35d8949372d46b7a3d5a56006ae77b215fc69bc0');
  const pendleMarket = '0x81f3a11db1de16f4f9ba8bf46b71d2b168c64899';
  const curveRouterAddress = '0x16c6521dff6bab339122a0fe25a9116693265353';

  // Route to make swap pt-usd0++ -> usd0++ -> usd0 -> usdc
  const routeInput: PendleCurveRouterNgAdapter.RouteInputStruct = {
    pendleMarket: pendleMarket,
    slippage: 20, // 20/100  = 20%
    curveSlippage: 10, // 10/1000000 = 0.001%
    curveRoute: [
      '0x35d8949372d46b7a3d5a56006ae77b215fc69bc0',
      '0x1d08e7adc263cfc70b1babe6dc5bb339c16eec52',
      '0x73a15fed60bf67631dc6cd7bc5b6e8da8190acf5',
      '0x14100f81e33c33ecc7cdac70181fb45b6e78569f',
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
    ], // curve route usd0++ -> usd0 -> usdc
    curveSwapParams: [
      [1, 0, 1, 1, 2],
      [0, 1, 1, 1, 2],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ],
    curvePools: [
      '0x1d08e7adc263cfc70b1babe6dc5bb339c16eec52',
      '0x14100f81e33c33ecc7cdac70181fb45b6e78569f',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
    ],
  };
  const pendleCurveAdapter = await new PendleCurveRouterNgAdapter__factory()
    .connect(owner)
    .deploy(curveRouterAddress, [routeInput]);

  const routerInput = {
    dexIndex: Dex.PendleCurveRouter,
    adapter: pendleCurveAdapter,
  };
  const router = await new MarginlyRouter__factory().connect(owner).deploy([routerInput]);

  await setTokenBalance(usdcToken.target, EthereumMainnetERC20BalanceOfSlot.USDC, user.address, parseUnits('1000', 6));
  await setTokenBalance(ptToken, EthereumMainnetERC20BalanceOfSlot.PTSUSDE, user.address, parseUnits('1000', 18));

  return {
    ptToken,
    usdcToken,
    usd0PlusPlusToken,
    router,
    pendleCurveAdapter,
    owner,
    user,
  };
}

// Tests for running in ethereum mainnet fork
describe('Pendle PT-usd0++ - usdc', () => {
  before(async () => {
    await resetFork(21493100);
  });

  describe('Pendle swap pre maturity', () => {
    let ptToken: ERC20;
    let usdc: ERC20;
    let usd0PlusPlusToken: ERC20;
    let router: MarginlyRouter;
    let pendleCurveAdapter: PendleCurveRouterNgAdapter;
    let user: SignerWithAddress;
    let owner: SignerWithAddress;

    beforeEach(async () => {
      ({
        ptToken,
        usdcToken: usdc,
        usd0PlusPlusToken,
        router,
        pendleCurveAdapter,
        owner,
        user,
      } = await initializeRouter());
    });

    it('USDC to pt-USD0++ exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `pt-usd0++ balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const usdcBalanceBefore = await usdc.balanceOf(user);
      console.log(
        `USDC balance before: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const usdcSwapAmount = parseUnits('1', 6);
      await usdc.connect(user).approve(router, usdcSwapAmount);

      const minPtAmountOut = parseUnits('0.9', 18); //parseUnits('900', 18);

      const tx = await router.connect(user).swapExactInput(swapCalldata, usdc, ptToken, usdcSwapAmount, minPtAmountOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.greaterThan(ptBalanceBefore);
      const usdcBalanceAfter = await usdc.balanceOf(user);
      console.log(`usdcBalanceAfter: ${formatUnits(usdcBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(usdcBalanceBefore - usdcBalanceAfter).to.be.lessThanOrEqual(usdcSwapAmount);
    });

    it('USDC to pt-USD0++ exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `pt-usd0++ balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const usdcBalanceBefore = await usdc.balanceOf(user);
      console.log(
        `USDC balance before: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );
      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);

      const exactPtOut = parseUnits('500', 18);
      const usdcMaxIn = parseUnits('1000', 6);
      await usdc.connect(user).approve(router, usdcMaxIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, usdc, ptToken, usdcMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter - ptBalanceBefore).to.be.eq(exactPtOut);
      const usdcBalanceAfter = await usdc.balanceOf(user);
      console.log(`usdcBalanceAfter: ${formatUnits(usdcBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(usdcBalanceBefore).to.be.greaterThan(usdcBalanceAfter);

      const usd0PlusPlusOnAdapter = await usd0PlusPlusToken.balanceOf(pendleCurveAdapter);
      console.log(
        `usd0PlusPlus stays on adapter: ${formatUnits(
          usd0PlusPlusOnAdapter,
          await usd0PlusPlusToken.decimals()
        )} ${await usd0PlusPlusToken.symbol()}`
      );

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: usdc.target,
          tokenOut: ptToken.target,
          amountIn: usdcBalanceBefore - usdcBalanceAfter,
          amountOut: ptBalanceAfter - ptBalanceBefore,
        },
        router,
        tx
      );
    });

    it('USDC to pt-USD0++ exact output, small amount', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `pt-usd0++ balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const usdcBalanceBefore = await usdc.balanceOf(user);
      console.log(
        `USDC balance before: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );
      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);

      const exactPtOut = parseUnits('1', 18);
      const usdcMaxIn = parseUnits('2', 6);
      await usdc.connect(user).approve(router, usdcMaxIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, usdc, ptToken, usdcMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter - ptBalanceBefore).to.be.eq(exactPtOut);
      const usdcBalanceAfter = await usdc.balanceOf(user);
      console.log(`usdcBalanceAfter: ${formatUnits(usdcBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(usdcBalanceBefore).to.be.greaterThan(usdcBalanceAfter);

      const usd0PlusPlusOnAdapter = await usd0PlusPlusToken.balanceOf(pendleCurveAdapter);
      console.log(
        `usd0PlusPlus stays on adapter: ${formatUnits(
          usd0PlusPlusOnAdapter,
          await usd0PlusPlusToken.decimals()
        )} ${await usd0PlusPlusToken.symbol()}`
      );

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: usdc.target,
          tokenOut: ptToken.target,
          amountIn: usdcBalanceBefore - usdcBalanceAfter,
          amountOut: ptBalanceAfter - ptBalanceBefore,
        },
        router,
        tx
      );
    });

    it('pt-USD0++ to USDC exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const usdcBalanceBefore = await usdc.balanceOf(user);
      console.log(`usdcBalanceBefore: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`);
      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const ptIn = ptBalanceBefore;
      await ptToken.connect(user).approve(router, ptIn);
      const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken, usdc, ptIn, 0);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore - ptBalanceAfter).to.be.eq(ptIn);
      const usdcBalanceAfter = await usdc.balanceOf(user);
      console.log(`usdcBalanceAfter: ${formatUnits(usdcBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(usdcBalanceAfter).to.be.greaterThan(usdcBalanceBefore);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: ptToken.target,
          tokenOut: usdc.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: usdcBalanceAfter - usdcBalanceBefore,
        },
        router,
        tx
      );
    });

    it('pt-USD0++ to USDC exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const usdcBalanceBefore = await usdc.balanceOf(user);
      console.log(`usdcBalanceBefore: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`);
      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const usdcOut = parseUnits('500', 6);
      const maxPtIn = parseUnits('600', 18);
      await ptToken.connect(user).approve(router, maxPtIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, ptToken, usdc, maxPtIn, usdcOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
      const usdcBalanceAfter = await usdc.balanceOf(user);
      console.log(`usdcBalanceAfter: ${formatUnits(usdcBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(usdcBalanceAfter - usdcBalanceBefore).to.be.eq(usdcOut);

      const usdcBalanceOnAdapter = await usdc.balanceOf(pendleCurveAdapter);
      console.log(
        `usdcBalanceOnAdapter: ${formatUnits(usdcBalanceOnAdapter, await usdc.decimals())} ${await usdc.symbol()}`
      );

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: ptToken.target,
          tokenOut: usdc.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: usdcBalanceAfter - usdcBalanceBefore,
        },
        router,
        tx
      );
    });
  });

  describe('Pendle swap post maturity', () => {
    let ptToken: ERC20;
    let usdc: ERC20;
    let usd0PlusPlusToken: ERC20;
    let router: MarginlyRouter;
    let pendleCurveAdapter: PendleCurveRouterNgAdapter;
    let user: SignerWithAddress;
    let owner: SignerWithAddress;

    beforeEach(async () => {
      ({
        ptToken,
        usdcToken: usdc,
        usd0PlusPlusToken,
        router,
        pendleCurveAdapter,
        owner,
        user,
      } = await initializeRouter());

      // move time and make after maturity
      await ethers.provider.send('evm_increaseTime', [180 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);
    });

    it('USDC to pt-usd0++ exact input, forbidden', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const sUsdeBalanceBefore = await usdc.balanceOf(user);
      console.log(
        `usdcBalanceBefore: ${formatUnits(sUsdeBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      await usdc.connect(user).approve(router, sUsdeBalanceBefore);
      const tx = router
        .connect(user)
        .swapExactInput(swapCalldata, usdc, ptToken, sUsdeBalanceBefore, (sUsdeBalanceBefore * 9n) / 10n);

      await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

      console.log('This swap is forbidden after maturity');
      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
      const sUsdeBalanceAfter = await usdc.balanceOf(user);
      console.log(`usdcBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(sUsdeBalanceAfter).to.be.eq(sUsdeBalanceBefore);
    });

    it('USDC to pt-usd0++ exact output, forbidden', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const usdcBalanceBefore = await usdc.balanceOf(user);
      console.log(
        `sUsdeBalanceBefore: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const ptOut = usdcBalanceBefore / 2n;
      await usdc.connect(user).approve(router, usdcBalanceBefore);
      const tx = router.connect(user).swapExactOutput(swapCalldata, usdc, ptToken, usdcBalanceBefore, ptOut);
      await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

      console.log('This swap is forbidden after maturity');
      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
      const usdcBalanceAfter = await usdc.balanceOf(user);
      console.log(`usdcBalanceAfter: ${formatUnits(usdcBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(usdcBalanceAfter).to.be.eq(usdcBalanceBefore);
    });

    it('pt-usd0++ to USDC exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const usdcBalanceBefore = await usdc.balanceOf(user);
      console.log(`usdcBalanceBefore: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`);

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const ptIn = ptBalanceBefore;
      await ptToken.connect(user).approve(router, ptIn);
      const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken, usdc, ptIn, 0);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore - ptBalanceAfter).to.be.eq(ptIn);
      const usdcBalanceAfter = await usdc.balanceOf(user);
      console.log(`usdcBalanceAfter: ${formatUnits(usdcBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(usdcBalanceAfter).to.be.greaterThan(usdcBalanceBefore);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: ptToken.target,
          tokenOut: usdc.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: usdcBalanceAfter - usdcBalanceBefore,
        },
        router,
        tx
      );
    });

    it('pt-usd0++ to USDC exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const usdcBalanceBefore = await usdc.balanceOf(user);
      console.log(`usdcBalanceBefore: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`);

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const usdcOut = parseUnits('900', 6);
      await ptToken.connect(user).approve(router, ptBalanceBefore);
      const maxPtIn = parseUnits('1000', 18);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, ptToken, usdc, maxPtIn, usdcOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
      const usdcBalanceAfter = await usdc.balanceOf(user);
      console.log(`sUsdeBalanceAfter: ${formatUnits(usdcBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(usdcBalanceAfter - usdcBalanceBefore).to.be.eq(usdcOut);

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: ptToken.target,
          tokenOut: usdc.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: usdcBalanceAfter - usdcBalanceBefore,
        },
        router,
        tx
      );
    });
  });
});
