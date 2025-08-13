import { expect } from 'chai';
import {
  createPendleCaseEzETH27Jun2024,
  createPendleCaseRsETH27Jun2024,
  createPendleCaseWeETH27Jun2024,
  createPendleCaseWstEth28Mar2024,
} from '../shared/fixtures';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { fetchPendlePrices, one, printPendlePrices, printPendleTokenSymbols } from './common';

describe('Pendle PT oracle before maturity (PendleOracle)', () => {
  it('PT-weETH-27JUN2024 / WETH', async () => {
    const caseParams = await loadFixture(createPendleCaseWeETH27Jun2024);

    const {
      actualBalancePrice,
      actualMargincallPrice,
      balancePtToSyPrice,
      margincallPtToSyPrice,
      balancePriceFromSecondaryOracle,
      margincallPriceFromSecondaryOracle,
    } = await fetchPendlePrices(caseParams);

    const expectedBalancePrice = (balancePtToSyPrice * balancePriceFromSecondaryOracle) / one;
    const expectedMargincallPrice = (margincallPtToSyPrice * margincallPriceFromSecondaryOracle) / one;

    printPendleTokenSymbols(caseParams);

    console.log(`\nBalance price:`);
    printPendlePrices(actualBalancePrice, balancePtToSyPrice, balancePriceFromSecondaryOracle, expectedBalancePrice);
    console.log(`\nMargincall price:`);
    printPendlePrices(
      actualMargincallPrice,
      margincallPtToSyPrice,
      margincallPriceFromSecondaryOracle,
      expectedMargincallPrice
    );

    expect(actualBalancePrice).to.be.closeTo(expectedBalancePrice, 1000n);
    expect(actualMargincallPrice).to.be.closeTo(expectedMargincallPrice, 1000n);
  });

  it('PT-rsETH-27JUN2024 / WETH', async () => {
    const caseParams = await loadFixture(createPendleCaseRsETH27Jun2024);

    const {
      actualBalancePrice,
      actualMargincallPrice,
      balancePtToSyPrice,
      margincallPtToSyPrice,
      balancePriceFromSecondaryOracle,
      margincallPriceFromSecondaryOracle,
    } = await fetchPendlePrices(caseParams);

    const expectedBalancePrice = (balancePtToSyPrice * balancePriceFromSecondaryOracle) / one;
    const expectedMargincallPrice = (margincallPtToSyPrice * margincallPriceFromSecondaryOracle) / one;

    printPendleTokenSymbols(caseParams);

    console.log(`\nBalance price:`);
    printPendlePrices(actualBalancePrice, balancePtToSyPrice, balancePriceFromSecondaryOracle, expectedBalancePrice);
    console.log(`\nMargincall price:`);
    printPendlePrices(
      actualMargincallPrice,
      margincallPtToSyPrice,
      margincallPriceFromSecondaryOracle,
      expectedMargincallPrice
    );

    expect(actualBalancePrice).to.be.closeTo(expectedBalancePrice, 1000n);
    expect(actualMargincallPrice).to.be.closeTo(expectedMargincallPrice, 1000n);
  });

  it('PT-ezETH-27JUN2024 / WETH', async () => {
    const caseParams = await loadFixture(createPendleCaseEzETH27Jun2024);

    const {
      actualBalancePrice,
      actualMargincallPrice,
      balancePtToSyPrice,
      margincallPtToSyPrice,
      balancePriceFromSecondaryOracle,
      margincallPriceFromSecondaryOracle,
    } = await fetchPendlePrices(caseParams);

    const expectedBalancePrice = (balancePtToSyPrice * balancePriceFromSecondaryOracle) / one;
    const expectedMargincallPrice = (margincallPtToSyPrice * margincallPriceFromSecondaryOracle) / one;

    printPendleTokenSymbols(caseParams);

    console.log(`\nBalance price:`);
    printPendlePrices(actualBalancePrice, balancePtToSyPrice, balancePriceFromSecondaryOracle, expectedBalancePrice);
    console.log(`\nMargincall price:`);
    printPendlePrices(
      actualMargincallPrice,
      margincallPtToSyPrice,
      margincallPriceFromSecondaryOracle,
      expectedMargincallPrice
    );

    expect(actualBalancePrice).to.be.closeTo(expectedBalancePrice, 1000n);
    expect(actualMargincallPrice).to.be.closeTo(expectedMargincallPrice, 1000n);
  });
});

describe('Pendle PT oracle after maturity (PendleOracle)', () => {
  it('PT-wstETH-28MAR2024 / WETH', async () => {
    const caseParams = await loadFixture(createPendleCaseWstEth28Mar2024);

    const {
      actualBalancePrice,
      actualMargincallPrice,
      balancePtToSyPrice,
      margincallPtToSyPrice,
      balancePriceFromSecondaryOracle,
      margincallPriceFromSecondaryOracle,
    } = await fetchPendlePrices(caseParams);

    const expectedBalancePrice = (balancePtToSyPrice * balancePriceFromSecondaryOracle) / one;
    const expectedMargincallPrice = (margincallPtToSyPrice * margincallPriceFromSecondaryOracle) / one;

    printPendleTokenSymbols(caseParams);

    console.log(`\nBalance price:`);
    printPendlePrices(actualBalancePrice, balancePtToSyPrice, balancePriceFromSecondaryOracle, expectedBalancePrice);
    console.log(`\nMargincall price:`);
    printPendlePrices(
      actualMargincallPrice,
      margincallPtToSyPrice,
      margincallPriceFromSecondaryOracle,
      expectedMargincallPrice
    );

    expect(actualBalancePrice).to.be.closeTo(expectedBalancePrice, 1000n);
    expect(actualMargincallPrice).to.be.closeTo(expectedMargincallPrice, 1000n);
  });
});
