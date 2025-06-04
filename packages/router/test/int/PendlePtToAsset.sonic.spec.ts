import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  assertSwapEvent,
  constructSwap,
  delay,
  Dex,
  resetFork,
  showBalance,
  showBalanceDelta,
  showGasUsage,
  SWAP_ONE,
} from '../shared/utils';
import { EthAddress } from '@marginly/common';
import { parseUnits } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  EthereumMainnetERC20BalanceOfSlot,
  setTokenBalance,
  setTokenBalanceSonic,
  SonicERC20BalanceOfSlot,
} from '../shared/tokens';
import { BigNumber, utils } from 'ethers';
import {
  PendlePtToAssetAdapter__factory,
  PendlePtToAssetAdapter,
  ERC20,
  MarginlyRouter,
  MarginlyRouter__factory,
  ERC20__factory,
} from '../../typechain-types';

interface SlotInfo {
  slot: bigint;
  isVyper: boolean;
}

export async function findBalancesSlot(tokenAddr: EthAddress, provider: ethers.providers.Provider): Promise<SlotInfo> {
  const token = ERC20__factory.connect(tokenAddr.toString(), provider);
  const randomAddress = '0x8b359fb7a31620691dc153cddd9d463259bcf29b';

  const probeValue = BigNumber.from(356);
  const encodedBalance = utils.defaultAbiCoder.encode(['uint'], [probeValue]);

  for (let i = 0n; i < 100; i++) {
    const userBalanceSlot = utils.hexStripZeros(
      utils.keccak256(utils.defaultAbiCoder.encode(['address', 'uint'], [randomAddress, i]))
    );
    console.log('tryBalanceSlot ', userBalanceSlot);
    await ethers.provider.send('hardhat_setStorageAt', [
      tokenAddr.toString(),
      userBalanceSlot,
      ethers.utils.hexlify(ethers.utils.zeroPad(probeValue.toHexString(), 32)),
    ]);
    //await setTokenBalance(tokenAddr.toString(), userBalanceSlot, EthAddress.parse(randomAddress), probeValue);
    //await ethereumRpc.setStorageAt(tokenAddr, userBalanceSlot, encodedBalance);
    const balance: BigNumber = await token.balanceOf(randomAddress);
    if (balance.eq(probeValue)) {
      console.log('Found balance slot:', i);
      return { slot: i, isVyper: false };
    }
  }

  throw new Error('Balances slot not found');
}

const swapCallData = constructSwap([Dex.PendlePtToAsset], [SWAP_ONE]);

interface TokenInfo {
  address: string;
  symbol: string;
  balanceSlot: SonicERC20BalanceOfSlot;
  initialBalance: BigNumber;
}

interface TestCase {
  forkNumber: number;

  pendleMarket: string;

  ptToken: TokenInfo;
  assetToken: TokenInfo;
  syToken: TokenInfo;

  timeToMaturity: number;
  preMaturity: {
    swapExactIbtToPt: {
      ibtIn: BigNumber;
      minPtOut: BigNumber;
    };
    swapExactPtToIbt: {
      ptIn: BigNumber;
      minIbtOut: BigNumber;
    };
    swapIbtToExactPt: {
      maxIbtIn: BigNumber;
      ptOut: BigNumber;
    };
    swapPtToExactIbt: {
      maxPtIn: BigNumber;
      ibtOut: BigNumber;
    };
  };
  postMaturity: {
    swapPtToExactIbt: {
      maxPtIn: BigNumber;
      ibtOut: BigNumber;
    };
    swapExactPtToIbt: {
      ptIn: BigNumber;
      minIbtOut: BigNumber;
    };
  };
}

