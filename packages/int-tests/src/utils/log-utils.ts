import { formatUnits } from 'ethers';
import { FP96, toHumanString } from '../utils/fixed-point';
import { logger } from '../utils/logger';
import { SystemUnderTest, TechnicalPositionOwner } from '../suites';

export async function showSystemAggregates(sut: SystemUnderTest) {
  const { marginlyPool, marginlyFactory, accounts, usdc, weth } = sut;
  const discountedBaseCollateral = await marginlyPool.discountedBaseCollateral();
  const discountedBaseDebt = await marginlyPool.discountedBaseDebt();
  const discountedQuoteCollateral = await marginlyPool.discountedQuoteCollateral();
  const discountedQuoteDebt = await marginlyPool.discountedQuoteDebt();

  const usdcBalance = await usdc.balanceOf(marginlyPool);
  const wethBalance = await weth.balanceOf(marginlyPool);

  const lastReinit = await marginlyPool.lastReinitTimestampSeconds();

  const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
  const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
  const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
  const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();

  const shortX96 = await marginlyPool.shortLeverageX96();
  const longX96 = await marginlyPool.longLeverageX96();
  const basePriceX96 = (await marginlyPool.getBasePrice()).inner * 10n ** 12n;

  // calc aggregates
  const realQuoteCollateral = (quoteCollateralCoeff * discountedQuoteCollateral) / FP96.one;
  const realQuoteDebt = (quoteDebtCoeff * discountedQuoteDebt) / FP96.one;
  const realBaseCollateral = (baseCollateralCoeff * discountedBaseCollateral) / FP96.one;
  const realBaseDebt = (baseDebtCoeff * discountedBaseDebt) / FP96.one;

  const feeBalance = await usdc.balanceOf(await marginlyFactory.feeHolder());

  const techPosition = await marginlyPool.positions(TechnicalPositionOwner);
  const techRealBaseAmount = (baseCollateralCoeff * techPosition.discountedBaseAmount) / FP96.one;
  const techRealQuoteAmount = (quoteCollateralCoeff * techPosition.discountedQuoteAmount) / FP96.one;

  //totalCollateral - totalDebt
  const systemBalance =
    realBaseCollateral - (realBaseDebt * (basePriceX96 / 10n ** 12n)) / FP96.one + realQuoteCollateral - realQuoteDebt;

  logger.info(`📜 Marginly state: `);
  logger.info(`     discountedBaseCollateral = ${formatUnits(discountedBaseCollateral, 18)}  WETH`);
  logger.info(`     discountedBaseDebt       = ${formatUnits(discountedBaseDebt, 18)} WETH`);
  logger.info(`     discountedQuoteCollateral = ${formatUnits(discountedQuoteCollateral, 6)} USDC`);
  logger.info(`     discountedQuoteDebt       = ${formatUnits(discountedQuoteDebt, 6)} USDC`);
  logger.info(` `);
  logger.info(`     realBaseCollateral       = ${formatUnits(realBaseCollateral, 18)} WETH`);
  logger.info(`     realBaseDebt             = ${formatUnits(realBaseDebt, 18)} WETH`);
  logger.info(`     realQuoteCollateral      = ${formatUnits(realQuoteCollateral, 6)} USDC`);
  logger.info(`     realQuoteDebt            = ${formatUnits(realQuoteDebt, 6)} USDC`);
  logger.info(`     systemBalance            = ${formatUnits(systemBalance, 6)} USDC`);
  logger.info(` `);
  logger.info(`     USDC balance             = ${formatUnits(usdcBalance, 6)} USDC`);
  logger.info(`     WETH balance             = ${formatUnits(wethBalance, 18)} WETH`);
  logger.info(` `);
  logger.info(`     baseCollateralCoeff      = ${toHumanString(baseCollateralCoeff)}`);
  logger.info(`     baseDebtCoeff            = ${toHumanString(baseDebtCoeff)}`);
  logger.info(`     quoteCollateralCoeff     = ${toHumanString(quoteCollateralCoeff)}`);
  logger.info(`     quoteDebtCoeff           = ${toHumanString(quoteDebtCoeff)}`);
  logger.info(` `);
  logger.info(`     lastReinit               = ${lastReinit}`);
  logger.info(`     Leverage.short           = ${toHumanString(shortX96)}`);
  logger.info(`     Leverage.long            = ${toHumanString(longX96)}`);
  logger.info(`     basePrice                = ${toHumanString(basePriceX96)} USDC`);
  logger.info(` `);
  logger.info(`     feeBalance               = ${formatUnits(feeBalance, 6)} USDC`);
  logger.info(` `);
  logger.info(` TechPosition:`);
  logger.info(`       discountedBaseAmount   = ${formatUnits(techPosition.discountedBaseAmount, 18)} WETH`);
  logger.info(`       discountedQuoteAmount   = ${formatUnits(techPosition.discountedQuoteAmount, 6)} USDC`);
  logger.info(`       realBaseAmount   = ${formatUnits(techRealBaseAmount, 18)} WETH`);
  logger.info(`       realQuoteAmount   = ${formatUnits(techRealQuoteAmount, 6)} USDC`);

  logger.info(`  Positions:`);
  for (let i = 0; i < 4; i++) {
    const position = await marginlyPool.positions(accounts[i].address);
    let typeStr;
    if (position._type == 0n) {
      typeStr = 'Uninitialized';
    } else if (position._type == 1n) {
      typeStr = 'Lend';
    } else if (position._type == 2n) {
      typeStr = 'Short (Base in debt)';
    } else if (position._type == 3n) {
      typeStr = 'Long (Quote in debt)';
    }

    const discountedBaseAmount = position.discountedBaseAmount;
    const discountedQuoteAmount = position.discountedQuoteAmount;
    let realBaseAmount = (discountedBaseAmount * baseCollateralCoeff) / FP96.one;
    let realQuoteAmount = (discountedQuoteAmount * quoteCollateralCoeff) / FP96.one;
    let leverage = 1;
    if (position._type === 2n) {
      // Short
      realBaseAmount = (discountedBaseAmount * baseDebtCoeff) / FP96.one;
      const collateral = realQuoteAmount;
      const debt = ((basePriceX96 / 10n ** 12n) * realBaseAmount) / FP96.one;
      leverage = Number(collateral) / Number(collateral - debt);
    } else if (position._type === 3n) {
      //Long
      realQuoteAmount = (discountedQuoteAmount * quoteDebtCoeff) / FP96.one;
      const collateral = ((basePriceX96 / 10n ** 12n) * realBaseAmount) / FP96.one;
      const debt = realQuoteAmount;
      leverage = Number(collateral) / Number(collateral - debt);
    }

    logger.info(` `);
    logger.info(`   ${accounts[i].address}`);
    logger.info(`   ${typeStr}`);
    logger.info(`   discountedBaseAmount       = ${formatUnits(discountedBaseAmount, 18)} WETH`);
    logger.info(`   discountedQuoteAmount      = ${formatUnits(discountedQuoteAmount, 6)} USDC`);
    logger.info(`   realBaseAmount             = ${formatUnits(realBaseAmount, 18)} WETH`);
    logger.info(`   realQuoteAmount            = ${formatUnits(realQuoteAmount, 6)} USDC`);
    logger.info(`   leverage                   = ${leverage.toString()}`);
  }
}
