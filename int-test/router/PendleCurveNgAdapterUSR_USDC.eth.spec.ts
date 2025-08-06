import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC20,
  MarginlyRouter,
  MarginlyRouter__factory,
  PendleCurveNgAdapter,
  PendleCurveNgAdapter__factory,
} from '../../typechain-types';
import { constructSwap, Dex, showGasUsage, SWAP_ONE, resetFork, assertSwapEvent } from './shared/utils';
import { formatUnits, parseUnits } from 'ethers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { EthereumMainnetERC20BalanceOfSlot, setTokenBalance } from './shared/tokens';

async function initializeRouter(): Promise<{
  ptToken: ERC20;
  usdcToken: ERC20;
  usrToken: ERC20;
  router: MarginlyRouter;
  pendleCurveAdapter: PendleCurveNgAdapter;
  owner: SignerWithAddress;
  user: SignerWithAddress;
}> {
  const [owner, user] = await ethers.getSigners();
  const ptToken = await ethers.getContractAt('ERC20', '0x5a5b93f762739fa94f3ecc0b34af2e56702e7f70');
  const usdcToken = await ethers.getContractAt('ERC20', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  const usrToken = await ethers.getContractAt('ERC20', '0x66a1E37c9b0eAddca17d3662D6c05F4DECf3e110');
  const pendleMarket = '0x33bda865c6815c906e63878357335b28f063936c';

  // Route to make swap PT-wstUSR -> USR -> USDC
  const routeInput: PendleCurveNgAdapter.RouteInputStruct = {
    pendleMarket: pendleMarket,
    slippage: 20, // 20/100  = 20%
    curveSlippage: 10, // 10/1000000 = 0.001%
    curvePool: '0x3eE841F47947FEFbE510366E4bbb49e145484195', // USR/USDC pool
    ibToken: usrToken,
    quoteToken: usdcToken,
  };
  const pendleCurveAdapter = await new PendleCurveNgAdapter__factory().connect(owner).deploy([routeInput]);

  const routerInput = {
    dexIndex: Dex.PendleCurve,
    adapter: pendleCurveAdapter,
  };
  const router = await new MarginlyRouter__factory().connect(owner).deploy([routerInput]);

  await setTokenBalance(usdcToken.target, EthereumMainnetERC20BalanceOfSlot.USDC, user.address, parseUnits('5000', 6));
  await setTokenBalance(
    ptToken.target,
    EthereumMainnetERC20BalanceOfSlot.PTSUSDE,
    user.address,
    parseUnits('5000', 18)
  );

  return {
    ptToken,
    usdcToken: usdcToken,
    usrToken: usrToken,
    router,
    pendleCurveAdapter,
    owner,
    user,
  };
}

// Tests for running in ethereum mainnet fork
describe('PendleCurveAdapter PT-wstUSR - USDC', () => {
  before(async () => {
    await resetFork(22500000);
  });

  describe('Pendle swap pre maturity', () => {
    let ptToken: ERC20;
    let usdc: ERC20;
    let usr: ERC20;
    let router: MarginlyRouter;
    let pendleCurveAdapter: PendleCurveNgAdapter;
    let user: SignerWithAddress;
    let owner: SignerWithAddress;

    beforeEach(async () => {
      ({ ptToken, usdcToken: usdc, usrToken: usr, router, pendleCurveAdapter, owner, user } = await initializeRouter());
    });

    it('USDC to PT-wstUSR exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `PT-wstUSR balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await usdc.balanceOf(user);
      console.log(
        `USDC balance before: ${formatUnits(USDCBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      const USDCSwapAmount = parseUnits('2000', 6);
      await usdc.connect(user).approve(router, USDCSwapAmount);

      const minPtAmountOut = parseUnits('1900', 18);

      const tx = await router.connect(user).swapExactInput(swapCalldata, usdc, ptToken, USDCSwapAmount, minPtAmountOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.greaterThan(ptBalanceBefore);
      const USDCBalanceAfter = await usdc.balanceOf(user);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(USDCBalanceBefore - USDCBalanceAfter).to.be.lessThanOrEqual(USDCSwapAmount);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: usdc.target,
          tokenOut: ptToken.target,
          amountIn: USDCSwapAmount,
          amountOut: ptBalanceAfter - ptBalanceBefore,
        },
        router,
        tx
      );
    });

    it('USDC to PT-wstUSR exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `PT-wstUSR balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await usdc.balanceOf(user);
      console.log(
        `USDC balance before: ${formatUnits(USDCBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );
      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);

      const exactPtOut = parseUnits('100', 18);
      const USDCMaxIn = parseUnits('250', 6);
      await usdc.connect(user).approve(router, USDCMaxIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, usdc, ptToken, USDCMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter - ptBalanceBefore).to.be.eq(exactPtOut);
      const USDCBalanceAfter = await usdc.balanceOf(user);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(USDCBalanceBefore).to.be.greaterThan(USDCBalanceAfter);

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: usdc.target,
          tokenOut: ptToken.target,
          amountIn: USDCBalanceBefore - USDCBalanceAfter,
          amountOut: ptBalanceAfter - ptBalanceBefore,
        },
        router,
        tx
      );

      const usrOnAdapter = await usr.balanceOf(pendleCurveAdapter);
      console.log(`usr stays on adapter: ${formatUnits(usrOnAdapter, await usr.decimals())} ${await usr.symbol()}`);
    });

    it('USDC to PT-wstUSR exact output, small amount', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `PT-wstUSR balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await usdc.balanceOf(user);
      console.log(
        `USDC balance before: ${formatUnits(USDCBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );
      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);

      const exactPtOut = parseUnits('0.12', 18);
      const USDCMaxIn = parseUnits('0.12', 6);
      await usdc.connect(user).approve(router, USDCMaxIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, usdc, ptToken, USDCMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter - ptBalanceBefore).to.be.eq(exactPtOut);
      const USDCBalanceAfter = await usdc.balanceOf(user);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(USDCBalanceBefore).to.be.greaterThan(USDCBalanceAfter);

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: usdc.target,
          tokenOut: ptToken.target,
          amountIn: USDCBalanceBefore - USDCBalanceAfter,
          amountOut: ptBalanceAfter - ptBalanceBefore,
        },
        router,
        tx
      );

      const usrOnAdapter = await usr.balanceOf(pendleCurveAdapter);
      console.log(`usr stays on adapter: ${formatUnits(usrOnAdapter, await usr.decimals())} ${await usr.symbol()}`);
    });

    it('PT-wstUSR to USDC exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await usdc.balanceOf(user);
      console.log(`USDCBalanceBefore: ${formatUnits(USDCBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`);
      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      const ptIn = parseUnits('100', 18);
      await ptToken.connect(user).approve(router, ptIn);
      const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken, usdc, ptIn, 0);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore - ptBalanceAfter).to.be.eq(ptIn);
      const USDCBalanceAfter = await usdc.balanceOf(user);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(USDCBalanceAfter).to.be.greaterThan(USDCBalanceBefore);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: ptToken.target,
          tokenOut: usdc.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: USDCBalanceAfter - USDCBalanceBefore,
        },
        router,
        tx
      );
    });

    it('PT-wstUSR to USDC exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await usdc.balanceOf(user);
      console.log(`USDCBalanceBefore: ${formatUnits(USDCBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`);
      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      const USDCOut = parseUnits('100', 6);
      const maxPtIn = parseUnits('120', 18);
      await ptToken.connect(user).approve(router, maxPtIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, ptToken, usdc, maxPtIn, USDCOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
      const USDCBalanceAfter = await usdc.balanceOf(user);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(USDCBalanceAfter - USDCBalanceBefore).to.be.eq(USDCOut);

      const USDCBalanceOnAdapter = await usdc.balanceOf(pendleCurveAdapter);
      console.log(
        `USDCBalanceOnAdapter: ${formatUnits(USDCBalanceOnAdapter, await usdc.decimals())} ${await usdc.symbol()}`
      );

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: ptToken.target,
          tokenOut: usdc.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: USDCBalanceAfter - USDCBalanceBefore,
        },
        router,
        tx
      );
    });
  });

  describe('Pendle swap post maturity', () => {
    let ptToken: ERC20;
    let USDC: ERC20;
    let usde: ERC20;
    let router: MarginlyRouter;
    let pendleCurveAdapter: PendleCurveNgAdapter;
    let user: SignerWithAddress;
    let owner: SignerWithAddress;

    beforeEach(async () => {
      ({
        ptToken,
        usdcToken: USDC,
        usrToken: usde,
        router,
        pendleCurveAdapter,
        owner,
        user,
      } = await initializeRouter());

      // move time and make after maturity
      await ethers.provider.send('evm_increaseTime', [180 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);
    });

    it('USDC to PT-wstUSR exact input, forbidden', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const sUsdeBalanceBefore = await USDC.balanceOf(user);
      console.log(
        `USDCBalanceBefore: ${formatUnits(sUsdeBalanceBefore, await USDC.decimals())} ${await USDC.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      await USDC.connect(user).approve(router, sUsdeBalanceBefore);
      const tx = router
        .connect(user)
        .swapExactInput(swapCalldata, USDC, ptToken, sUsdeBalanceBefore, (sUsdeBalanceBefore * 9n) / 10n);

      await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

      console.log('This swap is forbidden after maturity');
      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
      const sUsdeBalanceAfter = await USDC.balanceOf(user);
      console.log(`USDCBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await USDC.decimals())} ${await USDC.symbol()}`);
      expect(sUsdeBalanceAfter).to.be.eq(sUsdeBalanceBefore);
    });

    it('USDC to PT-wstUSR exact output, forbidden', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await USDC.balanceOf(user);
      console.log(
        `sUsdeBalanceBefore: ${formatUnits(USDCBalanceBefore, await USDC.decimals())} ${await USDC.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      const ptOut = USDCBalanceBefore / 2n;
      await USDC.connect(user).approve(router, USDCBalanceBefore);
      const tx = router.connect(user).swapExactOutput(swapCalldata, USDC, ptToken, USDCBalanceBefore, ptOut);
      await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

      console.log('This swap is forbidden after maturity');
      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
      const USDCBalanceAfter = await USDC.balanceOf(user);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await USDC.decimals())} ${await USDC.symbol()}`);
      expect(USDCBalanceAfter).to.be.eq(USDCBalanceBefore);
    });

    it('PT-wstUSR to USDC exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await USDC.balanceOf(user);
      console.log(`USDCBalanceBefore: ${formatUnits(USDCBalanceBefore, await USDC.decimals())} ${await USDC.symbol()}`);

      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      const ptIn = ptBalanceBefore;
      await ptToken.connect(user).approve(router, ptIn);
      const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken, USDC, ptIn, 0);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore - ptBalanceAfter).to.be.eq(ptIn);
      const USDCBalanceAfter = await USDC.balanceOf(user);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await USDC.decimals())} ${await USDC.symbol()}`);
      expect(USDCBalanceAfter).to.be.greaterThan(USDCBalanceBefore);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: ptToken.target,
          tokenOut: USDC.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: USDCBalanceAfter - USDCBalanceBefore,
        },
        router,
        tx
      );
    });

    it('PT-wstUSR to USDC exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await USDC.balanceOf(user);
      console.log(`USDCBalanceBefore: ${formatUnits(USDCBalanceBefore, await USDC.decimals())} ${await USDC.symbol()}`);

      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      const USDCOut = parseUnits('100', 6);
      await ptToken.connect(user).approve(router, ptBalanceBefore);
      const maxPtIn = parseUnits('130', 18);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, ptToken, USDC, maxPtIn, USDCOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
      const USDCBalanceAfter = await USDC.balanceOf(user);
      console.log(`sUsdeBalanceAfter: ${formatUnits(USDCBalanceAfter, await USDC.decimals())} ${await USDC.symbol()}`);
      expect(USDCBalanceAfter - USDCBalanceBefore).to.be.eq(USDCOut);

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: ptToken.target,
          tokenOut: USDC.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: USDCBalanceAfter - USDCBalanceBefore,
        },
        router,
        tx
      );
    });
  });
});
