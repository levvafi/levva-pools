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
import { formatUnits, parseUnits } from 'ethers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { EthereumMainnetERC20BalanceOfSlot, setTokenBalance } from '../shared/tokens';

async function initializeRouter(): Promise<{
  ptToken: ERC20;
  wbtcToken: ERC20;
  ebtcToken: ERC20;
  router: MarginlyRouter;
  pendleCurveAdapter: PendleCurveNgAdapter;
  owner: SignerWithAddress;
  user: SignerWithAddress;
}> {
  const [owner, user] = await ethers.getSigners();
  const ptToken = await ethers.getContractAt('ERC20', '0x44a7876ca99460ef3218bf08b5f52e2dbe199566');
  const wbtcToken = await ethers.getContractAt('ERC20', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
  const ebtcToken = await ethers.getContractAt('ERC20', '0x657e8c867d8b37dcc18fa4caead9c45eb088c642');
  const pendleMarket = '0x2c71ead7ac9ae53d05f8664e77031d4f9eba064b';

  // Route to make swap PT-eBTC -> usde -> WBTC
  const routeInput: PendleCurveNgAdapter.RouteInputStruct = {
    pendleMarket: pendleMarket,
    slippage: 20, // 20/100  = 20%
    curveSlippage: 100, // 10/1000000 = 0.001%
    //curvePool: '0xabaf76590478f2fe0b396996f55f0b61101e9502', //TriBTCPool
    curvePool: '0x7704d01908afd31bf647d969c295bb45230cd2d6', //ebtc/WBTC pool
    ibToken: ebtcToken,
    quoteToken: wbtcToken,
  };
  const pendleCurveAdapter = await new PendleCurveNgAdapter__factory().connect(owner).deploy([routeInput]);

  const routerInput = {
    dexIndex: Dex.PendleCurve,
    adapter: pendleCurveAdapter,
  };
  const router = await new MarginlyRouter__factory().connect(owner).deploy([routerInput]);

  await setTokenBalance(wbtcToken.target, EthereumMainnetERC20BalanceOfSlot.WBTC, user.address, parseUnits('10', 8));
  await setTokenBalance(ptToken.target, EthereumMainnetERC20BalanceOfSlot.PTSUSDE, user.address, parseUnits('10', 8));

  return {
    ptToken,
    wbtcToken: wbtcToken,
    ebtcToken: ebtcToken,
    router,
    pendleCurveAdapter,
    owner,
    user,
  };
}

// Tests for running in ethereum mainnet fork
describe('PendleCurveAdapter PT-eBTC - WBTC', () => {
  before(async () => {
    await resetFork(21493100);
  });

  describe('Pendle swap pre maturity', () => {
    let ptToken: ERC20;
    let WBTC: ERC20;
    let ebtc: ERC20;
    let router: MarginlyRouter;
    let pendleCurveAdapter: PendleCurveNgAdapter;
    let user: SignerWithAddress;
    let owner: SignerWithAddress;

    beforeEach(async () => {
      ({
        ptToken,
        wbtcToken: WBTC,
        ebtcToken: ebtc,
        router,
        pendleCurveAdapter,
        owner,
        user,
      } = await initializeRouter());
    });

    it('WBTC to PT-eBTC exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `PT-eBTC balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const WBTCBalanceBefore = await WBTC.balanceOf(user);
      console.log(
        `WBTC balance before: ${formatUnits(WBTCBalanceBefore, await WBTC.decimals())} ${await WBTC.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(BigInt(SWAP_ONE))]);
      const WBTCSwapAmount = parseUnits('2', 8);
      await WBTC.connect(user).approve(router, WBTCSwapAmount);

      const minPtAmountOut = parseUnits('1.8', 8);

      const tx = await router.connect(user).swapExactInput(swapCalldata, WBTC, ptToken, WBTCSwapAmount, minPtAmountOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.greaterThan(ptBalanceBefore);
      const WBTCBalanceAfter = await WBTC.balanceOf(user);
      console.log(`WBTCBalanceAfter: ${formatUnits(WBTCBalanceAfter, await WBTC.decimals())} ${await WBTC.symbol()}`);
      expect(WBTCBalanceBefore - WBTCBalanceAfter).to.be.lessThanOrEqual(WBTCSwapAmount);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: WBTC.target,
          tokenOut: ptToken.target,
          amountIn: WBTCSwapAmount,
          amountOut: ptBalanceAfter - ptBalanceBefore,
        },
        router,
        tx
      );
    });

    it('WBTC to PT-eBTC exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `PT-eBTC balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const WBTCBalanceBefore = await WBTC.balanceOf(user);
      console.log(
        `WBTC balance before: ${formatUnits(WBTCBalanceBefore, await WBTC.decimals())} ${await WBTC.symbol()}`
      );
      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);

      const exactPtOut = parseUnits('1', 8);
      const WBTCMaxIn = parseUnits('2.5', 8);
      await WBTC.connect(user).approve(router, WBTCMaxIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, WBTC, ptToken, WBTCMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter - ptBalanceBefore).to.be.eq(exactPtOut);
      const WBTCBalanceAfter = await WBTC.balanceOf(user);
      console.log(`WBTCBalanceAfter: ${formatUnits(WBTCBalanceAfter, await WBTC.decimals())} ${await WBTC.symbol()}`);
      expect(WBTCBalanceBefore).to.be.greaterThan(WBTCBalanceAfter);

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: WBTC.target,
          tokenOut: ptToken.target,
          amountIn: WBTCBalanceBefore - WBTCBalanceAfter,
          amountOut: ptBalanceAfter - ptBalanceBefore,
        },
        router,
        tx
      );

      const ebtcOnAdapter = await ebtc.balanceOf(pendleCurveAdapter);
      console.log(`ebtc stays on adapter: ${formatUnits(ebtcOnAdapter, await ebtc.decimals())} ${await ebtc.symbol()}`);
    });

    it('WBTC to PT-eBTC exact output, small amount', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `PT-eBTC balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const WBTCBalanceBefore = await WBTC.balanceOf(user);
      console.log(
        `WBTC balance before: ${formatUnits(WBTCBalanceBefore, await WBTC.decimals())} ${await WBTC.symbol()}`
      );
      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);

      const exactPtOut = parseUnits('0.0006', 8);
      const WBTCMaxIn = parseUnits('0.0012', 8);
      await WBTC.connect(user).approve(router, WBTCMaxIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, WBTC, ptToken, WBTCMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter - ptBalanceBefore).to.be.eq(exactPtOut);
      const WBTCBalanceAfter = await WBTC.balanceOf(user);
      console.log(`WBTCBalanceAfter: ${formatUnits(WBTCBalanceAfter, await WBTC.decimals())} ${await WBTC.symbol()}`);
      expect(WBTCBalanceBefore).to.be.greaterThan(WBTCBalanceAfter);

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: WBTC.target,
          tokenOut: ptToken.target,
          amountIn: WBTCBalanceBefore - WBTCBalanceAfter,
          amountOut: ptBalanceAfter - ptBalanceBefore,
        },
        router,
        tx
      );

      const ebtcOnAdapter = await ebtc.balanceOf(pendleCurveAdapter);
      console.log(`ebtc stays on adapter: ${formatUnits(ebtcOnAdapter, await ebtc.decimals())} ${await ebtc.symbol()}`);
    });

    it('PT-eBTC to WBTC exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const WBTCBalanceBefore = await WBTC.balanceOf(user);
      console.log(`WBTCBalanceBefore: ${formatUnits(WBTCBalanceBefore, await WBTC.decimals())} ${await WBTC.symbol()}`);
      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      const ptIn = parseUnits('0.1', 8);
      await ptToken.connect(user).approve(router, ptIn);
      const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken, WBTC, ptIn, 0);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore - ptBalanceAfter).to.be.eq(ptIn);
      const WBTCBalanceAfter = await WBTC.balanceOf(user);
      console.log(`WBTCBalanceAfter: ${formatUnits(WBTCBalanceAfter, await WBTC.decimals())} ${await WBTC.symbol()}`);
      expect(WBTCBalanceAfter).to.be.greaterThan(WBTCBalanceBefore);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: ptToken.target,
          tokenOut: WBTC.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: WBTCBalanceAfter - WBTCBalanceBefore,
        },
        router,
        tx
      );
    });

    it('PT-eBTC to WBTC exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const WBTCBalanceBefore = await WBTC.balanceOf(user);
      console.log(`WBTCBalanceBefore: ${formatUnits(WBTCBalanceBefore, await WBTC.decimals())} ${await WBTC.symbol()}`);
      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      const WBTCOut = parseUnits('1', 8);
      const maxPtIn = parseUnits('1.2', 8);
      await ptToken.connect(user).approve(router, maxPtIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, ptToken, WBTC, maxPtIn, WBTCOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
      const WBTCBalanceAfter = await WBTC.balanceOf(user);
      console.log(`WBTCBalanceAfter: ${formatUnits(WBTCBalanceAfter, await WBTC.decimals())} ${await WBTC.symbol()}`);
      expect(WBTCBalanceAfter - WBTCBalanceBefore).to.be.eq(WBTCOut);

      const WBTCBalanceOnAdapter = await WBTC.balanceOf(pendleCurveAdapter);
      console.log(
        `WBTCBalanceOnAdapter: ${formatUnits(WBTCBalanceOnAdapter, await WBTC.decimals())} ${await WBTC.symbol()}`
      );

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: ptToken.target,
          tokenOut: WBTC.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: WBTCBalanceAfter - WBTCBalanceBefore,
        },
        router,
        tx
      );
    });
  });

  describe('Pendle swap post maturity', () => {
    let ptToken: ERC20;
    let WBTC: ERC20;
    let usde: ERC20;
    let router: MarginlyRouter;
    let pendleCurveAdapter: PendleCurveNgAdapter;
    let user: SignerWithAddress;
    let owner: SignerWithAddress;

    beforeEach(async () => {
      ({
        ptToken,
        wbtcToken: WBTC,
        ebtcToken: usde,
        router,
        pendleCurveAdapter,
        owner,
        user,
      } = await initializeRouter());

      // move time and make after maturity
      await ethers.provider.send('evm_increaseTime', [180 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);
    });

    it('WBTC to PT-eBTC exact input, forbidden', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const sUsdeBalanceBefore = await WBTC.balanceOf(user);
      console.log(
        `WBTCBalanceBefore: ${formatUnits(sUsdeBalanceBefore, await WBTC.decimals())} ${await WBTC.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      await WBTC.connect(user).approve(router, sUsdeBalanceBefore);
      const tx = router
        .connect(user)
        .swapExactInput(swapCalldata, WBTC, ptToken, sUsdeBalanceBefore, (sUsdeBalanceBefore * 9n) / 10n);

      await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

      console.log('This swap is forbidden after maturity');
      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
      const sUsdeBalanceAfter = await WBTC.balanceOf(user);
      console.log(`WBTCBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await WBTC.decimals())} ${await WBTC.symbol()}`);
      expect(sUsdeBalanceAfter).to.be.eq(sUsdeBalanceBefore);
    });

    it('WBTC to PT-eBTC exact output, forbidden', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const WBTCBalanceBefore = await WBTC.balanceOf(user);
      console.log(
        `sUsdeBalanceBefore: ${formatUnits(WBTCBalanceBefore, await WBTC.decimals())} ${await WBTC.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      const ptOut = WBTCBalanceBefore / 2n;
      await WBTC.connect(user).approve(router, WBTCBalanceBefore);
      const tx = router.connect(user).swapExactOutput(swapCalldata, WBTC, ptToken, WBTCBalanceBefore, ptOut);
      await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

      console.log('This swap is forbidden after maturity');
      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
      const WBTCBalanceAfter = await WBTC.balanceOf(user);
      console.log(`WBTCBalanceAfter: ${formatUnits(WBTCBalanceAfter, await WBTC.decimals())} ${await WBTC.symbol()}`);
      expect(WBTCBalanceAfter).to.be.eq(WBTCBalanceBefore);
    });

    it('PT-eBTC to WBTC exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const WBTCBalanceBefore = await WBTC.balanceOf(user);
      console.log(`WBTCBalanceBefore: ${formatUnits(WBTCBalanceBefore, await WBTC.decimals())} ${await WBTC.symbol()}`);

      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      const ptIn = ptBalanceBefore;
      await ptToken.connect(user).approve(router, ptIn);
      const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken, WBTC, ptIn, 0);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore - ptBalanceAfter).to.be.eq(ptIn);
      const WBTCBalanceAfter = await WBTC.balanceOf(user);
      console.log(`WBTCBalanceAfter: ${formatUnits(WBTCBalanceAfter, await WBTC.decimals())} ${await WBTC.symbol()}`);
      expect(WBTCBalanceAfter).to.be.greaterThan(WBTCBalanceBefore);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: ptToken.target,
          tokenOut: WBTC.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: WBTCBalanceAfter - WBTCBalanceBefore,
        },
        router,
        tx
      );
    });

    it('PT-eBTC to WBTC exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const WBTCBalanceBefore = await WBTC.balanceOf(user);
      console.log(`WBTCBalanceBefore: ${formatUnits(WBTCBalanceBefore, await WBTC.decimals())} ${await WBTC.symbol()}`);

      const swapCalldata = constructSwap([Dex.PendleCurve], [BigInt(SWAP_ONE)]);
      const WBTCOut = parseUnits('0.9', 8);
      await ptToken.connect(user).approve(router, ptBalanceBefore);
      const maxPtIn = parseUnits('1.3', 8);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, ptToken, WBTC, maxPtIn, WBTCOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
      const WBTCBalanceAfter = await WBTC.balanceOf(user);
      console.log(`sUsdeBalanceAfter: ${formatUnits(WBTCBalanceAfter, await WBTC.decimals())} ${await WBTC.symbol()}`);
      expect(WBTCBalanceAfter - WBTCBalanceBefore).to.be.eq(WBTCOut);

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: ptToken.target,
          tokenOut: WBTC.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: WBTCBalanceAfter - WBTCBalanceBefore,
        },
        router,
        tx
      );
    });
  });
});
