import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  ERC20,
  MarginlyRouter,
  MarginlyRouter__factory,
  PendleMarketAdapter,
  PendleMarketAdapter__factory,
} from '../../typechain-types';
import { constructSwap, Dex, resetFork, SWAP_ONE } from '../shared/utils';
import { formatUnits, parseUnits } from 'ethers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { EthereumMainnetERC20BalanceOfSlot, setTokenBalance } from '../shared/tokens';

async function initializeRouterEthSUSDe(): Promise<{
  ptToken: ERC20;
  sUsde: ERC20;
  router: MarginlyRouter;
  pendleAdapter: PendleMarketAdapter;
  owner: SignerWithAddress;
  user: SignerWithAddress;
}> {
  const [owner, user] = await ethers.getSigners();
  const ptToken = await ethers.getContractAt('ERC20', '0xd810362556296c834E30C9A61d8e21a5cf29eAb4');
  const sUsde = await ethers.getContractAt('ERC20', '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497');
  const poolInput = {
    pendleMarket: '0x107a2e3cd2bb9a32b9ee2e4d51143149f8367eba',
    slippage: 20,
    ptToken: ptToken,
    ibToken: sUsde,
  };
  const pendleAdapter = await new PendleMarketAdapter__factory().connect(owner).deploy([poolInput]);
  const routerInput = {
    dexIndex: Dex.Pendle,
    adapter: pendleAdapter,
  };
  const router = await new MarginlyRouter__factory().connect(owner).deploy([routerInput]);

  const balance = parseUnits('1000', 18);
  await setTokenBalance(sUsde.target, EthereumMainnetERC20BalanceOfSlot.SUSDE, user.address, balance);
  await setTokenBalance(ptToken.target, EthereumMainnetERC20BalanceOfSlot.PTSUSDE, user.address, balance);

  return {
    ptToken,
    sUsde,
    router,
    pendleAdapter,
    owner,
    user,
  };
}