const aUSDC_TestCase: TestCase = {
  forkNumber: 19429000,

  pendleMarket: '0x3f5ea53d1160177445b1898afbb16da111182418',
  ptToken: {
    address: '0x930441aa7ab17654df5663781ca0c02cc17e6643',
    symbol: 'PT-aSonUSDC-14AUG2025',
    balanceSlot: SonicERC20BalanceOfSlot.PTASONUSDC,
    initialBalance: parseUnits('100000', 6),
  },

  assetToken: {
    address: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894',
    symbol: 'USDC.e',
    balanceSlot: SonicERC20BalanceOfSlot.USDC,
    initialBalance: parseUnits('100000', 6),
  },

  syToken: {
    address: '0xc4A9d8b486f388CC0E4168d2904277e8C8372FA3',
    symbol: 'SY-aSonUSDC',
    balanceSlot: SonicERC20BalanceOfSlot.PTASONUSDC,
    initialBalance: parseUnits('100000', 6),
  },

  timeToMaturity: 180 * 24 * 60 * 60, // 180 days

  // swap params
  preMaturity: {
    swapExactIbtToPt: {
      ibtIn: parseUnits('600', 6),
      minPtOut: parseUnits('610', 6),
    },
    swapExactPtToIbt: {
      ptIn: parseUnits('745.34', 6),
      minIbtOut: parseUnits('720', 6),
    },
    swapPtToExactIbt: {
      maxPtIn: parseUnits('15000.75', 6),
      ibtOut: parseUnits('10000', 6),
    },
    swapIbtToExactPt: {
      maxIbtIn: parseUnits('125', 6),
      ptOut: parseUnits('100', 6),
    },
  },
  postMaturity: {
    swapExactPtToIbt: {
      ptIn: parseUnits('150.576', 6),
      minIbtOut: parseUnits('120.0', 6),
    },
    swapPtToExactIbt: {
      maxPtIn: parseUnits('600', 6),
      ibtOut: parseUnits('500', 6),
    },
  },
};

const testCases = [aUSDC_TestCase];

async function initializeRouter(testCase: TestCase): Promise<{
  ptToken: ERC20;
  assetToken: ERC20;
  syToken: ERC20;
  router: MarginlyRouter;
  adapter: PendlePtToAssetAdapter;
  owner: SignerWithAddress;
  user: SignerWithAddress;
}> {
  const [owner, user] = await ethers.getSigners();

  const ptToken = await ethers.getContractAt('ERC20', testCase.ptToken.address);
  const assetToken = await ethers.getContractAt('ERC20', testCase.assetToken.address);
  const syToken = await ethers.getContractAt('ERC20', testCase.syToken.address);

  const poolInput: PendlePtToAssetAdapter.PoolInputStruct = {
    ptToken: ptToken.address,
    asset: assetToken.address,
    pendleMarket: testCase.pendleMarket,
    slippage: 35,
  };

  const adapter = await new PendlePtToAssetAdapter__factory().connect(owner).deploy([poolInput]);
  console.log('Adapter initialized');
  const routerInput = {
    dexIndex: Dex.PendlePtToAsset,
    adapter: adapter.address,
  };
  const router = await new MarginlyRouter__factory().connect(owner).deploy([routerInput]);

  //console.log('Balance slot');
  //console.log(await findBalancesSlot(ptToken.address, ethers.provider));

  await setTokenBalance(
    assetToken.address,
    testCase.assetToken.balanceSlot,
    EthAddress.parse(user.address),
    testCase.assetToken.initialBalance
  );

  await setTokenBalance(
    ptToken.address,
    testCase.ptToken.balanceSlot,
    EthAddress.parse(user.address),
    testCase.ptToken.initialBalance
  );

  //await setTokenBalanceSonic(ptToken.address, 0, user.address, testCase.ptToken.initialBalance);

  expect(await ptToken.balanceOf(user.address)).to.be.eq(
    testCase.ptToken.initialBalance,
    `Wrong initial ${testCase.ptToken.symbol} balance`
  );

  expect(await assetToken.balanceOf(user.address)).to.be.eq(
    testCase.assetToken.initialBalance,
    `Wrong initial ${testCase.assetToken.symbol} balance`
  );

  return {
    ptToken,
    assetToken,
    syToken,
    router,
    adapter,
    owner,
    user,
  };
}

