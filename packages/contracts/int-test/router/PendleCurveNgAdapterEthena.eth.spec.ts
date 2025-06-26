import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC20,
  MarginlyRouter,
  MarginlyRouter__factory,
  PendleCurveNgAdapter,
  PendleCurveNgAdapter__factory,
} from '../../typechain-types';
import { assertSwapEvent, constructSwap, Dex, resetFork, showBalance, showGasUsage, SWAP_ONE } from './shared/utils';
import { parseUnits } from 'ethers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { EthereumMainnetERC20BalanceOfSlot, setTokenBalance } from './shared/tokens';

async function initializeRouter(): Promise<{
  ptToken: ERC20;
  usdcToken: ERC20;
  usdeToken: ERC20;
  router: MarginlyRouter;
  pendleCurveAdapter: PendleCurveNgAdapter;
  owner: SignerWithAddress;
  user: SignerWithAddress;
}> {
  const [owner, user] = await ethers.getSigners();
  const ptToken = await ethers.getContractAt('ERC20', '0x8a47b431a7d947c6a3ed6e42d501803615a97eaa');
  const usdcToken = await ethers.getContractAt('ERC20', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  const usdeToken = await ethers.getContractAt('ERC20', '0x4c9edd5852cd905f086c759e8383e09bff1e68b3');
  const pendleMarket = '0xb451a36c8b6b2eac77ad0737ba732818143a0e25';

  // Route to make swap pt-USDe -> usde -> usdc
  const routeInput: PendleCurveNgAdapter.RouteInputStruct = {
    pendleMarket: pendleMarket,
    slippage: 20, // 20/100  = 20%
    curveSlippage: 10, // 10/1000000 = 0.001%
    curvePool: '0x02950460e2b9529d0e00284a5fa2d7bdf3fa4d72',
    ibToken: '0x4c9edd5852cd905f086c759e8383e09bff1e68b3',
    quoteToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  };
  const pendleCurveAdapter = await new PendleCurveNgAdapter__factory().connect(owner).deploy([routeInput]);

  const routerInput = {
    dexIndex: Dex.PendleCurveRouter,
    adapter: pendleCurveAdapter,
  };
  const router = await new MarginlyRouter__factory().connect(owner).deploy([routerInput]);

  await setTokenBalance(usdcToken.target, EthereumMainnetERC20BalanceOfSlot.USDC, user.address, parseUnits('1000', 6));
  await setTokenBalance(
    ptToken.target,
    EthereumMainnetERC20BalanceOfSlot.PTSUSDE,
    user.address,
    parseUnits('1000', 18)
  );

  return {
    ptToken,
    usdcToken,
    usdeToken,
    router,
    pendleCurveAdapter,
    owner,
    user,
  };
}

// Tests for running in ethereum mainnet fork
describe('PendleCurveAdapter PT-usde - usdc', () => {
  before(async () => {
    await resetFork(21493100);
  });

  describe('Pendle swap pre maturity', () => {
    let ptToken: ERC20;
    let usdc: ERC20;
    let usde: ERC20;
    let router: MarginlyRouter;
    let pendleCurveAdapter: PendleCurveNgAdapter;
    let user: SignerWithAddress;
    let owner: SignerWithAddress;

    beforeEach(async () => {
      ({
        ptToken,
        usdcToken: usdc,
        usdeToken: usde,
        router,
        pendleCurveAdapter,
        owner,
        user,
      } = await initializeRouter());
    });

    it('USDC to pt-USDe exact input', async () => {
      const ptBalanceBefore = await showBalance(ptToken, user.address, 'pt-usde balance Before:');
      const usdcBalanceBefore = await showBalance(usdc, user.address, 'USDC balance before:');

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const usdcSwapAmount = parseUnits('100', 6);
      await usdc.connect(user).approve(router, usdcSwapAmount);

      const minPtAmountOut = parseUnits('90', 18); //parseUnits('900', 18);

      const tx = await router.connect(user).swapExactInput(swapCalldata, usdc, ptToken, usdcSwapAmount, minPtAmountOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await showBalance(ptToken, user.address, 'pt-usde balance After:');
      expect(ptBalanceAfter).to.be.greaterThan(ptBalanceBefore);

      const usdcBalanceAfter = await showBalance(usdc, user.address, 'usdc balance After:');
      expect(usdcBalanceBefore - usdcBalanceAfter).to.be.lessThanOrEqual(usdcSwapAmount);
    });

    it('USDC to pt-USDe exact output', async () => {
      const ptBalanceBefore = await showBalance(ptToken, user.address, 'pt-usde balance Before:');
      const usdcBalanceBefore = await showBalance(usdc, user.address, 'USDC balance before:');

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);

      const exactPtOut = parseUnits('500', 18);
      const usdcMaxIn = parseUnits('1000', 6);
      await usdc.connect(user).approve(router, usdcMaxIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, usdc, ptToken, usdcMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await showBalance(ptToken, user.address, 'ptBalanceAfter:');
      expect(ptBalanceAfter - ptBalanceBefore).to.be.eq(exactPtOut);

      const usdcBalanceAfter = await showBalance(usdc, user.address, 'usdcBalanceAfter: ');
      expect(usdcBalanceBefore).to.be.greaterThan(usdcBalanceAfter);

      await showBalance(usde, pendleCurveAdapter.target, 'usde stays on adapter: ');

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

    it('USDC to pt-USDe exact output, small amount', async () => {
      const ptBalanceBefore = await showBalance(ptToken, user.address, 'pt-usde balance Before:');
      const usdcBalanceBefore = await showBalance(usdc, user.address, 'USDC balance before:');

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);

      const exactPtOut = parseUnits('1', 18);
      const usdcMaxIn = parseUnits('2', 6);
      await usdc.connect(user).approve(router, usdcMaxIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, usdc, ptToken, usdcMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await showBalance(ptToken, user.address, 'pt-usde balance After:');
      expect(ptBalanceAfter - ptBalanceBefore).to.be.eq(exactPtOut);

      const usdcBalanceAfter = await showBalance(usdc, user.address, 'usdc balance After:');
      expect(usdcBalanceBefore).to.be.greaterThan(usdcBalanceAfter);

      await showBalance(usde, pendleCurveAdapter.target, 'usde stays on adapter: ');

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

    it('pt-USDe to USDC exact input', async () => {
      const ptBalanceBefore = await showBalance(ptToken, user.address, 'pt-usde balance Before:');
      const usdcBalanceBefore = await showBalance(usdc, user.address, 'USDC balance before:');

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const ptIn = ptBalanceBefore;
      await ptToken.connect(user).approve(router, ptIn);
      const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken, usdc, ptIn, 0);
      await showGasUsage(tx);

      const ptBalanceAfter = await showBalance(ptToken, user.address, 'ptBalanceAfter:');
      expect(ptBalanceBefore - ptBalanceAfter).to.be.eq(ptIn);

      const usdcBalanceAfter = await showBalance(usdc, user.address, 'usdc balance After:');
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

    it('pt-USDe to USDC exact output', async () => {
      const ptBalanceBefore = await showBalance(ptToken, user.address, 'pt-usde balance Before:');
      const usdcBalanceBefore = await showBalance(usdc, user.address, 'USDC balance before:');

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const usdcOut = parseUnits('500', 6);
      const maxPtIn = parseUnits('600', 18);
      await ptToken.connect(user).approve(router, maxPtIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, ptToken, usdc, maxPtIn, usdcOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await showBalance(ptToken, user.address, 'ptBalanceAfter:');
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);

      const usdcBalanceAfter = await showBalance(usdc, user.address, 'usdc balance After:');
      expect(usdcBalanceAfter - usdcBalanceBefore).to.be.eq(usdcOut);

      await showBalance(usdc, pendleCurveAdapter.target, 'USDC stays on adapter: ');

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
    let usde: ERC20;
    let router: MarginlyRouter;
    let pendleCurveAdapter: PendleCurveNgAdapter;
    let user: SignerWithAddress;
    let owner: SignerWithAddress;

    beforeEach(async () => {
      ({
        ptToken,
        usdcToken: usdc,
        usdeToken: usde,
        router,
        pendleCurveAdapter,
        owner,
        user,
      } = await initializeRouter());

      // move time and make after maturity
      await ethers.provider.send('evm_increaseTime', [180 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);
    });

    it('USDC to pt-USDe exact input, forbidden', async () => {
      const ptBalanceBefore = await showBalance(ptToken, user.address, 'pt-usde balance Before:');
      const usdcBalanceBefore = await showBalance(usdc, user.address, 'USDC balance before:');

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      await usdc.connect(user).approve(router, usdcBalanceBefore);
      const tx = router
        .connect(user)
        .swapExactInput(swapCalldata, usdc, ptToken, usdcBalanceBefore, (usdcBalanceBefore * 9n) / 10n);

      await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

      console.log('This swap is forbidden after maturity');

      const ptBalanceAfter = await showBalance(ptToken, user.address, 'ptBalanceAfter:');
      expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);

      const usdcBalanceAfter = await showBalance(usdc, user.address, 'usdc balance After:');
      expect(usdcBalanceAfter).to.be.eq(usdcBalanceBefore);
    });

    it('USDC to pt-USDe exact output, forbidden', async () => {
      const ptBalanceBefore = await showBalance(ptToken, user.address, 'pt-usde balance Before:');
      const usdcBalanceBefore = await showBalance(usdc, user.address, 'USDC balance before:');

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const ptOut = usdcBalanceBefore / 2n;
      await usdc.connect(user).approve(router, usdcBalanceBefore);
      const tx = router.connect(user).swapExactOutput(swapCalldata, usdc, ptToken, usdcBalanceBefore, ptOut);
      await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

      console.log('This swap is forbidden after maturity');

      const ptBalanceAfter = await showBalance(ptToken, user.address, 'ptBalanceAfter:');
      expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);

      const usdcBalanceAfter = await showBalance(usdc, user.address, 'usdc balance After:');
      expect(usdcBalanceAfter).to.be.eq(usdcBalanceBefore);
    });

    it('pt-USDe to USDC exact input', async () => {
      const ptBalanceBefore = await showBalance(ptToken, user.address, 'pt-usde balance Before:');
      const usdcBalanceBefore = await showBalance(usdc, user.address, 'USDC balance before:');

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const ptIn = ptBalanceBefore;
      await ptToken.connect(user).approve(router, ptIn);
      const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken, usdc, ptIn, 0);
      await showGasUsage(tx);

      const ptBalanceAfter = await showBalance(ptToken, user.address, 'ptBalanceAfter:');
      expect(ptBalanceBefore - ptBalanceAfter).to.be.eq(ptIn);

      const usdcBalanceAfter = await showBalance(usdc, user.address, 'usdc balance After:');
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

    it('pt-USDe to USDC exact output', async () => {
      const ptBalanceBefore = await showBalance(ptToken, user.address, 'pt-usde balance Before:');
      const usdcBalanceBefore = await showBalance(usdc, user.address, 'USDC balance before:');

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const usdcOut = parseUnits('900', 6);
      await ptToken.connect(user).approve(router, ptBalanceBefore);
      const maxPtIn = parseUnits('1000', 18);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, ptToken, usdc, maxPtIn, usdcOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await showBalance(ptToken, user.address, 'ptBalanceAfter:');
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);

      const usdcBalanceAfter = await showBalance(usdc, user.address, 'usdc balance After:');
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
