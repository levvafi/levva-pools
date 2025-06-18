import { EventLog, formatUnits, parseUnits, ZeroAddress } from 'ethers';
import { initializeTestSystem, SystemUnderTest } from '.';
import { logger } from '../utils/logger';
import { showSystemAggregates } from '../utils/log-utils';
import { CallType, uniswapV3Swapdata } from '../utils/chain-ops';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { FP96 } from '../utils/fixed-point';

describe('Simulation', () => {
  it('Simulation1', async () => {
    const sut = await loadFixture(initializeTestSystem);
    await simulation1(sut);
  });

  it('Simulation2', async () => {
    const sut = await loadFixture(initializeTestSystem);
    await simulation2(sut);
  });

  it('Simulation3', async () => {
    const sut = await loadFixture(initializeTestSystem);
    await simulation3(sut);
  });
});

export async function prepareAccounts(sut: SystemUnderTest) {
  const { treasury, usdc, weth, accounts } = sut;
  logger.debug(`Depositing accounts`);
  for (let i = 0; i < 4; i++) {
    const account = accounts[i];
    await Promise.all([
      (await usdc.connect(treasury).transfer(account, parseUnits('5000', 6), { gasLimit: 80_000 })).wait(),
      (await weth.connect(treasury).transfer(account, parseUnits('10', 18), { gasLimit: 80_000 })).wait(),
    ]);
  }
  logger.debug(`Depositing accounts completed`);
}

/*
 Lender deposit WETH
 Shorter open short position with big leverage
 Longer open long position on all short collateral
 After some time pool hasn't enough liquidity to enact margin call for short position
 Liquidator receive short position with deposit of 1000 USDC
*/
async function simulation1(sut: SystemUnderTest) {
  logger.info(`Starting simulation1 test suite`);
  const { marginlyPool, usdc, weth, accounts, treasury } = sut;

  await prepareAccounts(sut);

  const lender = accounts[0];
  const shorter = accounts[1];
  const longer = accounts[2];
  const receiver = accounts[3];

  const lenderDepositBaseAmount = parseUnits('2.1', 18);
  logger.info(`Lender deposit ${formatUnits(lenderDepositBaseAmount, 18)} WETH`);
  await (await weth.connect(lender).approve(marginlyPool, lenderDepositBaseAmount)).wait();
  await (
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, lenderDepositBaseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 400_000,
      })
  ).wait();
  await showSystemAggregates(sut);

  const shorterDepositQuote = parseUnits('280', 6);
  logger.info(`Shorter deposit ${formatUnits(shorterDepositQuote, 6)} USDC`);
  await (await usdc.connect(shorter).approve(marginlyPool, shorterDepositQuote)).wait();
  await (
    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, shorterDepositQuote, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 400_000,
      })
  ).wait();

  const basePrice = (await marginlyPool.getBasePrice()).inner;
  const shortAmount = (17n * shorterDepositQuote * FP96.one) / basePrice;
  const minPrice = basePrice / 2n;
  await (
    await marginlyPool
      .connect(shorter)
      .execute(CallType.Short, shortAmount, 0, minPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 900_000,
      })
  ).wait();
  logger.info(`Short to ${formatUnits(shortAmount, 18)} WETH`);
  await showSystemAggregates(sut);

  const longDepositBase = parseUnits('0.1', 18);
  logger.info(`Longer deposit ${formatUnits(longDepositBase, 18)} WETH`);
  await (await weth.connect(longer).approve(marginlyPool, longDepositBase)).wait();
  await (
    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, longDepositBase, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 400_000,
      })
  ).wait();

  const longAmount = parseUnits('0.5', 18);
  logger.info(`Long to ${formatUnits(longAmount, 18)} WETH`);
  const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
  await (
    await marginlyPool
      .connect(longer)
      .execute(CallType.Long, longAmount, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 900_000 })
  ).wait();
  await showSystemAggregates(sut);

  // shift dates and reinit
  logger.info(`Shift date for 1 month, 1 day per iteration`);
  // shift time to 1 year
  const numOfSeconds = 24 * 60 * 60; // 1 day
  let nextDate = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 30; i++) {
    logger.info(`Iteration ${i + 1} of 30`);
    nextDate += numOfSeconds;
    await time.setNextBlockTimestamp(nextDate);

    try {
      const txReceipt = await (
        await marginlyPool
          .connect(treasury)
          .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 })
      ).wait();
      const marginCallEvent = txReceipt?.logs
        ?.filter((e) => e instanceof EventLog)
        .find((e) => e.eventName == 'EnactMarginCall');
      if (marginCallEvent) {
        logger.info(`\n`);
        logger.warn(`Margin call happened at day ${i} (${nextDate} time)`);
        logger.warn(` mc account: ${marginCallEvent.args![0]}`);
      }
    } catch {
      // we are in liquidity shortage state try to receive position and continue
      logger.warn(`⛔️ Pool liquidity not enough to cover position debt`);
      logger.info(`   bad position ${shorter.address}`);

      const quoteAmount = parseUnits('1000', 6); // 1000 USDC
      const wethAmount = parseUnits('0', 18); // 0 ETH

      await (await usdc.connect(receiver).approve(marginlyPool, quoteAmount)).wait();
      await (await weth.connect(receiver).approve(marginlyPool, wethAmount)).wait();

      await (
        await marginlyPool
          .connect(receiver)
          .execute(CallType.ReceivePosition, quoteAmount, wethAmount, 0, false, shorter, uniswapV3Swapdata(), {
            gasLimit: 300_000,
          })
      ).wait();

      logger.info(`☠️ bad position liquidated`);
    }

    await showSystemAggregates(sut);
  }
}