// Tests for running in ethereum mainnet fork
describe('PendlePtToAssetAdapter', async () => {
  for (const testCase of testCases) {
    describe(`PendlePtToAssetAdapter ${testCase.ptToken.symbol} - ${testCase.assetToken.symbol}`, () => {
      before(async () => {
        await resetFork(testCase.forkNumber);
      });

      describe('Pendle swap pre maturity', () => {
        let ptToken: ERC20;
        let assetToken: ERC20;
        let syToken: ERC20;
        let router: MarginlyRouter;
        let user: SignerWithAddress;
        let adapter: PendlePtToAssetAdapter;

        beforeEach(async () => {
          ({ ptToken, assetToken, syToken, router, adapter, user } = await initializeRouter(testCase));
        });

        it(`${testCase.assetToken.symbol} to ${testCase.ptToken.symbol} exact input`, async () => {
          const ptBalanceBefore = await showBalance(ptToken, user.address, 'balance Before:');
          const ibtBalanceBefore = await showBalance(assetToken, user.address, 'balance before:');

          const ibtTokenAmount = testCase.preMaturity.swapExactIbtToPt.ibtIn;
          await assetToken.connect(user).approve(router.address, ibtTokenAmount);

          const minPTAmount = testCase.preMaturity.swapExactIbtToPt.minPtOut;

          const tx = await router
            .connect(user)
            .swapExactInput(swapCallData, assetToken.address, ptToken.address, ibtTokenAmount, minPTAmount);
          await showGasUsage(tx);

          const ptBalanceAfter = await showBalance(ptToken, user.address, 'pt balance After:');
          expect(ptBalanceAfter).to.be.greaterThan(ptBalanceBefore);

          const ibtBalanceAfter = await showBalance(assetToken, user.address, 'Asset balance After:');
          expect(ibtBalanceBefore-(ibtBalanceAfter)).to.be.lessThanOrEqual(ibtTokenAmount);

          await assertSwapEvent(
            {
              amountIn: ibtBalanceBefore-(ibtBalanceAfter),
              amountOut: ptBalanceAfter-(ptBalanceBefore),
              isExactInput: true,
              tokenIn: assetToken.address,
              tokenOut: ptToken.address,
            },
            router,
            tx
          );

          await showBalanceDelta(ptBalanceBefore, ptBalanceAfter, ptToken, 'PT balance delta:');
          await showBalanceDelta(ibtBalanceBefore, ibtBalanceAfter, assetToken, 'Asset balance delta:');
          await showBalance(syToken, adapter.address, 'sy balance on adapter:');
          await showBalance(assetToken, adapter.address, 'asset balance on adapter:');
        });

        it(`${testCase.assetToken.symbol} to ${testCase.ptToken.symbol} exact output`, async () => {
          const ptBalanceBefore = await showBalance(ptToken, user.address, 'balance Before:');
          const ibtBalanceBefore = await showBalance(assetToken, user.address, 'balance before:');

          const exactPtOut = testCase.preMaturity.swapIbtToExactPt.ptOut;
          const ibtMaxAmountIn = testCase.preMaturity.swapIbtToExactPt.maxIbtIn;
          await assetToken.connect(user).approve(router.address, ibtMaxAmountIn);
          const tx = await router
            .connect(user)
            .swapExactOutput(swapCallData, assetToken.address, ptToken.address, ibtMaxAmountIn, exactPtOut);
          await showGasUsage(tx);

          const ptBalanceAfter = await showBalance(ptToken, user.address, 'pt balance After:');
          expect(ptBalanceAfter-(ptBalanceBefore)).to.be.eq(exactPtOut);

          const ibtBalanceAfter = await showBalance(assetToken, user.address, 'Asset balance After: ');
          expect(ibtBalanceBefore).to.be.greaterThan(ibtBalanceAfter);

          await assertSwapEvent(
            {
              amountIn: ibtBalanceBefore-(ibtBalanceAfter),
              amountOut: ptBalanceAfter-(ptBalanceBefore),
              isExactInput: false,
              tokenIn: assetToken.address,
              tokenOut: ptToken.address,
            },
            router,
            tx
          );

          await showBalanceDelta(ptBalanceBefore, ptBalanceAfter, ptToken, 'PT balance delta:');
          await showBalanceDelta(ibtBalanceBefore, ibtBalanceAfter, assetToken, 'Asset balance delta:');
          await showBalance(syToken, adapter.address, 'sy balance on adapter:');
          await showBalance(assetToken, adapter.address, 'asset balance on adapter:');
        });

        it(`${testCase.ptToken.symbol} to ${testCase.assetToken.symbol} exact input`, async () => {
          const ptBalanceBefore = await showBalance(ptToken, user.address, 'balance Before:');
          const ibtBalanceBefore = await showBalance(assetToken, user.address, 'balance before:');

          const ptIn = testCase.preMaturity.swapExactPtToIbt.ptIn;
          const minIbtOut = testCase.preMaturity.swapExactPtToIbt.minIbtOut;
          await ptToken.connect(user).approve(router.address, ptIn);
          const tx = await router
            .connect(user)
            .swapExactInput(swapCallData, ptToken.address, assetToken.address, ptIn, minIbtOut);
          await showGasUsage(tx);

          const ptBalanceAfter = await showBalance(ptToken, user.address, 'pt BalanceAfter:');
          expect(ptBalanceBefore-(ptBalanceAfter)).to.be.eq(ptIn);

          const ibtBalanceAfter = await showBalance(assetToken, user.address, 'Asset balance After:');
          expect(ibtBalanceAfter).to.be.greaterThan(ibtBalanceBefore);

          await assertSwapEvent(
            {
              amountIn: ptBalanceBefore-(ptBalanceAfter),
              amountOut: ibtBalanceAfter-(ibtBalanceBefore),
              isExactInput: true,
              tokenIn: ptToken.address,
              tokenOut: assetToken.address,
            },
            router,
            tx
          );

          await showBalanceDelta(ptBalanceBefore, ptBalanceAfter, ptToken, 'PT balance delta:');
          await showBalanceDelta(ibtBalanceBefore, ibtBalanceAfter, assetToken, 'Asset balance delta:');
          await showBalance(syToken, adapter.address, 'sy balance on adapter:');
          await showBalance(assetToken, adapter.address, 'asset balance on adapter:');
        });

        it(`${testCase.ptToken.symbol} to ${testCase.assetToken.symbol} exact output`, async () => {
          const ptBalanceBefore = await showBalance(ptToken, user.address, 'balance before:');
          const ibtBalanceBefore = await showBalance(assetToken, user.address, 'balance before:');

          const ibtMinOut = testCase.preMaturity.swapPtToExactIbt.ibtOut;
          const maxPtIn = testCase.preMaturity.swapPtToExactIbt.maxPtIn;
          await ptToken.connect(user).approve(router.address, maxPtIn);
          const tx = await router
            .connect(user)
            .swapExactOutput(swapCallData, ptToken.address, assetToken.address, maxPtIn, ibtMinOut);
          await showGasUsage(tx);

          const ptBalanceAfter = await showBalance(ptToken, user.address, 'pt balanceAfter:');
          expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);

          const ibtBalanceAfter = await showBalance(assetToken, user.address, 'Asset balance After:');
          expect(ibtBalanceAfter-(ibtBalanceBefore)).to.be.eq(ibtMinOut);

          await assertSwapEvent(
            {
              amountIn: ptBalanceBefore-(ptBalanceAfter),
              amountOut: ibtBalanceAfter-(ibtBalanceBefore),
              isExactInput: false,
              tokenIn: ptToken.address,
              tokenOut: assetToken.address,
            },
            router,
            tx
          );

          await showBalanceDelta(ptBalanceBefore, ptBalanceAfter, ptToken, 'PT balance delta:');
          await showBalanceDelta(ibtBalanceBefore, ibtBalanceAfter, assetToken, 'Asset balance delta:');
          await showBalance(syToken, adapter.address, 'sy balance on adapter:');
          await showBalance(assetToken, adapter.address, 'asset balance on adapter:');
        });
      });

      describe('Pendle swap post maturity', () => {
        let ptToken: ERC20;
        let assetToken: ERC20;
        let syToken: ERC20;
        let router: MarginlyRouter;
        let adapter: PendlePtToAssetAdapter;
        let user: SignerWithAddress;

        beforeEach(async () => {
          ({ ptToken, assetToken, syToken, router, adapter, user } = await initializeRouter(testCase));

          // move time and make after maturity
          await ethers.provider.send('evm_increaseTime', [testCase.timeToMaturity]);
          await ethers.provider.send('evm_mine', []);
        });

        it(`${testCase.assetToken.symbol} to ${testCase.ptToken.symbol} exact input, forbidden`, async () => {
          const ptBalanceBefore = await showBalance(ptToken, user.address, 'balance Before:');
          const ibtBalanceBefore = await showBalance(assetToken, user.address, 'balance before:');

          await assetToken.connect(user).approve(router.address, ibtBalanceBefore);
          const tx = router
            .connect(user)
            .swapExactInput(swapCallData, assetToken.address, ptToken.address, ibtBalanceBefore, 0);

          await expect(tx).to.be.revertedWithCustomError(adapter, 'NotSupported');

          console.log('This swap is forbidden after maturity');

          const ptBalanceAfter = await showBalance(ptToken, user.address, 'pt Balance After:');
          expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);

          const ibtBalanceAfter = await showBalance(assetToken, user.address, 'Asset balance After:');
          expect(ibtBalanceAfter).to.be.eq(ibtBalanceBefore);
        });

        it(`${testCase.assetToken.symbol} to ${testCase.ptToken.symbol} exact output, forbidden`, async () => {
          const ptBalanceBefore = await showBalance(ptToken, user.address, 'balance Before:');
          const ibtBalanceBefore = await showBalance(assetToken, user.address, 'balance before:');

          await assetToken.connect(user).approve(router.address, ibtBalanceBefore);
          const tx = router
            .connect(user)
            .swapExactOutput(swapCallData, assetToken.address, ptToken.address, ibtBalanceBefore, 1);
          await expect(tx).to.be.revertedWithCustomError(adapter, 'NotSupported');

          console.log('This swap is forbidden after maturity');

          const ptBalanceAfter = await showBalance(ptToken, user.address, 'pt Balance After:');
          expect(ptBalanceAfter).to.be.eq(ptBalanceBefore);

          const ibtBalanceAfter = await showBalance(assetToken, user.address, 'Asset balance After:');
          expect(ibtBalanceAfter).to.be.eq(ibtBalanceBefore);
        });

        it(`${testCase.ptToken.symbol} to ${testCase.assetToken.symbol} exact input`, async () => {
          const ptBalanceBefore = await showBalance(ptToken, user.address, 'balance Before:');
          const ibtBalanceBefore = await showBalance(assetToken, user.address, 'balance before:');

          const ptIn = testCase.postMaturity.swapExactPtToIbt.ptIn;
          const minIbtOut = testCase.postMaturity.swapExactPtToIbt.minIbtOut;
          await ptToken.connect(user).approve(router.address, ptIn);
          const tx = await router
            .connect(user)
            .swapExactInput(swapCallData, ptToken.address, assetToken.address, ptIn, minIbtOut);
          await showGasUsage(tx);

          const ptBalanceAfter = await showBalance(ptToken, user.address, 'ptBalanceAfter:');
          expect(ptBalanceBefore-(ptBalanceAfter)).to.be.eq(ptIn);

          const ibtBalanceAfter = await showBalance(assetToken, user.address, 'Asset balance After:');
          expect(ibtBalanceAfter).to.be.greaterThan(ibtBalanceBefore);

          await assertSwapEvent(
            {
              amountIn: ptBalanceBefore-(ptBalanceAfter),
              amountOut: ibtBalanceAfter-(ibtBalanceBefore),
              isExactInput: true,
              tokenIn: ptToken.address,
              tokenOut: assetToken.address,
            },
            router,
            tx
          );

          await showBalanceDelta(ptBalanceBefore, ptBalanceAfter, ptToken, 'PT balance delta:');
          await showBalanceDelta(ibtBalanceBefore, ibtBalanceAfter, assetToken, 'Asset balance delta:');
          await showBalance(syToken, adapter.address, 'sy balance on adapter:');
          await showBalance(assetToken, adapter.address, 'asset balance on adapter:');
        });

        it(`${testCase.ptToken.symbol} to ${testCase.assetToken.symbol} exact output`, async () => {
          const ptBalanceBefore = await showBalance(ptToken, user.address, 'pt balance Before:');
          const ibtBalanceBefore = await showBalance(assetToken, user.address, 'Asset balance before:');

          const ibtOut = testCase.postMaturity.swapPtToExactIbt.ibtOut;
          await ptToken.connect(user).approve(router.address, ptBalanceBefore);
          const maxPtIn = testCase.postMaturity.swapPtToExactIbt.maxPtIn;
          const tx = await router
            .connect(user)
            .swapExactOutput(swapCallData, ptToken.address, assetToken.address, maxPtIn, ibtOut);
          await showGasUsage(tx);

          const ptBalanceAfter = await showBalance(ptToken, user.address, 'pt Balance After:');
          expect(ptBalanceBefore).to.be.greaterThan(ptBalanceAfter);

          const ibtBalanceAfter = await showBalance(assetToken, user.address, 'Asset balance After:');
          expect(ibtBalanceAfter-(ibtBalanceBefore)).to.be.eq(ibtOut);

          await assertSwapEvent(
            {
              amountIn: ptBalanceBefore-(ptBalanceAfter),
              amountOut: ibtBalanceAfter-(ibtBalanceBefore),
              isExactInput: false,
              tokenIn: ptToken.address,
              tokenOut: assetToken.address,
            },
            router,
            tx
          );

          await showBalanceDelta(ptBalanceBefore, ptBalanceAfter, ptToken, 'PT balance delta:');
          await showBalanceDelta(ibtBalanceBefore, ibtBalanceAfter, assetToken, 'Asset balance delta:');
          await showBalance(syToken, adapter.address, 'sy balance on adapter:');
          await showBalance(assetToken, adapter.address, 'asset balance on adapter:');
        });
      });
    });

    await delay(3000);
  }
});
