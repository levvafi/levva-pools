import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC20,
  MarginlyRouter,
  MarginlyRouter__factory,
  PendleCurveRouterNgAdapter,
  PendleCurveRouterNgAdapter__factory,
} from '../../typechain-types';
import { constructSwap, Dex, resetFork, showGasUsage, SWAP_ONE, assertSwapEvent } from '../shared/utils';
import { formatUnits, parseUnits } from 'ethers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { EthereumMainnetERC20BalanceOfSlot, setTokenBalance } from '../shared/tokens';

async function initializeRouter(): Promise<{
  ptToken: ERC20;
  wethToken: ERC20;
  usd0PlusPlusToken: ERC20;
  router: MarginlyRouter;
  pendleCurveAdapter: PendleCurveRouterNgAdapter;
  owner: SignerWithAddress;
  user: SignerWithAddress;
}> {
  const [owner, user] = await ethers.getSigners();
  const ptToken = await ethers.getContractAt('ERC20', '0x84d17ef6bec165484c320b852eeb294203e191be');
  const wethToken = await ethers.getContractAt('ERC20', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
  const tETHToken = await ethers.getContractAt('ERC20', '0xd11c452fc99cf405034ee446803b6f6c1f6d5ed8');
  const pendleMarket = '0xbdb8f9729d3194f75fd1a3d9bc4ffe0dde3a404c';
  const curveRouterAddress = '0x16c6521dff6bab339122a0fe25a9116693265353';

  // Route to make swap pt-teth -> usd0++ -> usd0 -> weth
  const routeInput: PendleCurveRouterNgAdapter.RouteInputStruct = {
    pendleMarket: pendleMarket,
    slippage: 35, // 20/100  = 20%
    curveSlippage: 202_300, // 202_300/1000000 = 0.2023
    curveRoute: [
      '0xd11c452fc99cf405034ee446803b6f6c1f6d5ed8',
      '0x394a1e1b934cb4F4a0dC17BDD592ec078741542F',
      '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee',
      '0xDB74dfDD3BB46bE8Ce6C33dC9D82777BCFc3dEd5',
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
    ], // curve route usd0++ -> usd0 -> weth
    curveSwapParams: [
      [0, 1, 1, 1, 2],
      [1, 0, 1, 1, 2],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ],
    curvePools: [
      '0x394a1e1b934cb4F4a0dC17BDD592ec078741542F',
      '0xDB74dfDD3BB46bE8Ce6C33dC9D82777BCFc3dEd5',
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

  await setTokenBalance(wethToken.target, EthereumMainnetERC20BalanceOfSlot.WETH, user.address, parseUnits('100', 18));
  await setTokenBalance(ptToken, EthereumMainnetERC20BalanceOfSlot.PTSUSDE, user.address, parseUnits('100', 18));

  return {
    ptToken,
    wethToken: wethToken,
    usd0PlusPlusToken: tETHToken,
    router,
    pendleCurveAdapter,
    owner,
    user,
  };
}

// Tests for running in ethereum mainnet fork
describe('Pendle PT-tETH - WETH', () => {
  before(async () => {
    await resetFork(22366240); // 21240095  ---- 22366240
  });

  describe('Pendle swap pre maturity', () => {
    let ptToken: ERC20;
    let weth: ERC20;
    let usd0PlusPlusToken: ERC20;
    let router: MarginlyRouter;
    let pendleCurveAdapter: PendleCurveRouterNgAdapter;
    let user: SignerWithAddress;
    let owner: SignerWithAddress;

    beforeEach(async () => {
      ({
        ptToken,
        wethToken: weth,
        usd0PlusPlusToken,
        router,
        pendleCurveAdapter,
        owner,
        user,
      } = await initializeRouter());
    });

    it('WETH to pt-tETH exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `pt-tETH balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const tokenBalanceBefore = await weth.balanceOf(user);
      console.log(
        `WETH balance before: ${formatUnits(tokenBalanceBefore, await weth.decimals())} ${await weth.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const wethSwapAmount = parseUnits('0.5', 18);
      await weth.connect(user).approve(router, wethSwapAmount);

      const minPtAmountOut = parseUnits('0.45', 18); //parseUnits('900', 18);

      const tx = await router.connect(user).swapExactInput(swapCalldata, weth, ptToken, wethSwapAmount, minPtAmountOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.greaterThan(ptBalanceBefore);
      const tokenBalanceAfter = await weth.balanceOf(user);
      console.log(`wethBalanceAfter: ${formatUnits(tokenBalanceAfter, await weth.decimals())} ${await weth.symbol()}`);
      expect(tokenBalanceBefore - tokenBalanceAfter).to.be.lessThanOrEqual(wethSwapAmount);
    });

    it('WETH to pt-tETH exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `pt-teth balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const wethBalanceBefore = await weth.balanceOf(user);
      console.log(
        `WETH balance before: ${formatUnits(wethBalanceBefore, await weth.decimals())} ${await weth.symbol()}`
      );
      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);

      const exactPtOut = parseUnits('10.5', await ptToken.decimals());
      const wethMaxIn = parseUnits('10.7', await weth.decimals());
      await weth.connect(user).approve(router, wethMaxIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, weth, ptToken, wethMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter - ptBalanceBefore).to.be.eq(exactPtOut);
      const wethBalanceAfter = await weth.balanceOf(user);
      console.log(`wethBalanceAfter: ${formatUnits(wethBalanceAfter, await weth.decimals())} ${await weth.symbol()}`);
      expect(wethBalanceBefore).to.be.greaterThan(wethBalanceAfter);

      const usd0PlusPlusOnAdapter = await usd0PlusPlusToken.balanceOf(pendleCurveAdapter);
      console.log(
        `tETH stays on adapter: ${formatUnits(
          usd0PlusPlusOnAdapter,
          await usd0PlusPlusToken.decimals()
        )} ${await usd0PlusPlusToken.symbol()}`
      );

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: weth.target,
          tokenOut: ptToken.target,
          amountIn: wethBalanceBefore - wethBalanceAfter,
          amountOut: ptBalanceAfter - ptBalanceBefore,
        },
        router,
        tx
      );
    });

    it('WETH to pt-TETH exact output, small amount', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `pt-teth balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const wethBalanceBefore = await weth.balanceOf(user);
      console.log(
        `WETH balance before: ${formatUnits(wethBalanceBefore, await weth.decimals())} ${await weth.symbol()}`
      );
      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);

      const exactPtOut = parseUnits('0.01', 18);
      const wethMaxIn = parseUnits('0.01', 18);
      await weth.connect(user).approve(router, wethMaxIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, weth, ptToken, wethMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter - ptBalanceBefore).to.be.eq(exactPtOut);
      const wethBalanceAfter = await weth.balanceOf(user);
      console.log(`wethBalanceAfter: ${formatUnits(wethBalanceAfter, await weth.decimals())} ${await weth.symbol()}`);
      expect(wethBalanceBefore).to.be.greaterThan(wethBalanceAfter);

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
          tokenIn: weth.target,
          tokenOut: ptToken.target,
          amountIn: wethBalanceBefore - wethBalanceAfter,
          amountOut: ptBalanceAfter - ptBalanceBefore,
        },
        router,
        tx
      );
    });

    it('pt-TETH to WETH exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const wethBalanceBefore = await weth.balanceOf(user);
      console.log(`wethBalanceBefore: ${formatUnits(wethBalanceBefore, await weth.decimals())} ${await weth.symbol()}`);
      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const ptIn = ptBalanceBefore;
      await ptToken.connect(user).approve(router, ptIn);
      const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken, weth, ptIn, 0);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore - ptBalanceAfter).to.be.eq(ptIn);
      const wethBalanceAfter = await weth.balanceOf(user);
      console.log(`wethBalanceAfter: ${formatUnits(wethBalanceAfter, await weth.decimals())} ${await weth.symbol()}`);
      expect(wethBalanceAfter).to.be.greaterThan(wethBalanceBefore);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: ptToken.target,
          tokenOut: weth.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: wethBalanceAfter - wethBalanceBefore,
        },
        router,
        tx
      );
    });

    it.only('pt-tETH to WETH exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const wethBalanceBefore = await weth.balanceOf(user);
      console.log(`wethBalanceBefore: ${formatUnits(wethBalanceBefore, await weth.decimals())} ${await weth.symbol()}`);
      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
      const wethOut = parseUnits('2.1', 18);
      const maxPtIn = parseUnits('2.6', 18);
      await ptToken.connect(user).approve(router, maxPtIn);
      const tx = await router.connect(user).swapExactOutput(swapCalldata, ptToken, weth, maxPtIn, wethOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
      const wethBalanceAfter = await weth.balanceOf(user);
      console.log(`wethBalanceAfter: ${formatUnits(wethBalanceAfter, await weth.decimals())} ${await weth.symbol()}`);
      expect(wethBalanceAfter - wethBalanceBefore).to.be.eq(wethOut);

      const wethBalanceOnAdapter = await weth.balanceOf(pendleCurveAdapter);
      console.log(
        `wethBalanceOnAdapter: ${formatUnits(wethBalanceOnAdapter, await weth.decimals())} ${await weth.symbol()}`
      );

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: ptToken.target,
          tokenOut: weth.target,
          amountIn: ptBalanceBefore - ptBalanceAfter,
          amountOut: wethBalanceAfter - wethBalanceBefore,
        },
        router,
        tx
      );
    });
  });

  // describe('Pendle swap post maturity', () => {
  //   let ptToken: ERC20;
  //   let weth: ERC20;
  //   let usd0PlusPlusToken: ERC20;
  //   let router: MarginlyRouter;
  //   let pendleCurveAdapter: PendleCurveRouterNgAdapter;
  //   let user: SignerWithAddress;
  //   let owner: SignerWithAddress;

  //   beforeEach(async () => {
  //     ({
  //       ptToken,
  //       wethToken: weth,
  //       usd0PlusPlusToken,
  //       router,
  //       pendleCurveAdapter,
  //       owner,
  //       user,
  //     } = await initializeRouter());

  //     // move time and make after maturity
  //     await ethers.provider.send('evm_increaseTime', [180 * 24 * 60 * 60]);
  //     await ethers.provider.send('evm_mine', []);
  //   });

  //   it('WETH to pt-teth exact input, forbidden', async () => {
  //     const ptBalanceBefore = await ptToken.balanceOf(user);
  //     console.log(
  //       `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
  //     );
  //     const sUsdeBalanceBefore = await weth.balanceOf(user);
  //     console.log(
  //       `wethBalanceBefore: ${formatUnits(sUsdeBalanceBefore, await weth.decimals())} ${await weth.symbol()}`
  //     );

  //     const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
  //     await weth.connect(user).approve(router, sUsdeBalanceBefore);
  //     const tx = router
  //       .connect(user)
  //       .swapExactInput(swapCalldata, weth, ptToken, sUsdeBalanceBefore, (sUsdeBalanceBefore * 9n) / 10n);

  //     await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

  //     console.log('This swap is forbidden after maturity');
  //     const ptBalanceAfter = await ptToken.balanceOf(user);
  //     console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
  //     expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
  //     const sUsdeBalanceAfter = await weth.balanceOf(user);
  //     console.log(`wethBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await weth.decimals())} ${await weth.symbol()}`);
  //     expect(sUsdeBalanceAfter).to.be.eq(sUsdeBalanceBefore);
  //   });

  //   it('WETH to pt-teth exact output, forbidden', async () => {
  //     const ptBalanceBefore = await ptToken.balanceOf(user);
  //     console.log(
  //       `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
  //     );
  //     const wethBalanceBefore = await weth.balanceOf(user);
  //     console.log(
  //       `sUsdeBalanceBefore: ${formatUnits(wethBalanceBefore, await weth.decimals())} ${await weth.symbol()}`
  //     );

  //     const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
  //     const ptOut = wethBalanceBefore / 2n;
  //     await weth.connect(user).approve(router, wethBalanceBefore);
  //     const tx = router.connect(user).swapExactOutput(swapCalldata, weth, ptToken, wethBalanceBefore, ptOut);
  //     await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

  //     console.log('This swap is forbidden after maturity');
  //     const ptBalanceAfter = await ptToken.balanceOf(user);
  //     console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
  //     expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
  //     const wethBalanceAfter = await weth.balanceOf(user);
  //     console.log(`wethBalanceAfter: ${formatUnits(wethBalanceAfter, await weth.decimals())} ${await weth.symbol()}`);
  //     expect(wethBalanceAfter).to.be.eq(wethBalanceBefore);
  //   });

  //   it('pt-teth to WETH exact input', async () => {
  //     const ptBalanceBefore = await ptToken.balanceOf(user);
  //     console.log(
  //       `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
  //     );
  //     const wethBalanceBefore = await weth.balanceOf(user);
  //     console.log(`wethBalanceBefore: ${formatUnits(wethBalanceBefore, await weth.decimals())} ${await weth.symbol()}`);

  //     const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
  //     const ptIn = ptBalanceBefore;
  //     await ptToken.connect(user).approve(router, ptIn);
  //     const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken, weth, ptIn, 0);
  //     await showGasUsage(tx);

  //     const ptBalanceAfter = await ptToken.balanceOf(user);
  //     console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
  //     expect(ptBalanceBefore - ptBalanceAfter).to.be.eq(ptIn);
  //     const wethBalanceAfter = await weth.balanceOf(user);
  //     console.log(`wethBalanceAfter: ${formatUnits(wethBalanceAfter, await weth.decimals())} ${await weth.symbol()}`);
  //     expect(wethBalanceAfter).to.be.greaterThan(wethBalanceBefore);

  //     await assertSwapEvent(
  //       {
  //         isExactInput: true,
  //         tokenIn: ptToken.target,
  //         tokenOut: weth.target,
  //         amountIn: ptBalanceBefore - ptBalanceAfter,
  //         amountOut: wethBalanceAfter - wethBalanceBefore,
  //       },
  //       router,
  //       tx
  //     );
  //   });

  //   it('pt-teth to WETH exact output', async () => {
  //     const ptBalanceBefore = await ptToken.balanceOf(user);
  //     console.log(
  //       `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
  //     );
  //     const wethBalanceBefore = await weth.balanceOf(user);
  //     console.log(`wethBalanceBefore: ${formatUnits(wethBalanceBefore, await weth.decimals())} ${await weth.symbol()}`);

  //     const swapCalldata = constructSwap([Dex.PendleCurveRouter], [BigInt(SWAP_ONE)]);
  //     const wethOut = parseUnits('900', 6);
  //     await ptToken.connect(user).approve(router, ptBalanceBefore);
  //     const maxPtIn = parseUnits('1000', 18);
  //     const tx = await router.connect(user).swapExactOutput(swapCalldata, ptToken, weth, maxPtIn, wethOut);
  //     await showGasUsage(tx);

  //     const ptBalanceAfter = await ptToken.balanceOf(user);
  //     console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
  //     expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
  //     const wethBalanceAfter = await weth.balanceOf(user);
  //     console.log(`sUsdeBalanceAfter: ${formatUnits(wethBalanceAfter, await weth.decimals())} ${await weth.symbol()}`);
  //     expect(wethBalanceAfter - wethBalanceBefore).to.be.eq(wethOut);

  //     await assertSwapEvent(
  //       {
  //         isExactInput: false,
  //         tokenIn: ptToken.target,
  //         tokenOut: weth.target,
  //         amountIn: ptBalanceBefore - ptBalanceAfter,
  //         amountOut: wethBalanceAfter - wethBalanceBefore,
  //       },
  //       router,
  //       tx
  //     );
  //   });
  // });
});