/// Lender USDC
async function simulation2(sut: SystemUnderTest) {
  logger.info(`Starting simulation2 test suite`);
  const { marginlyPool, usdc, weth, accounts, treasury } = sut;

  await prepareAccounts(sut);

  const lender = accounts[0];
  const shorter = accounts[1];
  const longer = accounts[2];
  const liquidator = accounts[3];

  const lenderDepositQuoteAmount = parseUnits('5000', 6);
  logger.info(`Lender deposit ${formatUnits(lenderDepositQuoteAmount, 6)} USDC`);
  await (await usdc.connect(lender).approve(marginlyPool, lenderDepositQuoteAmount)).wait();
  await (
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, lenderDepositQuoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 400_000,
      })
  ).wait();
  await showSystemAggregates(sut);

  const basePrice = (await marginlyPool.getBasePrice()).inner;
  const longCollateral = (lenderDepositQuoteAmount * 95n * FP96.one) / 100n / basePrice;
  const longDepositBase = longCollateral / 10n;
  logger.info(`Longer deposit ${formatUnits(longDepositBase, 18)} WETH`);
  await (await weth.connect(longer).approve(marginlyPool, longDepositBase)).wait();
  await (
    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, longDepositBase, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 400_000,
      })
  ).wait();

  const longAmount = longCollateral - longDepositBase;
  logger.info(`Long to ${formatUnits(longAmount, 18)} WETH`);
  const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
  await (
    await marginlyPool
      .connect(longer)
      .execute(CallType.Long, longAmount, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 900_000 })
  ).wait();
  await showSystemAggregates(sut);

  const shorterDepositQuote = parseUnits('600', 6);
  logger.info(`Shorter deposit ${formatUnits(shorterDepositQuote, 6)} USDC`);
  await (await usdc.connect(shorter).approve(marginlyPool, shorterDepositQuote)).wait();
  await (
    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, shorterDepositQuote, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 400_000,
      })
  ).wait();

  const shortAmount = longAmount;
  const minPrice = basePrice / 2n;
  await (
    await marginlyPool
      .connect(shorter)
      .execute(CallType.Short, shortAmount, 0, minPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 900_000,
      })
  ).wait();
  logger.info(`Short to ${formatUnits(shortAmount, 18)} WETH`);
  await showSystemAggregates(sut);

  // shift dates and reinit
  logger.info(`Shift date for 1 month, 1 day per iteration`);
  // shift time to 1 year
  const numOfSeconds = 24 * 60 * 60; // 1 day
  let nextDate = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 30; i++) {
    logger.info(`Iteration ${i + 1} of 30`);
    nextDate += numOfSeconds;
    await time.setNextBlockTimestamp(nextDate);

    try {
      const txReceipt = await (
        await marginlyPool
          .connect(treasury)
          .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 })
      ).wait();
      const marginCallEvent = txReceipt?.logs
        ?.filter((e) => e instanceof EventLog)
        .find((e) => e.eventName == 'EnactMarginCall');
      if (marginCallEvent) {
        logger.info(`\n`);
        logger.warn(`Margin call happened at day ${i} (${nextDate} time)`);
        logger.warn(` mc account: ${marginCallEvent.args![0]}`);
      }
    } catch {
      // we are in liquidity shortage state try to receive position and continue
      logger.warn(`⛔️ Pool liquidity not enough to cover position debt`);
      logger.info(`   bad position ${longer.address}`);

      const quoteAmount = parseUnits('0', 6); // 0 USDC
      const wethAmount = parseUnits('1', 18); // 0 ETH

      await (await usdc.connect(liquidator).approve(marginlyPool, quoteAmount)).wait();
      await (await weth.connect(liquidator).approve(marginlyPool, wethAmount)).wait();

      await (
        await marginlyPool
          .connect(liquidator)
          .execute(CallType.ReceivePosition, quoteAmount, wethAmount, 0, false, longer, uniswapV3Swapdata(), {
            gasLimit: 300_000,
          })
      ).wait();

      logger.info(`☠️ bad position liquidated`);
    }
    await showSystemAggregates(sut);
  }
}

