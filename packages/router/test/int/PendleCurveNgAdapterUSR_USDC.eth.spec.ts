import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC20,
  MarginlyRouter,
  MarginlyRouter__factory,
  PendleCurveNgAdapter,
  PendleCurveNgAdapter__factory,
} from '../../typechain-types';
import { constructSwap, Dex, showGasUsage, SWAP_ONE, resetFork, assertSwapEvent } from '../shared/utils';
import { EthAddress } from '@marginly/common';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { EthereumMainnetERC20BalanceOfSlot, setTokenBalance } from '../shared/tokens';

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
  const ptToken = await ethers.getContractAt('ERC20', '0x23e60d1488525bf4685f53b3aa8e676c30321066');
  const usdcToken = await ethers.getContractAt('ERC20', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  const usrToken = await ethers.getContractAt('ERC20', '0x66a1E37c9b0eAddca17d3662D6c05F4DECf3e110');
  const pendleMarket = '0x09fa04aac9c6d1c6131352ee950cd67ecc6d4fb9';

  // Route to make swap PT-wstUSR -> USR -> USDC
  const routeInput: PendleCurveNgAdapter.RouteInputStruct = {
    pendleMarket: pendleMarket,
    slippage: 20, // 20/100  = 20%
    curveSlippage: 100, // 10/1000000 = 0.001%
    curvePool: '0x3eE841F47947FEFbE510366E4bbb49e145484195', //USR/USDC pool
    ibToken: usrToken.address,
    quoteToken: usdcToken.address,
  };
  const pendleCurveAdapter = await new PendleCurveNgAdapter__factory().connect(owner).deploy([routeInput]);

  const routerInput = {
    dexIndex: Dex.PendleCurve,
    adapter: pendleCurveAdapter.address,
  };
  const router = await new MarginlyRouter__factory().connect(owner).deploy([routerInput]);

  await setTokenBalance(
    usdcToken.address,
    EthereumMainnetERC20BalanceOfSlot.USDC,
    EthAddress.parse(user.address),
    parseUnits('5000', 6)
  );
  await setTokenBalance(
    ptToken.address,
    EthereumMainnetERC20BalanceOfSlot.PTSUSDE,
    EthAddress.parse(user.address),
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
    await resetFork(22366500);
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

    it.only('USDC to PT-wstUSR exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `PT-wstUSR balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await usdc.balanceOf(user.address);
      console.log(
        `USDC balance before: ${formatUnits(USDCBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurve], [SWAP_ONE]);
      const USDCSwapAmount = parseUnits('2000', 6);
      await usdc.connect(user).approve(router.address, USDCSwapAmount);

      const minPtAmountOut = parseUnits('2000', 18);

      const tx = await router
        .connect(user)
        .swapExactInput(swapCalldata, usdc.address, ptToken.address, USDCSwapAmount, minPtAmountOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.greaterThan(ptBalanceBefore);
      const USDCBalanceAfter = await usdc.balanceOf(user.address);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(USDCBalanceBefore.sub(USDCBalanceAfter)).to.be.lessThanOrEqual(USDCSwapAmount);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: usdc.address,
          tokenOut: ptToken.address,
          amountIn: USDCSwapAmount,
          amountOut: ptBalanceAfter.sub(ptBalanceBefore),
        },
        router,
        tx
      );
    });

    it('USDC to PT-wstUSR exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `PT-wstUSR balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await usdc.balanceOf(user.address);
      console.log(
        `USDC balance before: ${formatUnits(USDCBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );
      const swapCalldata = constructSwap([Dex.PendleCurve], [SWAP_ONE]);

      const exactPtOut = parseUnits('1', 8);
      const USDCMaxIn = parseUnits('2.5', 8);
      await usdc.connect(user).approve(router.address, USDCMaxIn);
      const tx = await router
        .connect(user)
        .swapExactOutput(swapCalldata, usdc.address, ptToken.address, USDCMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter.sub(ptBalanceBefore)).to.be.eq(exactPtOut);
      const USDCBalanceAfter = await usdc.balanceOf(user.address);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(USDCBalanceBefore).to.be.greaterThan(USDCBalanceAfter);

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: usdc.address,
          tokenOut: ptToken.address,
          amountIn: USDCBalanceBefore.sub(USDCBalanceAfter),
          amountOut: ptBalanceAfter.sub(ptBalanceBefore),
        },
        router,
        tx
      );

      const ebtcOnAdapter = await usr.balanceOf(pendleCurveAdapter.address);
      console.log(`ebtc stays on adapter: ${formatUnits(ebtcOnAdapter, await usr.decimals())} ${await usr.symbol()}`);
    });

    it('USDC to PT-wstUSR exact output, small amount', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `PT-wstUSR balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await usdc.balanceOf(user.address);
      console.log(
        `USDC balance before: ${formatUnits(USDCBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );
      const swapCalldata = constructSwap([Dex.PendleCurve], [SWAP_ONE]);

      const exactPtOut = parseUnits('0.0006', 8);
      const USDCMaxIn = parseUnits('0.0012', 8);
      await usdc.connect(user).approve(router.address, USDCMaxIn);
      const tx = await router
        .connect(user)
        .swapExactOutput(swapCalldata, usdc.address, ptToken.address, USDCMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter.sub(ptBalanceBefore)).to.be.eq(exactPtOut);
      const USDCBalanceAfter = await usdc.balanceOf(user.address);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(USDCBalanceBefore).to.be.greaterThan(USDCBalanceAfter);

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: usdc.address,
          tokenOut: ptToken.address,
          amountIn: USDCBalanceBefore.sub(USDCBalanceAfter),
          amountOut: ptBalanceAfter.sub(ptBalanceBefore),
        },
        router,
        tx
      );

      const ebtcOnAdapter = await usr.balanceOf(pendleCurveAdapter.address);
      console.log(`ebtc stays on adapter: ${formatUnits(ebtcOnAdapter, await usr.decimals())} ${await usr.symbol()}`);
    });

    it('PT-wstUSR to USDC exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await usdc.balanceOf(user.address);
      console.log(`USDCBalanceBefore: ${formatUnits(USDCBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`);
      const swapCalldata = constructSwap([Dex.PendleCurve], [SWAP_ONE]);
      const ptIn = parseUnits('0.1', 8);
      await ptToken.connect(user).approve(router.address, ptIn);
      const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken.address, usdc.address, ptIn, 0);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore.sub(ptBalanceAfter)).to.be.eq(ptIn);
      const USDCBalanceAfter = await usdc.balanceOf(user.address);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(USDCBalanceAfter).to.be.greaterThan(USDCBalanceBefore);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: ptToken.address,
          tokenOut: usdc.address,
          amountIn: ptBalanceBefore.sub(ptBalanceAfter),
          amountOut: USDCBalanceAfter.sub(USDCBalanceBefore),
        },
        router,
        tx
      );
    });

    it('PT-wstUSR to USDC exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await usdc.balanceOf(user.address);
      console.log(`USDCBalanceBefore: ${formatUnits(USDCBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`);
      const swapCalldata = constructSwap([Dex.PendleCurve], [SWAP_ONE]);
      const USDCOut = parseUnits('1', 8);
      const maxPtIn = parseUnits('1.2', 8);
      await ptToken.connect(user).approve(router.address, maxPtIn);
      const tx = await router
        .connect(user)
        .swapExactOutput(swapCalldata, ptToken.address, usdc.address, maxPtIn, USDCOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
      const USDCBalanceAfter = await usdc.balanceOf(user.address);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(USDCBalanceAfter.sub(USDCBalanceBefore)).to.be.eq(USDCOut);

      const USDCBalanceOnAdapter = await usdc.balanceOf(pendleCurveAdapter.address);
      console.log(
        `USDCBalanceOnAdapter: ${formatUnits(USDCBalanceOnAdapter, await usdc.decimals())} ${await usdc.symbol()}`
      );

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: ptToken.address,
          tokenOut: usdc.address,
          amountIn: ptBalanceBefore.sub(ptBalanceAfter),
          amountOut: USDCBalanceAfter.sub(USDCBalanceBefore),
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
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const sUsdeBalanceBefore = await USDC.balanceOf(user.address);
      console.log(
        `USDCBalanceBefore: ${formatUnits(sUsdeBalanceBefore, await USDC.decimals())} ${await USDC.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurve], [SWAP_ONE]);
      await USDC.connect(user).approve(router.address, sUsdeBalanceBefore);
      const tx = router
        .connect(user)
        .swapExactInput(
          swapCalldata,
          USDC.address,
          ptToken.address,
          sUsdeBalanceBefore,
          sUsdeBalanceBefore.mul(9).div(10)
        );

      await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

      console.log('This swap is forbidden after maturity');
      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
      const sUsdeBalanceAfter = await USDC.balanceOf(user.address);
      console.log(`USDCBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await USDC.decimals())} ${await USDC.symbol()}`);
      expect(sUsdeBalanceAfter).to.be.eq(sUsdeBalanceBefore);
    });

    it('USDC to PT-wstUSR exact output, forbidden', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await USDC.balanceOf(user.address);
      console.log(
        `sUsdeBalanceBefore: ${formatUnits(USDCBalanceBefore, await USDC.decimals())} ${await USDC.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurve], [SWAP_ONE]);
      const ptOut = USDCBalanceBefore.div(2);
      await USDC.connect(user).approve(router.address, USDCBalanceBefore);
      const tx = router
        .connect(user)
        .swapExactOutput(swapCalldata, USDC.address, ptToken.address, USDCBalanceBefore, ptOut);
      await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

      console.log('This swap is forbidden after maturity');
      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
      const USDCBalanceAfter = await USDC.balanceOf(user.address);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await USDC.decimals())} ${await USDC.symbol()}`);
      expect(USDCBalanceAfter).to.be.eq(USDCBalanceBefore);
    });

    it('PT-wstUSR to USDC exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await USDC.balanceOf(user.address);
      console.log(`USDCBalanceBefore: ${formatUnits(USDCBalanceBefore, await USDC.decimals())} ${await USDC.symbol()}`);

      const swapCalldata = constructSwap([Dex.PendleCurve], [SWAP_ONE]);
      const ptIn = ptBalanceBefore;
      await ptToken.connect(user).approve(router.address, ptIn);
      const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken.address, USDC.address, ptIn, 0);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore.sub(ptBalanceAfter)).to.be.eq(ptIn);
      const USDCBalanceAfter = await USDC.balanceOf(user.address);
      console.log(`USDCBalanceAfter: ${formatUnits(USDCBalanceAfter, await USDC.decimals())} ${await USDC.symbol()}`);
      expect(USDCBalanceAfter).to.be.greaterThan(USDCBalanceBefore);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: ptToken.address,
          tokenOut: USDC.address,
          amountIn: ptBalanceBefore.sub(ptBalanceAfter),
          amountOut: USDCBalanceAfter.sub(USDCBalanceBefore),
        },
        router,
        tx
      );
    });

    it('PT-wstUSR to USDC exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const USDCBalanceBefore = await USDC.balanceOf(user.address);
      console.log(`USDCBalanceBefore: ${formatUnits(USDCBalanceBefore, await USDC.decimals())} ${await USDC.symbol()}`);

      const swapCalldata = constructSwap([Dex.PendleCurve], [SWAP_ONE]);
      const USDCOut = parseUnits('0.9', 8);
      await ptToken.connect(user).approve(router.address, ptBalanceBefore);
      const maxPtIn = parseUnits('1.3', 8);
      const tx = await router
        .connect(user)
        .swapExactOutput(swapCalldata, ptToken.address, USDC.address, maxPtIn, USDCOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
      const USDCBalanceAfter = await USDC.balanceOf(user.address);
      console.log(`sUsdeBalanceAfter: ${formatUnits(USDCBalanceAfter, await USDC.decimals())} ${await USDC.symbol()}`);
      expect(USDCBalanceAfter.sub(USDCBalanceBefore)).to.be.eq(USDCOut);

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: ptToken.address,
          tokenOut: USDC.address,
          amountIn: ptBalanceBefore.sub(ptBalanceAfter),
          amountOut: USDCBalanceAfter.sub(USDCBalanceBefore),
        },
        router,
        tx
      );
    });
  });
});
