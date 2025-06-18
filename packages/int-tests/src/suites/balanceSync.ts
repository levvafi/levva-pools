import { formatUnits, parseUnits, ZeroAddress } from 'ethers';
import { initializeTestSystem, SystemUnderTest } from '.';
import { logger } from '../utils/logger';
import { CallType, uniswapV3Swapdata } from '../utils/chain-ops';
import { FP96 } from '../utils/fixed-point';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import assert from 'assert';

describe('Balance sync', () => {
  it('Balance sync', async () => {
    const sut = await loadFixture(initializeTestSystem);
    balanceSync(sut);
  });

  it('Balance sync withdraw base', async () => {
    const sut = await loadFixture(initializeTestSystem);
    balanceSyncWithdrawBase(sut);
  });

  it('Balance sync withdraw quote', async () => {
    const sut = await loadFixture(initializeTestSystem);
    balanceSyncWithdrawQuote(sut);
  });
});

async function balanceSync(sut: SystemUnderTest) {
  logger.info(`Starting balanceSync test suite`);
  const { marginlyPool, marginlyFactory, treasury, usdc, weth } = sut;

  const techPositionOwner = await marginlyFactory.techPositionOwner();

  assert((await marginlyPool.positions(techPositionOwner)).discountedBaseAmount == 0n);
  assert((await marginlyPool.positions(techPositionOwner)).discountedQuoteAmount == 0n);
  assert((await marginlyPool.discountedBaseCollateral()) == 0n);
  assert((await marginlyPool.discountedQuoteCollateral()) == 0n);
  assert((await weth.balanceOf(marginlyPool)) == 0n);
  assert((await usdc.balanceOf(marginlyPool)) == 0n);

  const baseTransferAmount = parseUnits('1', 18);
  const quoteTransferAmount = parseUnits('2000', 6);
  logger.info(
    `Someone transfers ${formatUnits(baseTransferAmount, 18)} WETH and ${formatUnits(quoteTransferAmount, 6)} USDC`
  );
  await (await weth.connect(treasury).transfer(marginlyPool, baseTransferAmount, { gasLimit: 80_000 })).wait();
  await (await usdc.connect(treasury).transfer(marginlyPool, quoteTransferAmount, { gasLimit: 80_000 })).wait();

  logger.info(`Reinit`);
  await marginlyPool
    .connect(treasury)
    .execute(CallType.Reinit, 0, 0, 0, true, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 1_000_000 });

  assert((await weth.balanceOf(marginlyPool)) == baseTransferAmount);
  assert((await usdc.balanceOf(marginlyPool)) == quoteTransferAmount);
  // all coeffs are 1, so discountedValue == realValue
  assert((await marginlyPool.positions(techPositionOwner)).discountedBaseAmount == baseTransferAmount);
  assert((await marginlyPool.positions(techPositionOwner)).discountedQuoteAmount == quoteTransferAmount);
  assert((await marginlyPool.discountedBaseCollateral()) == baseTransferAmount);
  assert((await marginlyPool.discountedQuoteCollateral()) == quoteTransferAmount);
}

async function balanceSyncWithdrawBase(sut: SystemUnderTest) {
  logger.info(`Starting balanceSync test suite`);
  const { marginlyPool, marginlyFactory, treasury, usdc, weth, accounts } = sut;
  const techPositionOwner = await marginlyFactory.techPositionOwner();

  assert((await marginlyPool.positions(techPositionOwner)).discountedBaseAmount == 0n);
  assert((await marginlyPool.positions(techPositionOwner)).discountedQuoteAmount == 0n);
  assert((await marginlyPool.discountedBaseCollateral()) == 0n);
  assert((await marginlyPool.discountedQuoteCollateral()) == 0n);
  assert((await weth.balanceOf(marginlyPool)) == 0n);
  assert((await usdc.balanceOf(marginlyPool)) == 0n);

  const lender = accounts[0];
  const shorter = accounts[1];

  const baseTransferAmount = parseUnits('1', 18);
  const quoteTransferAmount = parseUnits('2000', 6);

  logger.info(`Setting up lender`);
  await (await weth.connect(treasury).transfer(lender, baseTransferAmount, { gasLimit: 80_000 })).wait();
  await (await weth.connect(lender).approve(marginlyPool, baseTransferAmount)).wait();
  logger.info(`Lender deposits`);
  await (
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, baseTransferAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 1_000_000,
      })
  ).wait();

  logger.info(`Setting up shorter`);
  await (await usdc.connect(treasury).transfer(shorter, quoteTransferAmount, { gasLimit: 80_000 })).wait();
  await (await usdc.connect(shorter).approve(marginlyPool, quoteTransferAmount)).wait();
  logger.info(`Shorter deposits`);
  const minPrice = (await marginlyPool.getBasePrice()).inner / 2n;
  await (
    await marginlyPool
      .connect(shorter)
      .execute(
        CallType.DepositQuote,
        quoteTransferAmount,
        baseTransferAmount,
        minPrice,
        false,
        ZeroAddress,
        uniswapV3Swapdata(),
        { gasLimit: 1_000_000 }
      )
  ).wait();

  assert((await marginlyPool.positions(lender))._type == 1n);
  assert((await marginlyPool.positions(shorter))._type == 2n);

  logger.info(`Someone transfers ${formatUnits(baseTransferAmount, 18)} WETH`);
  await weth.connect(treasury).transfer(marginlyPool, baseTransferAmount, { gasLimit: 80_000 });

  logger.info(`Lender withdraws`);
  await (
    await marginlyPool
      .connect(lender)
      .execute(CallType.WithdrawBase, baseTransferAmount / 2n, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 1_000_000,
      })
  ).wait();
  logger.info(`Lender withdrew, but that tx should've failed`);

  const baseCollCoeffBefore = await marginlyPool.baseCollateralCoeff();
  const baseDebtCoeffBefore = await marginlyPool.baseDebtCoeff();
  const discountedBaseCollBefore = await marginlyPool.discountedBaseCollateral();
  const discountedBaseDebtBefore = await marginlyPool.discountedBaseDebt();

  const realCollBefore = (baseCollCoeffBefore * discountedBaseCollBefore) / FP96.one;
  const realDebtBefore = (baseDebtCoeffBefore * discountedBaseDebtBefore) / FP96.one;

  assert(realDebtBefore > realCollBefore);
  logger.info(`Oops, something went wrong, fixing`);

  logger.info(`Reinit`);
  await marginlyPool
    .connect(treasury)
    .execute(CallType.Reinit, 0, 0, 0, true, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 1_000_000 });

  const baseCollCoeffAfter = await marginlyPool.baseCollateralCoeff();
  const baseDebtCoeffAfter = await marginlyPool.baseDebtCoeff();
  const discountedBaseCollAfter = await marginlyPool.discountedBaseCollateral();
  const discountedBaseDebtAfter = await marginlyPool.discountedBaseDebt();

  const realCollAfter = (baseCollCoeffAfter * discountedBaseCollAfter) / FP96.one;
  const realDebtAfter = (baseDebtCoeffAfter * discountedBaseDebtAfter) / FP96.one;

  assert(realDebtAfter <= realCollAfter);
  logger.info(`Great, that fixed the problem`);
}

