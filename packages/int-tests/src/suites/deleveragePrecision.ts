import assert = require('assert');
import { EventLog, formatUnits, parseUnits, ZeroAddress } from 'ethers';
import { initializeTestSystem, SystemUnderTest } from '.';
import { CallType, uniswapV3Swapdata } from '../utils/chain-ops';
import { FP96, toHumanString } from '../utils/fixed-point';
import { logger } from '../utils/logger';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';

describe('Deleverage precision', () => {
  it('Long', async () => {
    const sut = await loadFixture(initializeTestSystem);
    deleveragePrecisionLong(sut);
  });

  it('Short', async () => {
    const sut = await loadFixture(initializeTestSystem);
    deleveragePrecisionShort(sut);
  });

  it('Long Collateral', async () => {
    const sut = await loadFixture(initializeTestSystem);
    deleveragePrecisionLongCollateral(sut);
  });

  it('Short Collateral', async () => {
    const sut = await loadFixture(initializeTestSystem);
    deleveragePrecisionShortCollateral(sut);
  });

  it('Long Reinit', async () => {
    const sut = await loadFixture(initializeTestSystem);
    deleveragePrecisionLongReinit(sut);
  });

  it('Short Reinit', async () => {
    const sut = await loadFixture(initializeTestSystem);
    deleveragePrecisionShortReinit(sut);
  });
});

const paramsDefaultLeverage = {
  interestRate: 0,
  maxLeverage: 20n,
  swapFee: 0,
  fee: 0,
  priceSecondsAgo: 900n, // 15 min
  priceSecondsAgoMC: 60n, // 1 min
  mcSlippage: 50000, //5%
  positionMinAmount: 10000000000000000n, // 0,01 ETH
  quoteLimit: 10n ** 12n * 10n ** 6n,
};

const paramsLowLeverage = {
  interestRate: 0,
  maxLeverage: 10n,
  swapFee: 0,
  fee: 0,
  priceSecondsAgo: 900n, // 15 min
  priceSecondsAgoMC: 60n, // 1 min
  mcSlippage: 50000, //5%
  positionMinAmount: 10000000000000000n, // 0,01 ETH
  quoteLimit: 10n ** 12n * 10n ** 6n,
};

const paramsWithIr = {
  interestRate: 54000,
  maxLeverage: 20n,
  swapFee: 0,
  fee: 20000,
  priceSecondsAgo: 900n, // 15 min
  priceSecondsAgoMC: 60n, // 1 min
  mcSlippage: 50000, //5%
  positionMinAmount: 10000000000000000n, // 0,01 ETH
  quoteLimit: 10n ** 12n * 10n ** 6n,
};

