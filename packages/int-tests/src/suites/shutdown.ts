import { EventLog, formatUnits, parseUnits, ZeroAddress } from 'ethers';
import { initializeTestSystem, SystemUnderTest } from '.';
import { FP96 } from '../utils/fixed-point';
import { logger } from '../utils/logger';
import { changeWethPrice } from '../utils/uniswap-ops';
import { showSystemAggregates } from '../utils/log-utils';
import { prepareAccounts } from './simulation';
import { CallType, uniswapV3Swapdata } from '../utils/chain-ops';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Shutdown', () => {
  it('Short emergency', async () => {
    const sut = await loadFixture(initializeTestSystem);
    await shortEmergency(sut);
  });

  it('Long emergency', async () => {
    const sut = await loadFixture(initializeTestSystem);
    await longEmergency(sut);
  });
});

/*
System shutdown case, when price of WETH token drastically increased
ShortEmergency
*/
async function shortEmergency(sut: SystemUnderTest) {
  logger.info(`Starting shortEmergency test suite`);
  const { marginlyPool, usdc, weth, accounts, treasury } = sut;

  await prepareAccounts(sut);

  const lender = accounts[0];
  const longer = accounts[1];
  const shorters = accounts.slice(2, 4);

  const params = await marginlyPool.params();
  await (
    await marginlyPool.connect(treasury).setParameters({ ...params, maxLeverage: 20 }, { gasLimit: 400_000 })
  ).wait();

  // lender deposit 4.0 ETH
  const lenderDepositBaseAmount = parseUnits('4', 18);
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

  // shorter deposit 250 USDC
  for (const shorter of shorters) {
    const shorterDepositQuote = parseUnits('250', 6);
    const shortAmount = parseUnits('2', 18);
    logger.info(`Shorter deposit ${formatUnits(shorterDepositQuote, 6)} USDC`);
    logger.info(`Short to ${formatUnits(shortAmount, 18)} WETH`);
    await (await usdc.connect(shorter).approve(marginlyPool, shorterDepositQuote)).wait();
    const minPrice = (await marginlyPool.getBasePrice()).inner / 2n;
    await (
      await marginlyPool
        .connect(shorter)
        .execute(
          CallType.DepositQuote,
          shorterDepositQuote,
          shortAmount,
          minPrice,
          false,
          ZeroAddress,
          uniswapV3Swapdata(),
          {
            gasLimit: 900_000,
          }
        )
    ).wait();
  }
  await showSystemAggregates(sut);

  // longer deposit 0.1 ETH
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

  // longer make long on 1.8 ETH
  const longAmount = parseUnits('0.5', 18);
  logger.info(`Long to ${formatUnits(longAmount, 18)} WETH`);
  const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
  await (
    await marginlyPool
      .connect(longer)
      .execute(CallType.Long, longAmount, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 900_000 })
  ).wait();
  await showSystemAggregates(sut);

  const wethPriceX96 = (await marginlyPool.getBasePrice()).inner * 10n ** 12n;

  logger.info(`Increasing WETH price by ~80%`);
  await changeWethPrice(treasury, sut, (wethPriceX96 * 18n) / 10n / FP96.one);

  //shift dates and reinit
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
      // we are in  liquidity shortage state try to receive position and continue
      logger.warn(`⛔️ Pool liquidity not enough to cover position debt`);

      await showSystemAggregates(sut);

      await (await marginlyPool.connect(treasury).shutDown(uniswapV3Swapdata(), { gasLimit: 500_000 })).wait();
      break;
    }
    await showSystemAggregates(sut);
  }

  const emWithdrawCoeff = await marginlyPool.emergencyWithdrawCoeff();

  const lenderPosition = await marginlyPool.positions(lender);
  const longerPosition = await marginlyPool.positions(longer);

  const lenderAmount = (lenderPosition.discountedBaseAmount * emWithdrawCoeff) / FP96.one;
  const longerAmount = (longerPosition.discountedBaseAmount * emWithdrawCoeff) / FP96.one;

  const poolBaseBalance = await weth.balanceOf(marginlyPool);

  const baseCollateral = console.log(`In pool ${poolBaseBalance}`);
  console.log(`Trying to withdraw ${lenderAmount} + ${longerAmount} = ${lenderAmount + longerAmount}`);

  /* emergencyWithdraw */
  logger.debug('system  in Emergency mode');

  await (
    await marginlyPool
      .connect(longer)
      .execute(CallType.EmergencyWithdraw, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 400_000 })
  ).wait();
  await (
    await marginlyPool
      .connect(lender)
      .execute(CallType.EmergencyWithdraw, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 400_000 })
  ).wait();

  await showSystemAggregates(sut);
}

async function longEmergency(sut: SystemUnderTest) {
  logger.info(`Starting longEmergency test suite`);
  const { marginlyPool, usdc, weth, accounts, treasury } = sut;

  await prepareAccounts(sut);

  const lender = accounts[0];
  const shorter = accounts[1];
  const longers = accounts.slice(2, 4);

  // lender deposit 3300 USDC
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
  await showSystemAggregates(sut);

  for (const longer of longers) {
    // longer deposit 0.1 ETH
    // longer make long on 0.9 ETH
    const longDepositBase = parseUnits('0.1', 18);
    logger.info(`Longer deposit ${formatUnits(longDepositBase, 18)} WETH`);
    const longAmount = parseUnits('0.9', 18);
    logger.info(`Long to ${formatUnits(longAmount, 18)} WETH`);
    await (await weth.connect(longer).approve(marginlyPool, longDepositBase)).wait();
    const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
    await (
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, longDepositBase, longAmount, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 900_000,
        })
    ).wait();
  }
  await showSystemAggregates(sut);

  //shorter deposit 300 USDC
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

  //shorter make short on 2.0 ETH
  const shortAmount = parseUnits('2', 18);
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

  const wethPriceX96 = (await marginlyPool.getBasePrice()).inner * 10n ** 12n;

  logger.info(`Decreasing WETH price by ~40%`);
  await changeWethPrice(treasury, sut, (wethPriceX96 * 6n) / 10n / FP96.one);

  //shift dates and reinit
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
      // we are in  liquidity shortage state try to receive position and continue
      logger.warn(`⛔️ Pool liquidity not enough to cover position debt`);

      await showSystemAggregates(sut);
      logger.info(`Before shutdown`);

      await (await marginlyPool.connect(treasury).shutDown(uniswapV3Swapdata(), { gasLimit: 500_000 })).wait();

      logger.info(`🛑 system in switched to emergency mode`);
      break;
    }
    await showSystemAggregates(sut);
  }

  /* emergencyWithdraw */

  await (
    await marginlyPool
      .connect(shorter)
      .execute(CallType.EmergencyWithdraw, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 400_000 })
  ).wait();
  await (
    await marginlyPool
      .connect(lender)
      .execute(CallType.EmergencyWithdraw, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 400_000 })
  ).wait();

  await showSystemAggregates(sut);
}