async function simulation3(sut: SystemUnderTest) {
  logger.info(`Starting simulation2 test suite`);
  const { marginlyPool, usdc, weth, accounts, treasury } = sut;

  await prepareAccounts(sut);

  const lender = accounts[0];
  const shorter = accounts[1];
  const longer = accounts[2];

  const lenderDepositQuoteAmount = parseUnits('3300', 6);
  logger.info(`Lender deposit ${formatUnits(lenderDepositQuoteAmount, 6)} USDC`);
  await (await usdc.connect(lender).approve(marginlyPool, lenderDepositQuoteAmount)).wait();
  await (
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, lenderDepositQuoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 400_000,
      })
  ).wait();

  const lenderDepositBaseAmount = parseUnits('0.1', 18);
  await (await weth.connect(lender).approve(marginlyPool, lenderDepositBaseAmount)).wait();
  await (
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositBase, lenderDepositBaseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 400_000,
      })
  ).wait();
  await showSystemAggregates(sut);

  const basePrice = (await marginlyPool.getBasePrice()).inner;
  const longCollateral = (lenderDepositQuoteAmount * 95n * FP96.one) / 100n / basePrice;
  const longDepositBase = longCollateral / 10n;
  logger.info(`Longer deposit ${formatUnits(longDepositBase, 18)} WETH`);
  await (await weth.connect(longer).approve(marginlyPool, longDepositBase)).wait();
  await (
    await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, longDepositBase, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 400_000,
      })
  ).wait();

  const longAmount = longCollateral - longDepositBase;
  logger.info(`Long to ${formatUnits(longAmount, 18)} WETH`);
  const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
  await (
    await marginlyPool
      .connect(longer)
      .execute(CallType.Long, longAmount, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 900_000 })
  ).wait();
  await showSystemAggregates(sut);

  const shorterDepositQuote = parseUnits('300', 6);
  logger.info(`Shorter deposit ${formatUnits(shorterDepositQuote, 6)} USDC`);
  await (await usdc.connect(shorter).approve(marginlyPool, shorterDepositQuote)).wait();
  await (
    await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, shorterDepositQuote, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 400_000,
      })
  ).wait();

  const shortAmount = longAmount;
  const minPrice = (await marginlyPool.getBasePrice()).inner / 2n;
  await (
    await marginlyPool
      .connect(shorter)
      .execute(CallType.Short, shortAmount, 0, minPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 900_000,
      })
  ).wait();
  logger.info(`Short to ${formatUnits(shortAmount, 18)} WETH`);
  await showSystemAggregates(sut);

  // shift dates and reinit
  logger.info(`Shift date for 1 month, 1 day per iteration`);
  // shift time to 1 year
  const numOfSeconds = 24 * 60 * 60; // 1 day
  let nextDate = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 30; i++) {
    logger.info(`Iteration ${i + 1} of 30`);
    nextDate += numOfSeconds;
    await time.setNextBlockTimestamp(nextDate);

    const txReceipt = await (
      await marginlyPool
        .connect(treasury)
        .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 })
    ).wait();
    const marginCallEvent = txReceipt?.logs
      ?.filter((e) => e instanceof EventLog)
      .find((e) => e.eventName == 'EnactMarginCall');
    if (marginCallEvent) {
      logger.info(`\n`);
      logger.warn(`Margin call happened at day ${i} (${nextDate} time)`);
      logger.warn(` mc account: ${marginCallEvent.args![0]}`);
    }

    await showSystemAggregates(sut);
  }
}