async function deleveragePrecisionLong(sut: SystemUnderTest) {
  const { marginlyPool, usdc, weth, accounts, treasury, gasReporter } = sut;

  const coeffsTable: { [key: string]: {} } = {};
  const aggregates: { [key: string]: {} } = {};
  const balances: { [key: string]: {} } = {};
  const positions: { [key: string]: {} } = {};

  // we set interest rate as 0 for this test so we don't need to calculate accrued rate
  // liquidations are approached via decreasing maxLeverage
  const setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsDefaultLeverage);
  await gasReporter.saveGasUsage('setParameters', setParamsTx);

  const lender = accounts[0];
  const liquidatedLong = accounts[1];
  const shortersNum = 5;
  const shorters = accounts.slice(2, 2 + shortersNum);
  // 20 WETH in total
  const shortersBaseDebt = [
    parseUnits('2', 18),
    parseUnits('3', 18),
    parseUnits('4', 18),
    parseUnits('11', 18),
    parseUnits('20', 18),
  ];

  const lenderBaseAmount = parseUnits('1', 18); // 1 WETH
  const lenderQuoteAmount = parseUnits('200000', 6); // 200000 USDC;

  await (await usdc.connect(treasury).transfer(lender, lenderQuoteAmount)).wait();
  await (await usdc.connect(lender).approve(marginlyPool, lenderQuoteAmount)).wait();

  await (await weth.connect(treasury).transfer(lender, lenderBaseAmount)).wait();
  await (await weth.connect(lender).approve(marginlyPool, lenderBaseAmount)).wait();

  logger.info(`Lender deposits quote`);
  const depositQuoteTx = await marginlyPool
    .connect(lender)
    .execute(CallType.DepositQuote, lenderQuoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
      gasLimit: 500_000,
    });
  await gasReporter.saveGasUsage('depositQuote', depositQuoteTx);
  await addToLogs(
    sut,
    1,
    1,
    shortersNum,
    'Lender depositQuote 1',
    lenderQuoteAmount.toString(),
    '0',
    coeffsTable,
    aggregates,
    balances,
    positions
  );

  logger.info(`Lender deposits base`);
  const depositBaseTx = await marginlyPool
    .connect(lender)
    .execute(CallType.DepositBase, lenderBaseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
      gasLimit: 500_000,
    });
  await gasReporter.saveGasUsage('depositBase', depositBaseTx);
  await addToLogs(
    sut,
    1,
    1,
    shortersNum,
    'Lender depositBase 1',
    lenderBaseAmount.toString(),
    '0',
    coeffsTable,
    aggregates,
    balances,
    positions
  );

  let nextDate = Math.floor(Date.now() / 1000);
  const timeDelta = 24 * 60 * 60;

  for (let i = 0; i < 10; ++i) {
    if (i == 5) {
      await (await usdc.connect(treasury).transfer(lender, lenderQuoteAmount)).wait();
      await (await usdc.connect(lender).approve(marginlyPool, lenderQuoteAmount)).wait();

      await (await weth.connect(treasury).transfer(lender, lenderBaseAmount)).wait();
      await (await weth.connect(lender).approve(marginlyPool, lenderBaseAmount)).wait();

      logger.info(`Lender deposits quote`);
      const depositQuoteTx = await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, lenderQuoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        });
      await gasReporter.saveGasUsage('depositQuote', depositQuoteTx);
      await addToLogs(
        sut,
        1,
        1,
        shortersNum,
        'Lender depositQuote 2',
        lenderQuoteAmount.toString(),
        '0',
        coeffsTable,
        aggregates,
        balances,
        positions
      );

      logger.info(`Lender deposits base`);
      const depositBaseTx = await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, lenderBaseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        });
      await gasReporter.saveGasUsage('depositBase', depositBaseTx);
      await addToLogs(
        sut,
        1,
        1,
        shortersNum,
        'Lender depositBase 2',
        lenderBaseAmount.toString(),
        '0',
        coeffsTable,
        aggregates,
        balances,
        positions
      );
    }

    logger.info(`iteration ${i + 1}`);
    const longerBaseDeposit = i < 5 ? parseUnits('1', 18) : parseUnits('2', 18);
    await (await weth.connect(treasury).transfer(liquidatedLong, longerBaseDeposit)).wait();
    await (await weth.connect(liquidatedLong).approve(marginlyPool, longerBaseDeposit)).wait();

    const longerLongAmount = i < 5 ? parseUnits('18', 18) : parseUnits('36', 18); // 18 WETH
    logger.info(`  Longer deposits base`);
    const depositBaseTx = await marginlyPool
      .connect(liquidatedLong)
      .execute(CallType.DepositBase, longerBaseDeposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    await gasReporter.saveGasUsage('depositBase', depositBaseTx);
    await addToLogs(
      sut,
      1,
      1,
      shortersNum,
      `Longer depositBase ${i}`,
      longerBaseDeposit.toString(),
      '0',
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    logger.info(`  Longer longs`);
    const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
    const longTx = await marginlyPool
      .connect(liquidatedLong)
      .execute(CallType.Long, longerLongAmount, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    const receipt = await gasReporter.saveGasUsage('long', longTx);

    const swapPrice =
      receipt.logs?.filter((e) => e instanceof EventLog).find((e) => e.eventName == 'Long')?.args?.swapPriceX96 *
      10n ** 12n;
    await addToLogs(
      sut,
      1,
      1,
      shortersNum,
      `Longer long ${i}`,
      longerLongAmount.toString(),
      toHumanString(swapPrice),
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    const shortersQuoteDeposit = parseUnits('20000', 6); // 20000 USDC

    const itersNum = i < 5 ? shortersNum - 1 : shortersNum;
    for (let j = 0; j < itersNum; ++j) {
      await (await usdc.connect(treasury).transfer(shorters[j], shortersQuoteDeposit)).wait();
      await (await usdc.connect(shorters[j]).approve(marginlyPool, shortersQuoteDeposit)).wait();
      logger.info(`  Shorter_${j} deposits quote`);
      const depositQuoteTx = await marginlyPool
        .connect(shorters[j])
        .execute(CallType.DepositQuote, shortersQuoteDeposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        });
      await gasReporter.saveGasUsage('depositQuote', depositQuoteTx);
      await addToLogs(
        sut,
        1,
        1,
        shortersNum,
        `Shorter_${j} depositQuote ${i}`,
        shortersQuoteDeposit.toString(),
        '0',
        coeffsTable,
        aggregates,
        balances,
        positions
      );

      logger.info(`  Shorter_${j} shorts`);
      const minPrice = (await marginlyPool.getBasePrice()).inner / 2n;
      const shortTx = await marginlyPool
        .connect(shorters[j])
        .execute(CallType.Short, shortersBaseDebt[j], 0, minPrice, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        });
      const receipt = await gasReporter.saveGasUsage('short', shortTx);
      const swapPrice =
        receipt.logs?.filter((e) => e instanceof EventLog)?.find((e) => e.eventName == 'Short')?.args?.swapPriceX96 *
        10n ** 12n;
      await addToLogs(
        sut,
        1,
        1,
        shortersNum,
        `Shorter_${j} short ${i}`,
        shortersBaseDebt[j].toString(),
        toHumanString(swapPrice),
        coeffsTable,
        aggregates,
        balances,
        positions
      );
    }

    const quoteDelevCoeffBefore = await marginlyPool.quoteDelevCoeff();
    const baseDebtCoeffBefore = await marginlyPool.baseDebtCoeff();

    logger.info(`  Toggle liquidation`);

    let setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsLowLeverage, { gasLimit: 500_000 });
    await gasReporter.saveGasUsage('setParameters', setParamsTx);

    nextDate += timeDelta;
    await time.setNextBlockTimestamp(nextDate);
    const reinitTx = await marginlyPool
      .connect(treasury)
      .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 });

    await gasReporter.saveGasUsage('reinit', reinitTx);
    await addToLogs(sut, 1, 1, shortersNum, `Liquidation ${i}`, `0`, '0', coeffsTable, aggregates, balances, positions);

    setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsDefaultLeverage, { gasLimit: 500_000 });
    await gasReporter.saveGasUsage('setParameters', setParamsTx);

    const quoteDelevCoeffAfter = await marginlyPool.quoteDelevCoeff();
    const baseDebtCoeffAfter = await marginlyPool.baseDebtCoeff();

    assert(quoteDelevCoeffBefore != quoteDelevCoeffAfter);
    assert(baseDebtCoeffBefore != baseDebtCoeffAfter);
    logger.info(`  Liquidation happened`);

    for (let j = 0; j < itersNum; ++j) {
      logger.info(`  Shorter_${j} closes position`);
      const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
      const closePosTx = await marginlyPool
        .connect(shorters[j])
        .execute(CallType.ClosePosition, 0, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        });
      const receipt = await gasReporter.saveGasUsage('closePosition', closePosTx);
      const swapPrice =
        receipt.logs?.filter((e) => e instanceof EventLog)?.find((e) => e.eventName == 'ClosePosition')?.args
          ?.swapPriceX96 *
        10n ** 12n;
      await addToLogs(
        sut,
        1,
        1,
        shortersNum,
        `Shorter_${j} closePosition ${i}`,
        '0',
        toHumanString(swapPrice),
        coeffsTable,
        aggregates,
        balances,
        positions
      );

      logger.info(`  Shorter_${j} withdraws all`);
      const withdrawQuoteTx = await marginlyPool
        .connect(shorters[j])
        .execute(CallType.WithdrawQuote, parseUnits('200000', 6), 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        });
      await gasReporter.saveGasUsage('withdrawQuote', withdrawQuoteTx);
      await addToLogs(
        sut,
        1,
        1,
        shortersNum,
        `Shorter_${j} withdrawQuote all ${i}`,
        `0`,
        '0',
        coeffsTable,
        aggregates,
        balances,
        positions
      );
    }
  }
  console.table(coeffsTable);
  console.table(aggregates);
  console.table(balances);
  console.table(positions);
}