// Tests for running in ethereum mainnet fork
describe('Pendle PT-sUSDE - sUSDE', () => {
  before(async () => {
    await resetFork(20032943);
  });

  describe('Pendle swap pre maturity', () => {
    let ptToken: ERC20;
    let sUsde: ERC20;
    let router: MarginlyRouter;
    let pendleAdapter: PendleMarketAdapter;
    let user: SignerWithAddress;
    let owner: SignerWithAddress;
    beforeEach(async () => {
      ({ ptToken, sUsde, router, pendleAdapter, owner, user } = await initializeRouterEthSUSDe());
    });

    it('sUSDe to pt exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `pt balance Before: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const sUsdeBalanceBefore = await sUsde.balanceOf(user);
      console.log(
        `sUSDe balance before: ${formatUnits(sUsdeBalanceBefore, await sUsde.decimals())} ${await sUsde.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.Pendle], [BigInt(SWAP_ONE)]);
      const sUsdeSwapAmount = sUsdeBalanceBefore;
      await sUsde.connect(user).approve(router, sUsdeSwapAmount);
      await router
        .connect(user)
        .swapExactInput(swapCalldata, sUsde, ptToken, sUsdeSwapAmount, (sUsdeSwapAmount * 9n) / 10n);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.greaterThan(ptBalanceBefore);
      const sUsdeBalanceAfter = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await sUsde.decimals())} ${await sUsde.symbol()}`
      );
      expect(sUsdeBalanceBefore - sUsdeBalanceAfter).to.be.lessThanOrEqual(sUsdeSwapAmount);
    });

    it('sUSDE to pt exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const sUsdeBalanceBefore = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceBefore: ${formatUnits(sUsdeBalanceBefore, await sUsde.decimals())} ${await sUsde.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.Pendle], [BigInt(SWAP_ONE)]);
      const ptOut = sUsdeBalanceBefore / 2n;
      await sUsde.connect(user).approve(router, sUsdeBalanceBefore);
      await router.connect(user).swapExactOutput(swapCalldata, sUsde, ptToken, sUsdeBalanceBefore, ptOut);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter - ptBalanceBefore).to.be.eq(ptOut);
      const sUsdeBalanceAfter = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await sUsde.decimals())} ${await sUsde.symbol()}`
      );
      expect(sUsdeBalanceBefore).to.be.greaterThan(sUsdeBalanceAfter);
    });

    it('pt to sUSDe exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const sUSDeBalanceBefore = await sUsde.balanceOf(user);
      console.log(
        `sUSDeBalanceBefore: ${formatUnits(sUSDeBalanceBefore, await sUsde.decimals())} ${await sUsde.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.Pendle], [BigInt(SWAP_ONE)]);
      const ptIn = ptBalanceBefore;
      await ptToken.connect(user).approve(router, ptIn);
      await router.connect(user).swapExactInput(swapCalldata, ptToken, sUsde, ptIn, 0);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore - ptBalanceAfter).to.be.eq(ptIn);
      const sUsdeBalanceAfter = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await sUsde.decimals())} ${await sUsde.symbol()}`
      );
      expect(sUsdeBalanceAfter).to.be.greaterThan(sUSDeBalanceBefore);
    });

    it('pt to sUSDe exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const sUsdeBalanceBefore = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceBefore: ${formatUnits(sUsdeBalanceBefore, await sUsde.decimals())} ${await sUsde.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.Pendle], [BigInt(SWAP_ONE)]);
      const sUSDeOut = ptBalanceBefore / 2n;
      const maxPtIn = (sUSDeOut * 120n) / 100n;
      await ptToken.connect(user).approve(router, maxPtIn);
      await router.connect(user).swapExactOutput(swapCalldata, ptToken, sUsde, (sUSDeOut * 12n) / 10n, sUSDeOut);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
      const sUsdeBalanceAfter = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await sUsde.decimals())} ${await sUsde.symbol()}`
      );
      expect(sUsdeBalanceAfter - sUsdeBalanceBefore).to.be.eq(sUSDeOut);

      const sUsdeBalanceOwner = await sUsde.balanceOf(owner);
      console.log(
        `sUsdeBalanceOwner: ${formatUnits(sUsdeBalanceOwner, await sUsde.decimals())}  ${await sUsde.symbol()}`
      );

      await pendleAdapter.connect(owner).redeemDust(ptToken, sUsde, owner);

      const sUsdeBalanceOwnerAfterRedeem = await sUsde.balanceOf(owner);
      console.log(
        `sUsdeBalanceOwnerAfterRedeem: ${formatUnits(
          sUsdeBalanceOwnerAfterRedeem,
          await sUsde.decimals()
        )} ${await sUsde.symbol()}`
      );
      expect(sUsdeBalanceOwnerAfterRedeem).to.be.greaterThanOrEqual(0n);
    });
  });

  describe('Pendle swap post maturity', () => {
    let ptToken: ERC20;
    let sUsde: ERC20;
    let router: MarginlyRouter;
    let pendleAdapter: PendleMarketAdapter;
    let user: SignerWithAddress;
    let owner: SignerWithAddress;
    beforeEach(async () => {
      ({ ptToken, sUsde, router, pendleAdapter, owner, user } = await initializeRouterEthSUSDe());

      // move time and make after maturity
      await ethers.provider.send('evm_increaseTime', [180 * 24 * 60 * 60]);
      await ethers.provider.send('evm_mine', []);
    });

    it('sUsde to pt exact input, forbidden', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const sUsdeBalanceBefore = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceBefore: ${formatUnits(sUsdeBalanceBefore, await sUsde.decimals())} ${await sUsde.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.Pendle], [BigInt(SWAP_ONE)]);
      await sUsde.connect(user).approve(router, sUsdeBalanceBefore);
      const tx = router
        .connect(user)
        .swapExactInput(swapCalldata, sUsde, ptToken, sUsdeBalanceBefore, (sUsdeBalanceBefore * 9n) / 10n);
      await expect(tx).to.be.revertedWithCustomError(pendleAdapter, 'NotSupported');

      console.log('This swap is forbidden after maturity');
      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
      const sUsdeBalanceAfter = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await sUsde.decimals())} ${await sUsde.symbol()}`
      );
      expect(sUsdeBalanceAfter).to.be.eq(sUsdeBalanceBefore);
    });

    it('sUsde to pt exact output, forbidden', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const sUsdeBalanceBefore = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceBefore: ${formatUnits(sUsdeBalanceBefore, await sUsde.decimals())} ${await sUsde.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.Pendle], [BigInt(SWAP_ONE)]);
      const ptOut = sUsdeBalanceBefore / 2n;
      await sUsde.connect(user).approve(router, sUsdeBalanceBefore);
      const tx = router.connect(user).swapExactOutput(swapCalldata, sUsde, ptToken, sUsdeBalanceBefore, ptOut);
      await expect(tx).to.be.revertedWithCustomError(pendleAdapter, 'NotSupported');

      console.log('This swap is forbidden after maturity');
      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);
      const sUsdeBalanceAfter = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await sUsde.decimals())} ${await sUsde.symbol()}`
      );
      expect(sUsdeBalanceAfter).to.be.eq(sUsdeBalanceBefore);
    });

    it('pt to sUsde exact input', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const sUsdeBalanceBefore = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceBefore: ${formatUnits(sUsdeBalanceBefore, await sUsde.decimals())} ${await sUsde.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.Pendle], [BigInt(SWAP_ONE)]);
      const ptIn = ptBalanceBefore;
      await ptToken.connect(user).approve(router, ptIn);
      await router.connect(user).swapExactInput(swapCalldata, ptToken, sUsde, ptIn, 0);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore - ptBalanceAfter).to.be.eq(ptIn);
      const sUsdeBalanceAfter = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await sUsde.decimals())} ${await sUsde.symbol()}`
      );
      expect(sUsdeBalanceAfter).to.be.greaterThan(sUsdeBalanceBefore);
    });

    it('pt to sUsde exact output', async () => {
      const ptBalanceBefore = await ptToken.balanceOf(user);
      console.log(
        `ptBalanceBefore: ${formatUnits(ptBalanceBefore, await ptToken.decimals())} ${await ptToken.symbol()}`
      );
      const sUsdeBalanceBefore = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceBefore: ${formatUnits(sUsdeBalanceBefore, await sUsde.decimals())} ${await sUsde.symbol()}`
      );

      const swapCalldata = constructSwap([Dex.Pendle], [BigInt(SWAP_ONE)]);
      const sUsdeOut = ptBalanceBefore / 2n;
      await ptToken.connect(user).approve(router, ptBalanceBefore);
      await router.connect(user).swapExactOutput(swapCalldata, ptToken, sUsde, (sUsdeOut * 11n) / 10n, sUsdeOut);

      const ptBalanceAfter = await ptToken.balanceOf(user);
      console.log(`ptBalanceAfter: ${formatUnits(ptBalanceAfter, await ptToken.decimals())} ${await ptToken.symbol()}`);
      expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);
      const sUsdeBalanceAfter = await sUsde.balanceOf(user);
      console.log(
        `sUsdeBalanceAfter: ${formatUnits(sUsdeBalanceAfter, await sUsde.decimals())} ${await sUsde.symbol()}`
      );
      expect(sUsdeBalanceAfter - sUsdeBalanceBefore).to.be.eq(sUsdeOut);
    });
  });
});
