import { SystemUnderTest, TechnicalPositionOwner } from '.';
import { logger } from '../utils/logger';
import { formatUnits, parseUnits, ZeroAddress } from 'ethers';
import { FP96, toHumanString } from '../utils/fixed-point';
import {
  CallType,
  decodeSwapEvent,
  getLongSortKeyX48,
  getShortSortKeyX48,
  uniswapV3Swapdata,
  WHOLE_ONE,
} from '../utils/chain-ops';

async function prepareAccounts(sut: SystemUnderTest) {
  const { treasury, usdc, weth, accounts } = sut;
  logger.debug(`Depositing accounts`);
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    await Promise.all([
      (await usdc.connect(treasury).transfer(account, parseUnits('200000000', 6), { gasLimit: 80_000 })).wait(),
      (await weth.connect(treasury).transfer(account, parseUnits('200000000', 18), { gasLimit: 80_000 })).wait(),
    ]);
    if (i % 100 == 0) {
      logger.debug(`  ${i + 1} of ${accounts.length} completed`);
    }
  }
  logger.debug(`  Depositing accounts completed`);
}

export async function longAndShort(sut: SystemUnderTest) {
  logger.info(`Starting long_and_short test suite`);
  await prepareAccounts(sut);
  logger.info(`Prepared accounts`);
  const { marginlyPool, usdc, weth, accounts, treasury, provider, uniswap, gasReporter } = sut;

  const params = await marginlyPool.params();
  await marginlyPool.connect(treasury).setParameters({ ...params });

  const interestRateX96 = ((await marginlyPool.params()).interestRate * FP96.one) / WHOLE_ONE;
  logger.info(`interestRate: ${toHumanString(interestRateX96)}`);

  const longersNumber = 5;
  const shortersNumber = 10;
  const longers = accounts.slice(0, longersNumber);
  const shorters = accounts.slice(longersNumber, longersNumber + shortersNumber);

  const basePrice = (await marginlyPool.getBasePrice()).inner;
  const swapFeeX96 = ((await marginlyPool.params()).swapFee * FP96.one) / WHOLE_ONE;
  const swapMultiplierShort = FP96.one - swapFeeX96;
  const swapMultiplierLong = FP96.one + swapFeeX96;

  const longersAmounts = [];
  const shortersAmounts = [];

  const initBaseCollateral = 20n * 10n ** 18n;
  logger.info(`initBaseCollateral ${formatUnits(initBaseCollateral, 18)}`);
  const initQuoteCollateral = (20n * 10n ** 18n * basePrice) / FP96.one;
  logger.info(`initQuoteCollateral ${formatUnits(initQuoteCollateral, 6)}`);

  for (const longer of longers) {
    logger.info(`longer: ${longer.address}`);
    logger.info(`longer depositBase call`);
    await (await weth.connect(longer).approve(marginlyPool, initBaseCollateral)).wait();
    await gasReporter.saveGasUsage(
      'depositBase',
      marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, initBaseCollateral, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 1_000_000,
        })
    );
    logger.info(`longer depositBase call success`);
    longersAmounts.push([initBaseCollateral, 0n]);
  }

  for (const shorter of shorters) {
    logger.info(`shorter: ${shorter.address}`);
    logger.info(`shorter depositQuote call`);
    await (await usdc.connect(shorter).approve(marginlyPool, initQuoteCollateral)).wait();
    await gasReporter.saveGasUsage(
      'depositQuote',
      marginlyPool
        .connect(shorter)
        .execute(CallType.DepositQuote, initQuoteCollateral, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 1_000_000,
        })
    );
    logger.info(`shorter depositQuote call success`);
    shortersAmounts.push([0n, initQuoteCollateral]);
  }

  logger.info(`Shift date for 1 year`);
  const numOfSeconds = 365 * 24 * 60 * 60;
  await provider.mineAtTimestamp(Number(await marginlyPool.lastReinitTimestampSeconds()) + numOfSeconds);

  await gasReporter.saveGasUsage(
    'reinit',
    marginlyPool
      .connect(treasury)
      .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 })
  );

  for (let i = 0; i < longersNumber; ++i) {
    logger.info(`Iteration ${i + 1} of ${longersNumber}`);
    const longer = longers[i];
    logger.info(`longer: ${longer.address}`);
    const longAmount = 4n * 10n ** 18n + 1n * 10n ** 16n * BigInt(i); // 4 WETH + 0.01WETH * i
    logger.info(`longAmount: ${formatUnits(longAmount, 18)} WETH`);

    logger.info(`long call`);
    const maxPrice = (await marginlyPool.getBasePrice()).inner * 2n;
    const txReceipt = await gasReporter.saveGasUsage(
      'long',
      marginlyPool
        .connect(longer)
        .execute(CallType.Long, longAmount, 0, maxPrice, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 1_000_000,
        })
    );
    logger.info(`long call success`);
    const swapEvent = decodeSwapEvent(txReceipt, uniswap.address);
    const swapAmount = swapEvent.amount0.abs();
    logger.warn(`swap amount ${formatUnits(swapAmount, 6)}`);
    longersAmounts[i][0] = longersAmounts[i][0] + longAmount;
    longersAmounts[i][1] = longersAmounts[i][1] + (swapAmount * swapMultiplierLong) / FP96.one;

    const position = await marginlyPool.positions(longer.address);
    const discountedBaseAmount = position.discountedBaseAmount;
    const discountedQuoteAmount = position.discountedQuoteAmount;
    logger.info(` discountedBaseAmount  ${formatUnits(discountedBaseAmount, 18)}`);
    logger.info(` discountedQuoteAmount ${formatUnits(discountedQuoteAmount, 6)}`);
    logger.info(` collateral ${formatUnits(longersAmounts[i][0], 18)} WETH`);
    logger.info(` debt ${formatUnits(longersAmounts[i][1], 6)} USDC`);
  }

  for (let i = 0; i < shortersNumber; ++i) {
    logger.info(`Iteration ${i + 1} of ${longersNumber}`);
    const shorter = shorters[i];
    logger.info(`shorter: ${shorter.address}`);
    const shortAmount = 4n * 10n ** 18n + 1n * 10n ** 16n * BigInt(i); // 5 WETH + 0.01WETH * i
    logger.info(`shortAmount: ${formatUnits(shortAmount, 18)} WETH`);

    logger.info(`short call`);
    const minPrice = (await marginlyPool.getBasePrice()).inner / 2n;
    const txReceipt = await gasReporter.saveGasUsage(
      'short',
      await marginlyPool
        .connect(shorter)
        .execute(CallType.Short, shortAmount, 0, minPrice, false, ZeroAddress, uniswapV3Swapdata(), {
          gasLimit: 1_000_000,
        })
    );
    logger.info(`short call success`);
    const swapEvent = decodeSwapEvent(txReceipt, uniswap.address);
    const swapAmount = swapEvent.amount0.abs();
    logger.warn(`swap amount: ${formatUnits(swapAmount, 6)}`);
    shortersAmounts[i][0] = shortersAmounts[i][0] + shortAmount;
    shortersAmounts[i][1] = shortersAmounts[i][1] + (swapAmount * swapMultiplierShort) / FP96.one;

    const position = await marginlyPool.positions(shorter.address);
    const discountedBaseAmount = position.discountedBaseAmount;
    const discountedQuoteAmount = position.discountedQuoteAmount;
    logger.info(` discountedBaseAmount  ${formatUnits(discountedBaseAmount, 18)}`);
    logger.info(` discountedQuoteAmount ${formatUnits(discountedQuoteAmount, 6)}`);
    logger.info(` collateral ${formatUnits(shortersAmounts[i][1], 6)} USDC`);
    logger.info(` debt ${formatUnits(shortersAmounts[i][0], 18)} WETH`);
  }

  logger.info(`Shift date for 1 year`);
  logger.warn(`leverageLong: ${toHumanString((await marginlyPool.systemLeverage()).longX96)}`);
  await provider.mineAtTimestamp(Number(await marginlyPool.lastReinitTimestampSeconds()) + numOfSeconds);
  const txReceipt = await gasReporter.saveGasUsage(
    'reinit',
    await marginlyPool
      .connect(treasury)
      .execute(CallType.Reinit, 0, 0, 0, false, ZeroAddress, uniswapV3Swapdata(), { gasLimit: 500_000 })
  );
  const marginCallEvent = txReceipt.events?.find((e) => e.event == 'EnactMarginCall');
  if (marginCallEvent) {
    logger.warn(`Margin call happened`);
    logger.warn(`mc account: ${marginCallEvent.args![0]}`);
  }

  const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
  const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();

  logger.info(`Check longers after reinit`);
  const longersDeltas = [];
  let longersTotalCollDelta = 0n;
  let longersTotalDebtDelta = 0n;
  for (let i = 0; i < longersNumber; ++i) {
    const longer = longers[i];
    logger.info(`${i + 1}) longer ${longer.address}`);
    const position = await marginlyPool.positions(longer.address);
    if (position._type == 0n) {
      logger.info(` position not exists`);
      continue;
    }

    const sortKeyX48 = await getLongSortKeyX48(marginlyPool, longer.address);
    const discountedBaseAmount = position.discountedBaseAmount;
    const discountedQuoteAmount = position.discountedQuoteAmount;
    logger.info(` discountedBaseAmount  ${formatUnits(discountedBaseAmount, 18)}`);
    logger.info(` discountedQuoteAmount ${formatUnits(discountedQuoteAmount, 6)}`);
    const debtCoeff = await marginlyPool.quoteDebtCoeff();

    const realBaseAmount = (baseCollateralCoeff * discountedBaseAmount) / FP96.one;
    const realQuoteAmount = (debtCoeff * discountedQuoteAmount) / FP96.one;
    const collateralDelta = realBaseAmount - longersAmounts[i][0];
    longersTotalCollDelta = longersTotalCollDelta + collateralDelta;
    const debtDelta = realQuoteAmount - longersAmounts[i][1];
    longersTotalDebtDelta = longersTotalDebtDelta + debtDelta;
    longersDeltas.push([collateralDelta, debtDelta]);
    logger.info(` position type ${position._type}`);
    logger.info(` sortKey ${toHumanString(sortKeyX48)}`);
    logger.info(` collateral ${formatUnits(realBaseAmount, 18)} WETH, debt ${formatUnits(realQuoteAmount, 6)} USDC`);
    logger.info(` collateralDelta ${collateralDelta} WETH, debtDelta ${debtDelta} USDC`);
  }

  logger.info(`\n`);
  logger.info(`Check borrowers after reinit`);
  const shortersDeltas = [];
  let shortersTotalCollDelta = 0n;
  let shortersTotalDebtDelta = 0n;
  for (let i = 0; i < shortersNumber; ++i) {
    const shorter = shorters[i];
    logger.info(`${i + 1}) shorter ${shorter.address}`);
    const position = await marginlyPool.positions(shorter.address);
    if (position._type == 0n) {
      logger.warn(`position not exists`);
      continue;
    }

    const leverage = await getShortSortKeyX48(marginlyPool, shorter.address);
    const discountedBaseAmount = position.discountedBaseAmount;
    const discountedQuoteAmount = position.discountedQuoteAmount;
    logger.info(` discountedBaseAmount  ${formatUnits(discountedBaseAmount, 18)}`);
    logger.info(` discountedQuoteAmount ${formatUnits(discountedQuoteAmount, 6)}`);

    const debtCoeff = await marginlyPool.baseDebtCoeff();

    const realBaseAmount = (debtCoeff * discountedBaseAmount) / FP96.one;
    const realQuoteAmount = (quoteCollateralCoeff * discountedQuoteAmount) / FP96.one;
    const debtDelta = realBaseAmount - shortersAmounts[i][0];
    shortersTotalDebtDelta = shortersTotalDebtDelta + debtDelta;
    const collateralDelta = realQuoteAmount - shortersAmounts[i][1];
    shortersTotalCollDelta = shortersTotalCollDelta + collateralDelta;
    shortersDeltas.push([debtDelta, collateralDelta]);
    logger.info(` position type ${position._type}`);
    logger.info(` leverage ${toHumanString(leverage)}`);
    logger.info(` collateral ${formatUnits(realQuoteAmount, 6)} USDC, debt ${formatUnits(realBaseAmount, 18)} WETH`);
    logger.info(` collateralDelta ${collateralDelta} USDC, debtDelta ${debtDelta} WETH`);
  }

  const techPosition = await marginlyPool.positions(TechnicalPositionOwner);
  const realBaseDebtFee = (baseCollateralCoeff * techPosition.discountedBaseAmount) / FP96.one;
  const realQuoteDebtFee = (quoteCollateralCoeff * techPosition.discountedQuoteAmount) / FP96.one;

  logger.info(`shortersTotalDebtDelta ${formatUnits(shortersTotalDebtDelta, 18)} WETH`);
  logger.info(`longersTotalCollDelta ${formatUnits(longersTotalCollDelta, 18)} WETH`);
  logger.info(`realBaseDebtFee ${realBaseDebtFee} WETH`);

  logger.info(`longersTotalDebtDelta ${formatUnits(longersTotalDebtDelta, 6)} USDC`);
  logger.info(`shortersTotalCollDelta ${formatUnits(shortersTotalCollDelta, 6)} USDC`);
  logger.info(`realQuoteDebtFee ${realQuoteDebtFee} USDC`);

  const epsilon = 10;

  let delta = (shortersTotalDebtDelta - longersTotalCollDelta + realBaseDebtFee).abs();
  if (delta > epsilon) {
    const shortDebtDelta = formatUnits(shortersTotalDebtDelta, 18);
    const longCollDelta = formatUnits(longersTotalCollDelta, 18);
    const debtFee = formatUnits(realBaseDebtFee, 18);
    const deltaFormatted = formatUnits(delta, 18);
    const error = `realDebtFee ${debtFee} WETH + short debt delta = ${shortDebtDelta} WETH !=  ${longCollDelta} WETH = long coll delta, delta = ${deltaFormatted}`;
    logger.error(error);
    // throw new Error(error);
  }

  delta = (longersTotalDebtDelta - shortersTotalCollDelta + realQuoteDebtFee).abs();
  if (delta > epsilon) {
    const shortCollDelta = formatUnits(shortersTotalCollDelta, 6);
    const longDebtDelta = formatUnits(longersTotalDebtDelta, 6);
    const debtFee = formatUnits(realQuoteDebtFee, 6);
    const deltaFormatted = formatUnits(delta, 6);
    const error = `realDebtFee ${debtFee} USDC + short coll delta = ${shortCollDelta} USDC !=  ${longDebtDelta} USDC = long debt delta, delta = ${deltaFormatted}`;
    logger.error(error);
    // throw new Error(error);
  }

  logger.info(`baseDebtCoeff: ${toHumanString(await marginlyPool.baseDebtCoeff())}`);
  logger.info(`quoteDebtCoeff: ${toHumanString(await marginlyPool.quoteDebtCoeff())}`);

  logger.warn(`basePrice: ${toHumanString((await marginlyPool.getBasePrice()).inner * 10n ** 12n)}`);
  logger.warn(`leverageShort: ${toHumanString((await marginlyPool.systemLeverage()).shortX96)}`);

  return;
}