async function deleveragePrecisionLongCollateral(sut: SystemUnderTest) {
  await deleveragePrecisionLongCollateralReinitInner(sut, false);
}

async function deleveragePrecisionLongReinit(sut: SystemUnderTest) {
  await deleveragePrecisionLongCollateralReinitInner(sut, true);
}

async function deleveragePrecisionLongCollateralReinitInner(sut: SystemUnderTest, withReinits: boolean) {
  const { marginlyPool, usdc, weth, accounts, treasury, gasReporter } = sut;

  const coeffsTable: { [key: string]: {} } = {};
  const aggregates: { [key: string]: {} } = {};
  const balances: { [key: string]: {} } = {};
  const positions: { [key: string]: {} } = {};

  let now = Math.floor(Date.now() / 1000);

  // we set interest rate as 0 for this test so we don't need to calculate accrued rate
  // liquidations are approached via decreasing maxLeverage
  const setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsDefaultLeverage);
  await gasReporter.saveGasUsage('setParameters', setParamsTx);

  const lender = accounts[0];
  const liquidatedLong = accounts[1];
  const shorter = accounts[2];

  const lenderBaseAmount = parseUnits('1', 18); // 1 WETH
  const lenderQuoteAmount = parseUnits('200000', 6); // 200000 USDC;

  await (await usdc.connect(treasury).transfer(lender, lenderQuoteAmount)).wait();
  await (await usdc.connect(lender).approve(marginlyPool, lenderQuoteAmount)).wait();

  await (await weth.connect(treasury).transfer(lender, lenderBaseAmount)).wait();
  await (await weth.connect(lender).approve(marginlyPool, lenderBaseAmount)).wait();

  logger.info(`Lender deposits quote`);
  const depositQuoteTx = await marginlyPool
    .connect(lender)
    .execute(CallType.DepositQuote, lenderQuoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
      gasLimit: 500_000,
    });
  await gasReporter.saveGasUsage('depositQuote', depositQuoteTx);
  await addToLogs(
    sut,
    1,
    1,
    1,
    'Lender depositQuote',
    lenderQuoteAmount.toString(),
    '0',
    coeffsTable,
    aggregates,
    balances,
    positions
  );

  logger.info(`Lender deposits base`);
  const depositBaseTx = await marginlyPool
    .connect(lender)
    .execute(CallType.DepositBase, lenderBaseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
      gasLimit: 500_000,
    });
  await gasReporter.saveGasUsage('depositBase', depositBaseTx);
  await addToLogs(
    sut,
    1,
    1,
    1,
    'Lender depositBase',
    lenderBaseAmount.toString(),
    '0',
    coeffsTable,
    aggregates,
    balances,
    positions
  );

  const timeDelta = 24 * 60 * 60;

  for (let i = 0; i < 10; ++i) {
    logger.info(`iteration ${i + 1}`);
    const longerBaseDeposit = parseUnits('1', 18);
    await (await weth.connect(treasury).transfer(liquidatedLong, longerBaseDeposit)).wait();
    await (await weth.connect(liquidatedLong).approve(marginlyPool, longerBaseDeposit)).wait();

    const longerLongAmount = parseUnits('18', 18);
    logger.info(`  Longer deposits base`);
    const depositBaseTx = await marginlyPool
      .connect(liquidatedLong)
      .execute(CallType.DepositBase, longerBaseDeposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    await gasReporter.saveGasUsage('depositBase', depositBaseTx);
    await addToLogs(
      sut,
      1,
      1,
      1,
      `Longer depositBase ${i}`,
      longerBaseDeposit.toString(),
      '0',
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    logger.info(`  Longer longs`);
    const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
    const longTx = await marginlyPool
      .connect(liquidatedLong)
      .execute(CallType.Long, longerLongAmount, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    let receipt = await gasReporter.saveGasUsage('long', longTx);
    let swapPrice =
      receipt.logs?.filter((e) => e instanceof EventLog)?.find((e) => e.eventName == 'Long')?.args?.swapPriceX96 *
      10n ** 12n;
    await addToLogs(
      sut,
      1,
      1,
      1,
      `Longer long ${i}`,
      longerLongAmount.toString(),
      toHumanString(swapPrice),
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    const shortersQuoteDeposit = parseUnits('20000', 6); // 20000 USDC

    await (await usdc.connect(treasury).transfer(shorter, shortersQuoteDeposit)).wait();
    await (await usdc.connect(shorter).approve(marginlyPool, shortersQuoteDeposit)).wait();
    logger.info(`  Shorter deposits quote`);
    const depositQuoteTx = await marginlyPool
      .connect(shorter)
      .execute(CallType.DepositQuote, shortersQuoteDeposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    await gasReporter.saveGasUsage('depositQuote', depositQuoteTx);
    await addToLogs(
      sut,
      1,
      1,
      1,
      `Shorter depositQuote ${i}`,
      shortersQuoteDeposit.toString(),
      '0',
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    logger.info(`  Shorter shorts`);
    const shorterBaseDebt = parseUnits('13', 18);
    const minPrice = (await marginlyPool.getBasePrice()).inner / 2n;
    const shortTx = await marginlyPool
      .connect(shorter)
      .execute(CallType.Short, shorterBaseDebt, 0, minPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    receipt = await gasReporter.saveGasUsage('short', shortTx);
    swapPrice =
      receipt.logs?.filter((e) => e instanceof EventLog)?.find((e) => e.eventName == 'Short')?.args?.swapPriceX96 *
      10n ** 12n;
    await addToLogs(
      sut,
      1,
      1,
      1,
      `Shorter short ${i}`,
      shorterBaseDebt.toString(),
      toHumanString(swapPrice),
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    const quoteDelevCoeffBefore = await marginlyPool.quoteDelevCoeff();
    const baseDebtCoeffBefore = await marginlyPool.baseDebtCoeff();

    logger.info(`  Toggle liquidation`);

    let setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsLowLeverage, { gasLimit: 500_000 });
    await gasReporter.saveGasUsage('setParameters', setParamsTx);

    now += timeDelta;
    await time.setNextBlockTimestamp(now);
    const reinitTx = await marginlyPool
      .connect(treasury)
      .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 });
    await gasReporter.saveGasUsage('deleverage reinit', reinitTx);
    await addToLogs(sut, 1, 1, 1, `Liquidation ${i}`, `0`, '0', coeffsTable, aggregates, balances, positions);

    setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsDefaultLeverage, { gasLimit: 500_000 });
    await gasReporter.saveGasUsage('setParameters', setParamsTx);

    const quoteDelevCoeffAfter = await marginlyPool.quoteDelevCoeff();
    const baseDebtCoeffAfter = await marginlyPool.baseDebtCoeff();

    assert(quoteDelevCoeffBefore != quoteDelevCoeffAfter);
    assert(baseDebtCoeffBefore != baseDebtCoeffAfter);
    logger.info(`  Liquidation happened`);

    if (withReinits) {
      let setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsWithIr, { gasLimit: 500_000 });
      await gasReporter.saveGasUsage('setParameters', setParamsTx);

      for (let j = 0; j < 12; ++j) {
        now += 30 * 24 * 60 * 60;
        await time.setNextBlockTimestamp(now);
        const reinitTx = await marginlyPool
          .connect(treasury)
          .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 });
        await gasReporter.saveGasUsage('reinit', reinitTx);
        await addToLogs(sut, 1, 1, 1, `Reinit ${i}, ${j}`, `0`, '0', coeffsTable, aggregates, balances, positions);
      }

      setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsDefaultLeverage, { gasLimit: 500_000 });
      await gasReporter.saveGasUsage('setParameters', setParamsTx);
    }

    logger.info(`  Shorter closes position`);
    const closePosMaxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
    const closePosTx = await marginlyPool
      .connect(shorter)
      .execute(CallType.ClosePosition, 0, 0, closePosMaxPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    receipt = await gasReporter.saveGasUsage('closePosition', closePosTx);
    swapPrice =
      receipt.logs?.filter((e) => e instanceof EventLog)?.find((e) => e.eventName == 'ClosePosition')?.args
        ?.swapPriceX96 *
      10n ** 12n;
    await addToLogs(
      sut,
      1,
      1,
      1,
      `Shorter closePosition ${i}`,
      '0',
      toHumanString(swapPrice),
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    logger.info(`  Shorter withdraws all`);
    const withdrawQuoteTx = await marginlyPool
      .connect(shorter)
      .execute(CallType.WithdrawQuote, parseUnits('200000', 6), 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    await gasReporter.saveGasUsage('withdrawQuote', withdrawQuoteTx);
    await addToLogs(
      sut,
      1,
      1,
      1,
      `Shorter withdrawQuote all ${i}`,
      `0`,
      '0',
      coeffsTable,
      aggregates,
      balances,
      positions
    );
  }
  console.table(coeffsTable);
  console.table(aggregates);
  console.table(balances);
  console.table(positions);
}

async function deleveragePrecisionShort(sut: SystemUnderTest) {
  const { marginlyPool, usdc, weth, accounts, treasury, gasReporter } = sut;

  const coeffsTable: { [key: string]: {} } = {};
  const aggregates: { [key: string]: {} } = {};
  const balances: { [key: string]: {} } = {};
  const positions: { [key: string]: {} } = {};

  // we set interest rate as 0 for this test so we don't need to calculate accrued rate
  // liquidations are approached via decreasing maxLeverage
  const setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsDefaultLeverage);
  await gasReporter.saveGasUsage('setParameters', setParamsTx);

  const lender = accounts[0];
  const longersNum = 5;
  const longers = accounts.slice(1, 1 + longersNum);
  const liquidatedShort = accounts[1 + longersNum];

  // 20 WETH in total
  const longersLongAmount = [
    parseUnits('2', 18),
    parseUnits('3', 18),
    parseUnits('4', 18),
    parseUnits('11', 18),
    parseUnits('20', 18),
  ];

  const price = (await marginlyPool.getBasePrice()).inner;

  const lenderBaseAmount = parseUnits('100', 18); // 100 WETH
  const lenderQuoteAmount = (parseUnits('1', 18) * price) / FP96.one; // USDC equivalent of 1 WETH

  await (await usdc.connect(treasury).transfer(lender, lenderQuoteAmount)).wait();
  await (await usdc.connect(lender).approve(marginlyPool, lenderQuoteAmount)).wait();

  await (await weth.connect(treasury).transfer(lender, lenderBaseAmount)).wait();
  await (await weth.connect(lender).approve(marginlyPool, lenderBaseAmount)).wait();

  logger.info(`Lender deposits quote`);
  const depositQuoteTx = await marginlyPool
    .connect(lender)
    .execute(CallType.DepositQuote, lenderQuoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
      gasLimit: 500_000,
    });
  await gasReporter.saveGasUsage('depositQuote', depositQuoteTx);
  await addToLogs(
    sut,
    1,
    longersNum,
    1,
    'Lender depositQuote 1',
    lenderQuoteAmount.toString(),
    '0',
    coeffsTable,
    aggregates,
    balances,
    positions
  );

  logger.info(`Lender deposits base`);
  const depositBaseTx = await marginlyPool
    .connect(lender)
    .execute(CallType.DepositBase, lenderBaseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
      gasLimit: 500_000,
    });
  await gasReporter.saveGasUsage('depositBase', depositBaseTx);
  await addToLogs(
    sut,
    1,
    longersNum,
    1,
    'Lender depositBase 1',
    lenderBaseAmount.toString(),
    '0',
    coeffsTable,
    aggregates,
    balances,
    positions
  );

  let nextDate = Math.floor(Date.now() / 1000);
  const timeDelta = 24 * 60 * 60;

  for (let i = 0; i < 10; ++i) {
    if (i == 5) {
      await (await usdc.connect(treasury).transfer(lender, lenderQuoteAmount)).wait();
      await (await usdc.connect(lender).approve(marginlyPool, lenderQuoteAmount)).wait();

      await (await weth.connect(treasury).transfer(lender, lenderBaseAmount)).wait();
      await (await weth.connect(lender).approve(marginlyPool, lenderBaseAmount)).wait();

      logger.info(`Lender deposits quote`);
      const depositQuoteTx = await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, lenderQuoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        });
      await gasReporter.saveGasUsage('depositQuote', depositQuoteTx);
      await addToLogs(
        sut,
        1,
        longersNum,
        1,
        'Lender depositQuote 2',
        lenderQuoteAmount.toString(),
        '0',
        coeffsTable,
        aggregates,
        balances,
        positions
      );

      logger.info(`Lender deposits base`);
      const depositBaseTx = await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, lenderBaseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        });
      await gasReporter.saveGasUsage('depositBase', depositBaseTx);
      await addToLogs(
        sut,
        1,
        longersNum,
        1,
        'Lender depositBase 2',
        lenderBaseAmount.toString(),
        '0',
        coeffsTable,
        aggregates,
        balances,
        positions
      );
    }

    logger.info(`iteration ${i + 1}`);
    let price = (await marginlyPool.getBasePrice()).inner;
    const shorterQuoteDeposit =
      i < 5 ? (parseUnits('1', 18) * price) / FP96.one : (parseUnits('2', 18) * price) / FP96.one;
    await (await usdc.connect(treasury).transfer(liquidatedShort, shorterQuoteDeposit)).wait();
    await (await usdc.connect(liquidatedShort).approve(marginlyPool, shorterQuoteDeposit)).wait();

    logger.info(`  Shorter deposits quote`);
    const shorterShortAmount = i < 5 ? parseUnits('18', 18) : parseUnits('36', 18);
    const depositQuoteTx = await marginlyPool
      .connect(liquidatedShort)
      .execute(CallType.DepositQuote, shorterQuoteDeposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    await gasReporter.saveGasUsage('depositQuote', depositQuoteTx);
    await addToLogs(
      sut,
      1,
      longersNum,
      1,
      `  Shorter depositQuote ${i}`,
      shorterQuoteDeposit.toString(),
      '0',
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    logger.info(`  Shorter shorts`);
    const minPrice = (await marginlyPool.getBasePrice()).inner / 2n;
    const shortTx = await marginlyPool
      .connect(liquidatedShort)
      .execute(CallType.Short, shorterShortAmount, 0, minPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    const receipt = await gasReporter.saveGasUsage('short', shortTx);
    const swapPrice =
      receipt.logs?.filter((e) => e instanceof EventLog)?.find((e) => e.eventName == 'Short')?.args?.swapPriceX96 *
      10n ** 12n;
    await addToLogs(
      sut,
      1,
      longersNum,
      1,
      `Shorter short ${i}`,
      shorterShortAmount.toString(),
      toHumanString(swapPrice),
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    const longersBaseDeposit = parseUnits('10', 18); // 10 WETH

    const itersNum = i < 5 ? longersNum - 1 : longersNum;
    for (let j = 0; j < itersNum; ++j) {
      await (await weth.connect(treasury).transfer(longers[j], longersBaseDeposit)).wait();
      await (await weth.connect(longers[j]).approve(marginlyPool, longersBaseDeposit)).wait();
      logger.info(`  Longer_${j} deposits base`);
      const depositBaseTx = await marginlyPool
        .connect(longers[j])
        .execute(CallType.DepositBase, longersBaseDeposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        });
      await gasReporter.saveGasUsage('depositBase', depositBaseTx);
      await addToLogs(
        sut,
        1,
        longersNum,
        1,
        `Longer_${j} depositBase ${i}`,
        longersBaseDeposit.toString(),
        '0',
        coeffsTable,
        aggregates,
        balances,
        positions
      );

      logger.info(`  Longer_${j} longs`);
      const price = (await marginlyPool.getBasePrice()).inner;

      const amount =
        j + 1 != itersNum
          ? longersLongAmount[j]
          : ((((await usdc.balanceOf(marginlyPool)) * FP96.one) / price) * 999n) / 1000n;
      const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
      const longTx = await marginlyPool
        .connect(longers[j])
        .execute(CallType.Long, amount, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 });
      const receipt = await gasReporter.saveGasUsage('long', longTx);
      const swapPrice =
        receipt.logs?.filter((e) => e instanceof EventLog)?.find((e) => e.eventName == 'Long')?.args?.swapPriceX96 *
        10n ** 12n;
      await addToLogs(
        sut,
        1,
        longersNum,
        1,
        `Longer_${j} long ${i}`,
        amount.toString(),
        toHumanString(swapPrice),
        coeffsTable,
        aggregates,
        balances,
        positions
      );
    }

    const baseDelevCoeffBefore = await marginlyPool.baseDelevCoeff();
    const quoteDebtCoeffBefore = await marginlyPool.quoteDebtCoeff();

    logger.info(`  Toggle liquidation`);

    let setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsLowLeverage, { gasLimit: 500_000 });
    await gasReporter.saveGasUsage('setParameters', setParamsTx);

    nextDate += timeDelta;
    await time.setNextBlockTimestamp(nextDate);
    const reinitTx = await marginlyPool
      .connect(treasury)
      .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 });
    await gasReporter.saveGasUsage('reinit', reinitTx);
    await addToLogs(sut, 1, longersNum, 1, `Liquidation ${i}`, '0', '0', coeffsTable, aggregates, balances, positions);

    setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsDefaultLeverage, { gasLimit: 500_000 });
    await gasReporter.saveGasUsage('setParameters', setParamsTx);

    const baseDelevCoeffAfter = await marginlyPool.baseDelevCoeff();
    const quoteDebtCoeffAfter = await marginlyPool.quoteDebtCoeff();

    assert(baseDelevCoeffBefore != baseDelevCoeffAfter);
    assert(quoteDebtCoeffBefore != quoteDebtCoeffAfter);
    logger.info(`  Liquidation happened`);

    for (let j = 0; j < itersNum; ++j) {
      logger.info(`  Longer_${j} closes position`);
      const minPrice = (await marginlyPool.getBasePrice()).inner / 2n;
      const closePosTx = await marginlyPool
        .connect(longers[j])
        .execute(CallType.ClosePosition, 0, 0, minPrice, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        });
      const receipt = await gasReporter.saveGasUsage('closePosition', closePosTx);
      const swapPrice =
        receipt.logs?.filter((e) => e instanceof EventLog)?.find((e) => e.eventName == 'ClosePosition')?.args
          ?.swapPriceX96 *
        10n ** 12n;
      await addToLogs(
        sut,
        1,
        longersNum,
        1,
        `Longer_${j} closePosition ${i}`,
        '0',
        toHumanString(swapPrice),
        coeffsTable,
        aggregates,
        balances,
        positions
      );

      logger.info(`  Longer_${j} withdraws all`);
      const withdrawBaseTx = await marginlyPool
        .connect(longers[j])
        .execute(CallType.WithdrawBase, parseUnits('200000', 18), 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 500_000,
        });
      await gasReporter.saveGasUsage('withdrawBase', withdrawBaseTx);
      await addToLogs(
        sut,
        1,
        longersNum,
        1,
        `Longer_${j} withdrawQuote all ${i}`,
        `0`,
        '0',
        coeffsTable,
        aggregates,
        balances,
        positions
      );
    }
  }
  console.table(coeffsTable);
  console.table(aggregates);
  console.table(balances);
  console.table(positions);
}

