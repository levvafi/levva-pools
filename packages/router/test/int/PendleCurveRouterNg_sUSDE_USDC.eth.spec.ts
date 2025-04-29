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
import { EthAddress } from '@marginly/common';
import { formatUnits, parseUnits } from 'ethers/lib/utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { EthereumMainnetERC20BalanceOfSlot, setTokenBalance } from '../shared/tokens';

async function initializeRouter(): Promise<{
  ptToken: ERC20;
  usdcToken: ERC20;
  sUsdeToken: ERC20;
  router: MarginlyRouter;
  pendleCurveAdapter: PendleCurveRouterNgAdapter;
  owner: SignerWithAddress;
  user: SignerWithAddress;
}> {
  const [owner, user] = await ethers.getSigners();
  const ptToken = await ethers.getContractAt('ERC20', '0x3b3fb9c57858ef816833dc91565efcd85d96f634');
  const usdcToken = await ethers.getContractAt('ERC20', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  const sUSDeToken = await ethers.getContractAt('ERC20', '0x9d39a5de30e57443bff2a8307a4256c8797a3497');
  const pendleMarket = '0x4339ffe2b7592dc783ed13cce310531ab366deac';
  const curveRouterAddress = '0x16c6521dff6bab339122a0fe25a9116693265353';

  // Route to make swap pt-susde -> usd0++ -> usd0 -> usdc
  const routeInput: PendleCurveRouterNgAdapter.RouteInputStruct = {
    pendleMarket: pendleMarket,
    slippage: 20, // 20/100  = 20%
    curveSlippageIbToQuote: 0, // 202_300/1000000 = 0.2023
    curveSlippageQuoteToIb: 200_000,
    curveRoute: [
      sUSDeToken.address,
      '0x57064F49Ad7123C92560882a45518374ad982e85',
      '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E', // crvUSD
      '0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E',
      usdcToken.address,
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
    ], // curve route sUSDe -> crvUSD, crvUSD -> USDC
    curveSwapParams: [
      [1, 0, 1, 1, 2],
      [1, 0, 1, 1, 2],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ],
    curvePools: [
      '0x57064F49Ad7123C92560882a45518374ad982e85', // sUSDe/crvUSD
      '0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E', // crvUSD/USDC
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
    adapter: pendleCurveAdapter.address,
  };
  const router = await new MarginlyRouter__factory().connect(owner).deploy([routerInput]);

  await setTokenBalance(
    usdcToken.address,
    EthereumMainnetERC20BalanceOfSlot.USDC,
    EthAddress.parse(user.address),
    parseUnits('10000', 6)
  );
  await setTokenBalance(
    ptToken.address,
    EthereumMainnetERC20BalanceOfSlot.PTSUSDE,
    EthAddress.parse(user.address),
    parseUnits('10000', 18)
  );

  return {
    ptToken,
    usdcToken: usdcToken,
    sUsdeToken: sUSDeToken,
    router,
    pendleCurveAdapter,
    owner,
    user,
  };
}

// Tests for running in ethereum mainnet fork
describe('Pendle PT-sUSDe - USDC', () => {
  before(async () => {
    await resetFork(22366240); // 21240095  ---- 22366240
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
        sUsdeToken: usd0PlusPlusToken,
        router,
        pendleCurveAdapter,
        owner,
        user,
      } = await initializeRouter());
    });

    it('USDC to pt-sUSDe exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `pt-sUSDe balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const tokenBalanceBefore = await usdc.balanceOf(user.address);
      console.log(
        `USDC balance before: ${formatUnits(tokenBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [SWAP_ONE]);
      const usdcSwapAmount = parseUnits('10', 6);
      await usdc.connect(user).approve(router.address, usdcSwapAmount);

      const minPtAmountOut = parseUnits('10', 18); //parseUnits('900', 18);

      const tx = await router
        .connect(user)
        .swapExactInput(swapCalldata, usdc.address, ptToken.address, usdcSwapAmount, minPtAmountOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      const ptOut = ptBalanceAfter.sub(ptBalanceBefore);
      console.log(`ptOut: ${formatUnits(ptOut, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.greaterThan(ptBalanceBefore);

      const tokenBalanceAfter = await usdc.balanceOf(user.address);
      const usdcIn = tokenBalanceBefore.sub(tokenBalanceAfter);
      console.log(`usdcIn: ${formatUnits(usdcIn, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(tokenBalanceBefore.sub(tokenBalanceAfter)).to.be.lessThanOrEqual(usdcSwapAmount);
    });

    it.only('USDC to pt-sUSDe exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `pt-susde balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const usdcBalanceBefore = await usdc.balanceOf(user.address);
      console.log(
        `USDC balance before: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );
      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [SWAP_ONE]);

      const exactPtOut = parseUnits('10', await ptToken.decimals());
      const usdcMaxIn = parseUnits('12', await usdc.decimals());
      await usdc.connect(user).approve(router.address, usdcMaxIn);
      const tx = await router
        .connect(user)
        .swapExactOutput(swapCalldata, usdc.address, ptToken.address, usdcMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      const ptOut = ptBalanceAfter.sub(ptBalanceBefore);
      console.log(`ptOut: ${formatUnits(ptOut, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter.sub(ptBalanceBefore)).to.be.eq(exactPtOut);

      const usdcBalanceAfter = await usdc.balanceOf(user.address);
      const usdcIn = usdcBalanceBefore.sub(usdcBalanceAfter);
      console.log(`usdcIn: ${formatUnits(usdcIn, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(usdcBalanceBefore).to.be.greaterThan(usdcBalanceAfter);

      const usd0PlusPlusOnAdapter = await usd0PlusPlusToken.balanceOf(pendleCurveAdapter.address);
      console.log(
        `sUSDe stays on adapter: ${formatUnits(
          usd0PlusPlusOnAdapter,
          await usd0PlusPlusToken.decimals()
        )} ${await usd0PlusPlusToken.symbol()}`
      );

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: usdc.address,
          tokenOut: ptToken.address,
          amountIn: usdcBalanceBefore.sub(usdcBalanceAfter),
          amountOut: ptBalanceAfter.sub(ptBalanceBefore),
        },
        router,
        tx
      );
    });

    it.only('USDC to pt-SUSDE exact output, small amount', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `pt-susde balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const usdcBalanceBefore = await usdc.balanceOf(user.address);
      console.log(
        `USDC balance before: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
      );
      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [SWAP_ONE]);

      const exactPtOut = parseUnits('0.01', await ptToken.decimals());
      const usdcMaxIn = parseUnits('0.05', await usdc.decimals());
      await usdc.connect(user).approve(router.address, usdcMaxIn);
      const tx = await router
        .connect(user)
        .swapExactOutput(swapCalldata, usdc.address, ptToken.address, usdcMaxIn, exactPtOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      const ptOut = ptBalanceAfter.sub(ptBalanceBefore);
      console.log(`ptOut: ${formatUnits(ptOut, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter.sub(ptBalanceBefore)).to.be.eq(exactPtOut);

      const usdcBalanceAfter = await usdc.balanceOf(user.address);
      const usdcIn = usdcBalanceBefore.sub(usdcBalanceAfter);
      console.log(`usdcIn: ${formatUnits(usdcIn, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(usdcBalanceBefore).to.be.greaterThan(usdcBalanceAfter);

      const usd0PlusPlusOnAdapter = await usd0PlusPlusToken.balanceOf(pendleCurveAdapter.address);
      console.log(
        `sUSDe stays on adapter: ${formatUnits(
          usd0PlusPlusOnAdapter,
          await usd0PlusPlusToken.decimals()
        )} ${await usd0PlusPlusToken.symbol()}`
      );

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: usdc.address,
          tokenOut: ptToken.address,
          amountIn: usdcBalanceBefore.sub(usdcBalanceAfter),
          amountOut: ptBalanceAfter.sub(ptBalanceBefore),
        },
        router,
        tx
      );
    });

    it('pt-SUSDE to USDC exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const usdcBalanceBefore = await usdc.balanceOf(user.address);
      console.log(`usdcBalanceBefore: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`);
      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [SWAP_ONE]);
      const ptIn = ptBalanceBefore;
      await ptToken.connect(user).approve(router.address, ptIn);
      const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken.address, usdc.address, ptIn, 0);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore.sub(ptBalanceAfter)).to.be.eq(ptIn);
      const usdcBalanceAfter = await usdc.balanceOf(user.address);
      console.log(`usdcBalanceAfter: ${formatUnits(usdcBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
      expect(usdcBalanceAfter).to.be.greaterThan(usdcBalanceBefore);

      await assertSwapEvent(
        {
          isExactInput: true,
          tokenIn: ptToken.address,
          tokenOut: usdc.address,
          amountIn: ptBalanceBefore.sub(ptBalanceAfter),
          amountOut: usdcBalanceAfter.sub(usdcBalanceBefore),
        },
        router,
        tx
      );
    });

    it.only('pt-sUSDe to USDC exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user.address);
      const usdcBalanceBefore = await usdc.balanceOf(user.address);

      const swapCalldata = constructSwap([Dex.PendleCurveRouter], [SWAP_ONE]);
      const usdcOut = parseUnits('100.1', await usdc.decimals());
      const maxPtIn = parseUnits('120.6', await ptToken.decimals());
      await ptToken.connect(user).approve(router.address, maxPtIn);
      const tx = await router
        .connect(user)
        .swapExactOutput(swapCalldata, ptToken.address, usdc.address, maxPtIn, usdcOut);
      await showGasUsage(tx);

      const ptBalanceAfter = await ptToken.balanceOf(user.address);
      const ptIn = ptBalanceBefore.sub(ptBalanceAfter);
      console.log(`ptIn: ${formatUnits(ptIn, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);

      const usdcBalanceAfter = await usdc.balanceOf(user.address);
      console.log(
        `usdcOut: ${formatUnits(usdcBalanceAfter.sub(usdcBalanceBefore), await usdc.decimals())} ${await usdc.symbol()}`
      );
      expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.eq(usdcOut);

      const usdcBalanceOnAdapter = await usdc.balanceOf(pendleCurveAdapter.address);
      console.log(
        `usdcBalanceOnAdapter: ${formatUnits(usdcBalanceOnAdapter, await usdc.decimals())} ${await usdc.symbol()}`
      );

      await assertSwapEvent(
        {
          isExactInput: false,
          tokenIn: ptToken.address,
          tokenOut: usdc.address,
          amountIn: ptBalanceBefore.sub(ptBalanceAfter),
          amountOut: usdcBalanceAfter.sub(usdcBalanceBefore),
        },
        router,
        tx
      );
    });
  });

  // describe('Pendle swap post maturity', () => {
  //   let ptToken: ERC20;
  //   let usdc: ERC20;
  //   let usd0PlusPlusToken: ERC20;
  //   let router: MarginlyRouter;
  //   let pendleCurveAdapter: PendleCurveRouterNgAdapter;
  //   let user: SignerWithAddress;
  //   let owner: SignerWithAddress;

  //   beforeEach(async () => {
  //     ({
  //       ptToken,
  //       usdcToken: usdc,
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

  //   it('USDC to pt-susde exact input, forbidden', async () => {
  //     const ptBalanceBefore = await ptToken.balanceOf(user.address);
  //     console.log(
  //       `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
  //     );
  //     const sUsdeBalanceBefore = await usdc.balanceOf(user.address);
  //     console.log(
  //       `usdcBalanceBefore: ${formatUnits(sUsdeBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
  //     );

  //     const swapCalldata = constructSwap([Dex.PendleCurveRouter], [SWAP_ONE]);
  //     await usdc.connect(user).approve(router.address, sUsdeBalanceBefore);
  //     const tx = router
  //       .connect(user)
  //       .swapExactInput(
  //         swapCalldata,
  //         usdc.address,
  //         ptToken.address,
  //         sUsdeBalanceBefore,
  //         sUsdeBalanceBefore.mul(9).div(10)
  //       );

  //     await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

  //     console.log('This swap is forbidden after maturity');
  //     const ptBalanceAfter = await ptToken.balanceOf(user.address);
  //     console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
  //     expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
  //     const sUsdeBalanceAfter = await usdc.balanceOf(user.address);
  //     console.log(`usdcBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
  //     expect(sUsdeBalanceAfter).to.be.eq(sUsdeBalanceBefore);
  //   });

  //   it('USDC to pt-susde exact output, forbidden', async () => {
  //     const ptBalanceBefore = await ptToken.balanceOf(user.address);
  //     console.log(
  //       `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
  //     );
  //     const usdcBalanceBefore = await usdc.balanceOf(user.address);
  //     console.log(
  //       `sUsdeBalanceBefore: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`
  //     );

  //     const swapCalldata = constructSwap([Dex.PendleCurveRouter], [SWAP_ONE]);
  //     const ptOut = usdcBalanceBefore.div(2);
  //     await usdc.connect(user).approve(router.address, usdcBalanceBefore);
  //     const tx = router
  //       .connect(user)
  //       .swapExactOutput(swapCalldata, usdc.address, ptToken.address, usdcBalanceBefore, ptOut);
  //     await expect(tx).to.be.revertedWithCustomError(pendleCurveAdapter, 'NotSupported');

  //     console.log('This swap is forbidden after maturity');
  //     const ptBalanceAfter = await ptToken.balanceOf(user.address);
  //     console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
  //     expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
  //     const usdcBalanceAfter = await usdc.balanceOf(user.address);
  //     console.log(`usdcBalanceAfter: ${formatUnits(usdcBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
  //     expect(usdcBalanceAfter).to.be.eq(usdcBalanceBefore);
  //   });

  //   it('pt-susde to USDC exact input', async () => {
  //     const ptBalanceBefore = await ptToken.balanceOf(user.address);
  //     console.log(
  //       `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
  //     );
  //     const usdcBalanceBefore = await usdc.balanceOf(user.address);
  //     console.log(`usdcBalanceBefore: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`);

  //     const swapCalldata = constructSwap([Dex.PendleCurveRouter], [SWAP_ONE]);
  //     const ptIn = ptBalanceBefore;
  //     await ptToken.connect(user).approve(router.address, ptIn);
  //     const tx = await router.connect(user).swapExactInput(swapCalldata, ptToken.address, usdc.address, ptIn, 0);
  //     await showGasUsage(tx);

  //     const ptBalanceAfter = await ptToken.balanceOf(user.address);
  //     console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
  //     expect(ptBalanceBefore.sub(ptBalanceAfter)).to.be.eq(ptIn);
  //     const usdcBalanceAfter = await usdc.balanceOf(user.address);
  //     console.log(`usdcBalanceAfter: ${formatUnits(usdcBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
  //     expect(usdcBalanceAfter).to.be.greaterThan(usdcBalanceBefore);

  //     await assertSwapEvent(
  //       {
  //         isExactInput: true,
  //         tokenIn: ptToken.address,
  //         tokenOut: usdc.address,
  //         amountIn: ptBalanceBefore.sub(ptBalanceAfter),
  //         amountOut: usdcBalanceAfter.sub(usdcBalanceBefore),
  //       },
  //       router,
  //       tx
  //     );
  //   });

  //   it('pt-susde to USDC exact output', async () => {
  //     const ptBalanceBefore = await ptToken.balanceOf(user.address);
  //     console.log(
  //       `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
  //     );
  //     const usdcBalanceBefore = await usdc.balanceOf(user.address);
  //     console.log(`usdcBalanceBefore: ${formatUnits(usdcBalanceBefore, await usdc.decimals())} ${await usdc.symbol()}`);

  //     const swapCalldata = constructSwap([Dex.PendleCurveRouter], [SWAP_ONE]);
  //     const usdcOut = parseUnits('900', 6);
  //     await ptToken.connect(user).approve(router.address, ptBalanceBefore);
  //     const maxPtIn = parseUnits('1000', 18);
  //     const tx = await router
  //       .connect(user)
  //       .swapExactOutput(swapCalldata, ptToken.address, usdc.address, maxPtIn, usdcOut);
  //     await showGasUsage(tx);

  //     const ptBalanceAfter = await ptToken.balanceOf(user.address);
  //     console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
  //     expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
  //     const usdcBalanceAfter = await usdc.balanceOf(user.address);
  //     console.log(`sUsdeBalanceAfter: ${formatUnits(usdcBalanceAfter, await usdc.decimals())} ${await usdc.symbol()}`);
  //     expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.eq(usdcOut);

  //     await assertSwapEvent(
  //       {
  //         isExactInput: false,
  //         tokenIn: ptToken.address,
  //         tokenOut: usdc.address,
  //         amountIn: ptBalanceBefore.sub(ptBalanceAfter),
  //         amountOut: usdcBalanceAfter.sub(usdcBalanceBefore),
  //       },
  //       router,
  //       tx
  //     );
  //   });
  // });
});