async function balanceSyncWithdrawQuote(sut: SystemUnderTest) {
  logger.info(`Starting balanceSync test suite`);
  const { marginlyPool, marginlyFactory, treasury, usdc, weth, accounts } = sut;
  const techPositionOwner = await marginlyFactory.techPositionOwner();

  assert((await marginlyPool.positions(techPositionOwner)).discountedBaseAmount == 0n);
  assert((await marginlyPool.positions(techPositionOwner)).discountedQuoteAmount == 0n);
  assert((await marginlyPool.discountedBaseCollateral()) == 0n);
  assert((await marginlyPool.discountedQuoteCollateral()) == 0n);
  assert((await weth.balanceOf(marginlyPool)) == 0n);
  assert((await usdc.balanceOf(marginlyPool)) == 0n);

  const lender = accounts[0];
  const longer = accounts[1];

  const baseTransferAmount = parseUnits('1', 18);
  const quoteTransferAmount = parseUnits('2000', 6);

  logger.info(`Setting up lender`);
  await (await usdc.connect(treasury).transfer(lender, quoteTransferAmount, { gasLimit: 80_000 })).wait();
  await (await usdc.connect(lender).approve(marginlyPool, quoteTransferAmount)).wait();
  logger.info(`Lender deposits`);
  await (
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, quoteTransferAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 1_000_000,
      })
  ).wait();

  logger.info(`Setting up longer`);
  await (await weth.connect(treasury).transfer(longer, baseTransferAmount, { gasLimit: 80_000 })).wait();
  await (await weth.connect(longer).approve(marginlyPool, baseTransferAmount)).wait();
  logger.info(`Long`);
  const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
  await (
    await marginlyPool
      .connect(longer)
      .execute(
        CallType.DepositBase,
        baseTransferAmount,
        baseTransferAmount,
        maxPrice,
        false,
        ZeroAddress,
        uniswapV3Swapdata(),
        {
          gasLimit: 1_000_000,
        }
      )
  ).wait();

  assert((await marginlyPool.positions(lender.address))._type == 1n);
  assert((await marginlyPool.positions(longer.address))._type == 3n);

  logger.info(`Someone transfers ${formatUnits(quoteTransferAmount, 6)} USDC`);
  await (await usdc.connect(treasury).transfer(marginlyPool, quoteTransferAmount, { gasLimit: 80_000 })).wait();

  logger.info(`Lender withdraws`);
  await (
    await marginlyPool
      .connect(lender)
      .execute(CallType.WithdrawQuote, quoteTransferAmount / 2n, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 1_000_000,
      })
  ).wait();
  logger.info(`Lender withdrew, but that tx should've failed`);

  const quoteCollCoeffBefore = await marginlyPool.quoteCollateralCoeff();
  const quoteDebtCoeffBefore = await marginlyPool.quoteDebtCoeff();
  const discountedQuoteCollBefore = await marginlyPool.discountedQuoteCollateral();
  const discountedQuoteDebtBefore = await marginlyPool.discountedQuoteDebt();

  const realCollBefore = (quoteCollCoeffBefore * discountedQuoteCollBefore) / FP96.one;
  const realDebtBefore = (quoteDebtCoeffBefore * discountedQuoteDebtBefore) / FP96.one;

  assert(realDebtBefore > realCollBefore);
  logger.info(`Oops, something went wrong, fixing`);

  logger.info(`Reinit`);
  await marginlyPool
    .connect(treasury)
    .execute(CallType.Reinit, 0, 0, 0, true, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 1_000_000 });

  const quoteCollCoeffAfter = await marginlyPool.quoteCollateralCoeff();
  const quoteDebtCoeffAfter = await marginlyPool.quoteDebtCoeff();
  const discountedQuoteCollAfter = await marginlyPool.discountedQuoteCollateral();
  const discountedQuoteDebtAfter = await marginlyPool.discountedQuoteDebt();

  const realCollAfter = (quoteCollCoeffAfter * discountedQuoteCollAfter) / FP96.one;
  const realDebtAfter = (quoteDebtCoeffAfter * discountedQuoteDebtAfter) / FP96.one;

  assert(realDebtAfter <= realCollAfter);
  logger.info(`Great, that fixed the problem`);
}