async function deleveragePrecisionShortCollateral(sut: SystemUnderTest) {
  await deleveragePrecisionShortCollateralReinitInner(sut, false);
}

async function deleveragePrecisionShortReinit(sut: SystemUnderTest) {
  await deleveragePrecisionShortCollateralReinitInner(sut, true);
}

async function deleveragePrecisionShortCollateralReinitInner(sut: SystemUnderTest, withReinits: boolean) {
  const { marginlyPool, usdc, weth, accounts, treasury, gasReporter } = sut;

  const coeffsTable: { [key: string]: {} } = {};
  const aggregates: { [key: string]: {} } = {};
  const balances: { [key: string]: {} } = {};
  const positions: { [key: string]: {} } = {};

  let now = Math.floor(Date.now() / 1000);

  // we set interest rate as 0 for this test so we don't need to calculate accrued rate
  // liquidations are approached via decreasing maxLeverage
  const setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsDefaultLeverage);
  await gasReporter.saveGasUsage('setParameters', setParamsTx);

  const lender = accounts[0];
  const longer = accounts[1];
  const liquidatedShort = accounts[2];

  const price = (await marginlyPool.getBasePrice()).inner;

  const lenderBaseAmount = parseUnits('18', 18); // 100 WETH
  const lenderQuoteAmount = (parseUnits('1', 18) * price) / FP96.one; // USDC equivalent of 1 WETH

  await (await usdc.connect(treasury).transfer(lender, lenderQuoteAmount)).wait();
  await (await usdc.connect(lender).approve(marginlyPool, lenderQuoteAmount)).wait();

  await (await weth.connect(treasury).transfer(lender, lenderBaseAmount)).wait();
  await (await weth.connect(lender).approve(marginlyPool, lenderBaseAmount)).wait();

  logger.info(`Lender deposits quote`);
  const depositQuoteTx = await marginlyPool
    .connect(lender)
    .execute(CallType.DepositQuote, lenderQuoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
      gasLimit: 500_000,
    });
  await gasReporter.saveGasUsage('depositQuote', depositQuoteTx);
  await addToLogs(
    sut,
    1,
    1,
    1,
    'Lender depositQuote 1',
    lenderQuoteAmount.toString(),
    '0',
    coeffsTable,
    aggregates,
    balances,
    positions
  );

  logger.info(`Lender deposits base`);
  const depositBaseTx = await marginlyPool
    .connect(lender)
    .execute(CallType.DepositBase, lenderBaseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
      gasLimit: 500_000,
    });
  await gasReporter.saveGasUsage('depositBase', depositBaseTx);
  await addToLogs(
    sut,
    1,
    1,
    1,
    'Lender depositBase 1',
    lenderBaseAmount.toString(),
    '0',
    coeffsTable,
    aggregates,
    balances,
    positions
  );

  const timeDelta = 24 * 60 * 60;

  for (let i = 0; i < 10; ++i) {
    logger.info(`iteration ${i + 1}`);
    let price = (await marginlyPool.getBasePrice()).inner;
    const shorterQuoteDeposit = (parseUnits('1', 18) * price) / FP96.one;
    await (await usdc.connect(treasury).transfer(liquidatedShort, shorterQuoteDeposit)).wait();
    await (await usdc.connect(liquidatedShort).approve(marginlyPool, shorterQuoteDeposit)).wait();

    logger.info(`  Shorter deposits quote`);
    const shorterShortAmount = parseUnits('18', 18);
    const depositQuoteTx = await marginlyPool
      .connect(liquidatedShort)
      .execute(CallType.DepositQuote, shorterQuoteDeposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    await gasReporter.saveGasUsage('depositQuote', depositQuoteTx);
    await addToLogs(
      sut,
      1,
      1,
      1,
      `  Shorter depositQuote ${i}`,
      shorterQuoteDeposit.toString(),
      '0',
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    logger.info(`  Shorter shorts`);
    const minPrice = (await marginlyPool.getBasePrice()).inner / 2n;
    const shortTx = await marginlyPool
      .connect(liquidatedShort)
      .execute(CallType.Short, shorterShortAmount, 0, minPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    let receipt = await gasReporter.saveGasUsage('short', shortTx);
    let swapPrice =
      receipt.logs?.filter((e) => e instanceof EventLog)?.find((e) => e.eventName == 'Short')?.args?.swapPriceX96 *
      10n ** 12n;
    await addToLogs(
      sut,
      1,
      1,
      1,
      `Shorter short ${i}`,
      shorterShortAmount.toString(),
      toHumanString(swapPrice),
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    const longersBaseDeposit = parseUnits('1', 18); // 11 WETH

    await (await weth.connect(treasury).transfer(longer, longersBaseDeposit)).wait();
    await (await weth.connect(longer).approve(marginlyPool, longersBaseDeposit)).wait();
    logger.info(`  Longer deposits base`);
    const depositBaseTx = await marginlyPool
      .connect(longer)
      .execute(CallType.DepositBase, longersBaseDeposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    await gasReporter.saveGasUsage('depositBase', depositBaseTx);
    await addToLogs(
      sut,
      1,
      1,
      1,
      `Longer depositBase ${i}`,
      longersBaseDeposit.toString(),
      '0',
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    logger.info(`  Longer longs`);
    price = (await marginlyPool.getBasePrice()).inner;

    const longAmount = parseUnits('13', 18);
    const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
    const longTx = await marginlyPool
      .connect(longer)
      .execute(CallType.Long, longAmount, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    receipt = await gasReporter.saveGasUsage('long', longTx);
    swapPrice =
      receipt.logs?.filter((e) => e instanceof EventLog)?.find((e) => e.eventName == 'Long')?.args?.swapPriceX96 *
      10n ** 12n;
    await addToLogs(
      sut,
      1,
      1,
      1,
      `Longer long ${i}`,
      longAmount.toString(),
      toHumanString(swapPrice),
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    const baseDelevCoeffBefore = await marginlyPool.baseDelevCoeff();
    const quoteDebtCoeffBefore = await marginlyPool.quoteDebtCoeff();

    logger.info(`  Toggle liquidation`);

    let setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsLowLeverage, { gasLimit: 500_000 });
    await gasReporter.saveGasUsage('setParameters', setParamsTx);

    now += timeDelta;
    await time.setNextBlockTimestamp(now);
    const reinitTx = await marginlyPool
      .connect(treasury)
      .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 });
    await gasReporter.saveGasUsage('deleverage reinit', reinitTx);
    await addToLogs(sut, 1, 1, 1, `Liquidation ${i}`, '0', '0', coeffsTable, aggregates, balances, positions);

    setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsDefaultLeverage, { gasLimit: 500_000 });
    await gasReporter.saveGasUsage('setParameters', setParamsTx);

    const baseDelevCoeffAfter = await marginlyPool.baseDelevCoeff();
    const quoteDebtCoeffAfter = await marginlyPool.quoteDebtCoeff();

    assert(baseDelevCoeffBefore != baseDelevCoeffAfter);
    assert(quoteDebtCoeffBefore != quoteDebtCoeffAfter);
    logger.info(`  Liquidation happened`);

    if (withReinits) {
      let setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsWithIr, { gasLimit: 500_000 });
      await gasReporter.saveGasUsage('setParameters', setParamsTx);

      for (let j = 0; j < 12; ++j) {
        now += 30 * 24 * 60 * 60;
        await time.setNextBlockTimestamp(now);
        const reinitTx = await marginlyPool
          .connect(treasury)
          .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 });
        await gasReporter.saveGasUsage('reinit', reinitTx);
        await addToLogs(sut, 1, 1, 1, `Reinit ${i}, ${j}`, `0`, '0', coeffsTable, aggregates, balances, positions);
      }

      setParamsTx = await marginlyPool.connect(treasury).setParameters(paramsDefaultLeverage, { gasLimit: 500_000 });
      await gasReporter.saveGasUsage('setParameters', setParamsTx);
    }

    logger.info(`  Longer closes position`);
    const closeMinPrice = (await marginlyPool.getBasePrice()).inner / 2n;
    const closePosTx = await marginlyPool
      .connect(longer)
      .execute(CallType.ClosePosition, 0, 0, closeMinPrice, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    receipt = await gasReporter.saveGasUsage('closePosition', closePosTx);
    swapPrice =
      receipt.logs?.filter((e) => e instanceof EventLog)?.find((e) => e.eventName == 'ClosePosition')?.args
        ?.swapPriceX96 *
      10n ** 12n;
    await addToLogs(
      sut,
      1,
      1,
      1,
      `Longer closePosition ${i}`,
      '0',
      toHumanString(swapPrice),
      coeffsTable,
      aggregates,
      balances,
      positions
    );

    logger.info(`  Longer withdraws all`);
    const withdrawBaseTx = await marginlyPool
      .connect(longer)
      .execute(CallType.WithdrawBase, parseUnits('200000', 18), 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
        gasLimit: 500_000,
      });
    await gasReporter.saveGasUsage('withdrawBase', withdrawBaseTx);
    await addToLogs(
      sut,
      1,
      1,
      1,
      `Longer withdrawQuote all ${i}`,
      `0`,
      '0',
      coeffsTable,
      aggregates,
      balances,
      positions
    );
  }
  console.table(coeffsTable);
  console.table(aggregates);
  console.table(balances);
  console.table(positions);
}

async function addToLogs(
  sut: SystemUnderTest,
  lendersNum: number,
  longersNum: number,
  shortersNum: number,
  transactionName: string,
  amount: string,
  swapPrice: string,
  coeffsTable: { [key: string]: {} },
  aggregates: { [key: string]: {} },
  balances: { [key: string]: {} },
  positions: { [key: string]: {} }
) {
  const { marginlyPool, usdc, weth, accounts, marginlyFactory } = sut;
  const lenders = accounts.slice(0, lendersNum);
  const longers = accounts.slice(lendersNum, lendersNum + longersNum);
  const shorters = accounts.slice(lendersNum + longersNum, lendersNum + longersNum + shortersNum);

  const quoteDelevCoeff = await marginlyPool.quoteDelevCoeff();
  const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
  const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();

  const baseDelevCoeff = await marginlyPool.baseDelevCoeff();
  const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
  const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();

  coeffsTable[transactionName] = {
    baseCollateralCoeff: baseCollateralCoeff.toString(),
    baseCollateralCoeffHuman: toHumanString(baseCollateralCoeff),
    baseDelevCoeff: baseDelevCoeff.toString(),
    baseDelevCoeffHuman: toHumanString(baseDelevCoeff),
    baseDebtCoeff: baseDebtCoeff.toString(),
    baseDebtCoeffHuman: toHumanString(baseDebtCoeff),
    quoteCollateralCoeff: quoteCollateralCoeff.toString(),
    quoteCollateralCoeffHuman: toHumanString(quoteCollateralCoeff),
    quoteDelevCoeff: quoteDelevCoeff.toString(),
    quoteDelevCoeffHuman: toHumanString(quoteDelevCoeff),
    quoteDebtCoeff: quoteDebtCoeff.toString(),
    quoteDebtCoeffHuman: toHumanString(quoteDebtCoeff),
  };

  const discountedBaseCollateral = await marginlyPool.discountedBaseCollateral();
  const discountedQuoteDebt = await marginlyPool.discountedQuoteDebt();
  const realBaseCollateral =
    (baseCollateralCoeff * discountedBaseCollateral) / FP96.one - (baseDelevCoeff * discountedQuoteDebt) / FP96.one;
  const realQuoteDebt = (quoteDebtCoeff * discountedQuoteDebt) / FP96.one;

  const discountedBaseDebt = await marginlyPool.discountedBaseDebt();
  const discountedQuoteCollateral = await marginlyPool.discountedQuoteCollateral();
  const realQuoteCollateral =
    (quoteCollateralCoeff * discountedQuoteCollateral) / FP96.one - (quoteDelevCoeff * discountedBaseDebt) / FP96.one;
  const realBaseDebt = (baseDebtCoeff * discountedBaseDebt) / FP96.one;

  aggregates[transactionName] = {
    discountedBaseCollateral: discountedBaseCollateral.toString(),
    realBaseCollateral: realBaseCollateral.toString(),
    discountedBaseDebt: discountedBaseDebt.toString(),
    realBaseDebt: realBaseDebt.toString(),
    discountedQuoteCollateral: discountedQuoteCollateral.toString(),
    realQuoteCollateral: realQuoteCollateral.toString(),
    discountedQuoteDebt: discountedQuoteDebt.toString(),
    realQuoteDebt: realQuoteDebt.toString(),
  };

  const actualWethBalance = formatUnits(await weth.balanceOf(marginlyPool), 18);
  const actualUsdcBalance = formatUnits(await usdc.balanceOf(marginlyPool), 6);
  const calculatedWethBalance = formatUnits(realBaseCollateral - realBaseDebt, 18);
  const calculatedUsdcBalance = formatUnits(realQuoteCollateral - realQuoteDebt, 6);

  balances[transactionName] = {
    calculatedWethBalance: calculatedWethBalance,
    actualWethBalance: actualWethBalance,
    calculatedUsdcBalance: calculatedUsdcBalance,
    actualUsdcBalance: actualUsdcBalance,
  };

  const positionsInfo = new Map();

  {
    const techPosition = await marginlyPool.positions(await marginlyFactory.techPositionOwner());
    const discountedBaseCollateral = techPosition.discountedBaseAmount;
    const discountedQuoteCollateral = techPosition.discountedQuoteAmount;
    const realBaseCollateral = (baseCollateralCoeff * discountedBaseCollateral) / FP96.one;
    const realQuoteCollateral = (quoteCollateralCoeff * discountedQuoteCollateral) / FP96.one;

    positionsInfo.set(`tech position type`, techPosition._type.toString());
    positionsInfo.set(`tech position discountedBaseAmount`, discountedBaseCollateral.toString());
    positionsInfo.set(`tech position realBaseAmount`, realBaseCollateral.toString());
    positionsInfo.set(`tech position discountedQuoteAmount`, discountedQuoteCollateral.toString());
    positionsInfo.set(`tech position realQuoteAmount`, realQuoteCollateral.toString());
  }

  for (let i = 0; i < lendersNum; ++i) {
    const position = await marginlyPool.positions(lenders[i].address);
    const discountedBaseCollateral = position.discountedBaseAmount;
    const discountedQuoteCollateral = position.discountedQuoteAmount;
    const realBaseCollateral = (baseCollateralCoeff * discountedBaseCollateral) / FP96.one;
    const realQuoteCollateral = (quoteCollateralCoeff * discountedQuoteCollateral) / FP96.one;

    positionsInfo.set(`lender_${i} type`, position._type.toString());
    positionsInfo.set(`lender_${i} discountedBaseAmount`, discountedBaseCollateral.toString());
    positionsInfo.set(`lender_${i} realBaseAmount`, realBaseCollateral.toString());
    positionsInfo.set(`lender_${i} discountedQuoteAmount`, discountedQuoteCollateral.toString());
    positionsInfo.set(`lender_${i} realQuoteAmount`, realQuoteCollateral.toString());
  }

  for (let i = 0; i < longersNum; ++i) {
    const position = await marginlyPool.positions(longers[i].address);
    const discountedBaseCollateral = position.discountedBaseAmount;
    const discountedQuoteDebt = position.discountedQuoteAmount;
    const realBaseCollateral =
      (baseCollateralCoeff * discountedBaseCollateral) / FP96.one - (baseDelevCoeff * discountedQuoteDebt) / FP96.one;
    const realQuoteDebt = (quoteDebtCoeff * discountedQuoteDebt) / FP96.one;

    positionsInfo.set(`longer_${i} type`, position._type.toString());
    positionsInfo.set(`longer_${i} discountedBaseAmount`, discountedBaseCollateral.toString());
    positionsInfo.set(`longer_${i} realBaseAmount`, realBaseCollateral.toString());
    positionsInfo.set(`longer_${i} discountedQuoteAmount`, discountedQuoteDebt.toString());
    positionsInfo.set(`longer_${i} realQuoteAmount`, realQuoteDebt.toString());
  }

  for (let i = 0; i < shortersNum; ++i) {
    const position = await marginlyPool.positions(shorters[i].address);
    const discountedBaseDebt = position.discountedBaseAmount;
    const discountedQuoteCollateral = position.discountedQuoteAmount;
    const realQuoteCollateral =
      (quoteCollateralCoeff * discountedQuoteCollateral) / FP96.one - (quoteDelevCoeff * discountedBaseDebt) / FP96.one;
    const realBaseDebt = (baseDebtCoeff * discountedBaseDebt) / FP96.one;

    positionsInfo.set(`shorter_${i} type`, position._type.toString());
    positionsInfo.set(`shorter_${i} discountedBaseAmount`, discountedBaseDebt.toString());
    positionsInfo.set(`shorter_${i} realBaseAmount`, realBaseDebt.toString());
    positionsInfo.set(`shorter_${i} discountedQuoteAmount`, discountedQuoteCollateral.toString());
    positionsInfo.set(`shorter_${i} realQuoteAmount`, realQuoteCollateral.toString());
  }

  positionsInfo.set(`amount`, amount);
  positionsInfo.set(`swapPrice`, swapPrice);

  positions[transactionName] = Object.fromEntries(positionsInfo);
}
