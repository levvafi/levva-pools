import { createMarginlyPool, createMarginlyPoolQuoteTokenIsWETH } from './shared/fixtures';
import { loadFixture, setBalance, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  assertAccruedRateCoeffs,
  calcLeverageLong,
  calcLeverageShort,
  calcLongSortKey,
  calcShortSortKey,
  CallType,
  convertFP96ToNumber,
  FP48,
  FP96,
  getMarginlyPoolState,
  PositionType,
  uniswapV3Swapdata,
  WHOLE_ONE,
} from './shared/utils';
import { EventLog, parseUnits, ZeroAddress } from 'ethers';
import { MarginlyParamsStruct } from '../../typechain-types/contracts/LevvaTradingPool';

describe('MarginlyPool.Base', () => {
  it('should revert when second try of initialization', async () => {
    const { marginlyPool: pool, factoryOwner } = await loadFixture(createMarginlyPool);

    const quoteToken = await pool.quoteToken();
    const baseToken = await pool.baseToken();
    const priceOracle = await pool.priceOracle();
    const defaultSwapCallData = await pool.defaultSwapCallData();

    const marginlyParams: MarginlyParamsStruct = {
      interestRate: 54,
      maxLeverage: 15,
      fee: 1,
      swapFee: 1000,
      mcSlippage: 400000,
      positionMinAmount: 1, // 1 WEI
      quoteLimit: 1_000_000_000,
    };

    await expect(
      pool.connect(factoryOwner).initialize(quoteToken, baseToken, priceOracle, defaultSwapCallData, marginlyParams)
    ).to.be.revertedWithCustomError(pool, 'Forbidden');
  });

  it('should revert when somebody trying to send value', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [_, signer] = await ethers.getSigners();

    const valueToSend = parseUnits('1', 18); // 1.0 ETH
    await expect(
      signer.sendTransaction({
        to: marginlyPool,
        value: valueToSend,
      })
    ).to.be.revertedWithCustomError(marginlyPool, 'NotWETH9');
  });

  it('sweepETH should revert when sender is not admin', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [_, signer] = await ethers.getSigners();

    await expect(marginlyPool.connect(signer).sweepETH()).to.be.revertedWithCustomError(marginlyPool, 'AccessDenied');
  });

  it('sweepETH should be called by admin', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [owner, signer, lender] = await ethers.getSigners();

    const params = await marginlyPool.params();
    const newParams = {
      maxLeverage: params.maxLeverage,
      interestRate: params.interestRate,
      fee: params.fee,
      swapFee: params.swapFee,
      mcSlippage: params.mcSlippage,
      positionMinAmount: params.positionMinAmount,
      quoteLimit: 10000n * 10n ** 18n,
    };
    await marginlyPool.connect(owner).setParameters(newParams);

    const price = (await marginlyPool.getBasePrice()).inner;

    const quoteDeposit = 1000;
    await marginlyPool
      .connect(lender)
      .execute(CallType.DepositQuote, quoteDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const valueDeposit = parseUnits('1.2', 18);
    await setBalance(await marginlyPool.getAddress(), valueDeposit);

    const balanceBefore = await owner.provider.getBalance(owner);

    const txReceipt = await (await marginlyPool.connect(owner).sweepETH()).wait();
    expect(txReceipt).to.be.not.null;
    const txFee = txReceipt!.gasUsed * txReceipt!.gasPrice;

    const balanceAfter = await owner.provider.getBalance(owner);

    expect(balanceBefore - txFee + valueDeposit).to.be.equal(balanceAfter);
  });

  it('should set Marginly parameters by factory owner', async () => {
    const { marginlyPool: pool, factoryOwner } = await loadFixture(createMarginlyPool);

    const parameters: MarginlyParamsStruct = {
      interestRate: 54,
      fee: 1,
      maxLeverage: 15,
      swapFee: 1000,
      positionMinAmount: 100,
      mcSlippage: 400000,
      quoteLimit: 1_000_000_000,
    };

    await pool.connect(factoryOwner).setParameters(parameters);

    const params = await pool.params();

    expect(params.interestRate).to.equal(54);
    expect(params.maxLeverage).to.equal(15);
    expect(params.swapFee).to.equal(1000);
    expect(params.positionMinAmount).to.equal(100);
    expect(params.mcSlippage).to.equal(400000);
    expect(params.quoteLimit).to.equal(1_000_000_000);
    expect(params.fee).to.equal(1);
  });

  it('should raise error when not an owner trying to set parameters', async () => {
    const { marginlyPool: pool } = await loadFixture(createMarginlyPool);
    const [_, otherSigner] = await ethers.getSigners();

    expect((await pool.positions).length).to.be.equal(0);

    const parameters: MarginlyParamsStruct = {
      interestRate: 54,
      maxLeverage: 15,
      fee: 1,
      swapFee: 1000,
      positionMinAmount: 100,
      mcSlippage: 400000,
      quoteLimit: 1_000_000_000,
    };

    await expect(pool.connect(otherSigner).setParameters(parameters)).to.be.revertedWithCustomError(
      pool,
      'AccessDenied'
    );
  });

  it('should raise error when trying to set invalid parameters', async () => {
    const { marginlyPool: pool } = await loadFixture(createMarginlyPool);
    const params: MarginlyParamsStruct = {
      interestRate: 54,
      maxLeverage: 15,
      fee: 1,
      swapFee: 1000,
      positionMinAmount: 100,
      mcSlippage: 400000,
      quoteLimit: 1_000_000_000,
    };

    await expect(pool.setParameters({ ...params, interestRate: 1_000_001 })).to.be.revertedWithCustomError(
      pool,
      'WrongValue'
    );
    await expect(pool.setParameters({ ...params, maxLeverage: 0 })).to.be.revertedWithCustomError(pool, 'WrongValue');
    await expect(pool.setParameters({ ...params, fee: 1_000_001 })).to.be.revertedWithCustomError(pool, 'WrongValue');
    await expect(pool.setParameters({ ...params, swapFee: 1_000_001 })).to.be.revertedWithCustomError(
      pool,
      'WrongValue'
    );
    await expect(pool.setParameters({ ...params, mcSlippage: 1_000_001 })).to.be.revertedWithCustomError(
      pool,
      'WrongValue'
    );
    await expect(pool.setParameters({ ...params, positionMinAmount: 0 })).to.be.revertedWithCustomError(
      pool,
      'WrongValue'
    );

    await expect(pool.setParameters({ ...params, quoteLimit: 0 })).to.be.revertedWithCustomError(pool, 'WrongValue');
  });

  describe('Deposit base', async () => {
    it('zero amount', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, otherSigner] = await ethers.getSigners();

      const price = (await marginlyPool.getBasePrice()).inner;

      await expect(
        marginlyPool
          .connect(otherSigner)
          .execute(CallType.DepositBase, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'ZeroAmount');
    });

    it('exceeds limit', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, otherSigner] = await ethers.getSigners();

      const price = (await marginlyPool.getBasePrice()).inner;

      await expect(
        marginlyPool
          .connect(otherSigner)
          .execute(CallType.DepositBase, 8_000_000, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'ExceedsLimit');
    });

    it('first deposit should create position', async () => {
      const { marginlyPool, quoteContract, baseContract } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const depositAmount = 1000;

      const price = (await marginlyPool.getBasePrice()).inner;

      const tx = await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const receipt = await tx.wait();
      expect(receipt?.logs).to.be.not.undefined;

      const depositBaseEvent = receipt?.logs
        ?.filter((log) => log instanceof EventLog)
        .find((x) => x.eventName === 'DepositBase');
      expect(depositBaseEvent?.args?.user).to.be.equal(signer.address);
      expect(depositBaseEvent?.args?.amount).to.be.equal(depositAmount);

      const expectedDBC = convertFP96ToNumber(await marginlyPool.baseCollateralCoeff()) * depositAmount;

      // check aggregates
      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC);
      expect(await marginlyPool.discountedBaseDebt()).to.be.equal(0);

      expect(await baseContract.balanceOf(marginlyPool)).to.be.equal(depositAmount);
      expect(await quoteContract.balanceOf(marginlyPool)).to.be.equal(0);

      // check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Lend);
      expect(position.discountedBaseAmount).to.be.equal(expectedDBC);
      expect(position.discountedQuoteAmount).to.be.equal(0);
      expect(position.heapPosition).to.be.equal(0);
    });

    it('different signers deposits', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer1, signer2] = await ethers.getSigners();
      const firstDeposit = 2468;
      const secondDeposit = 2837;

      const price = (await marginlyPool.getBasePrice()).inner;

      await marginlyPool
        .connect(signer1)
        .execute(CallType.DepositBase, firstDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer2)
        .execute(CallType.DepositBase, secondDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const expectedDBC1 = convertFP96ToNumber(await marginlyPool.baseCollateralCoeff()) * firstDeposit;
      const expectedDBC2 = convertFP96ToNumber(await marginlyPool.baseCollateralCoeff()) * secondDeposit;

      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC1 + expectedDBC2);
      const positionFirst = await marginlyPool.positions(signer1.address);
      expect(positionFirst.discountedBaseAmount).to.be.equal(expectedDBC1);

      const positionSecond = await marginlyPool.positions(signer2.address);
      expect(positionSecond.discountedBaseAmount).to.be.equal(expectedDBC2);
    });

    it('deposit into positive base position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const firstDeposit = 1000;
      const secondDeposit = 500;
      const total = firstDeposit + secondDeposit;

      const price = (await marginlyPool.getBasePrice()).inner;

      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, firstDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, secondDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const expectedDBC = convertFP96ToNumber(await marginlyPool.baseCollateralCoeff()) * total;

      // check aggregates
      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC);
      expect(await marginlyPool.discountedBaseDebt()).to.be.equal(0);

      // check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Lend);
      expect(position.discountedBaseAmount).to.be.equal(expectedDBC);
      expect(position.discountedQuoteAmount).to.be.equal(0);
      expect(position.heapPosition).to.be.equal(0);
    });

    it('depositBase into short position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, 10000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const firstDeposit = 1000;
      const shortAmount = 250;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, firstDeposit, shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      let positionRealBaseAmount = shortAmount;
      let position = await marginlyPool.positions(signer.address);
      expect(position.heapPosition).to.be.equal(1);

      const sortKeyBefore = (await marginlyPool.getHeapPosition(position.heapPosition - 1n, true))[1].key;
      const expectedShortKeyBefore = calcShortSortKey(position.discountedQuoteAmount, position.discountedBaseAmount);
      expect(sortKeyBefore).to.be.equal(expectedShortKeyBefore);

      const baseDepositFirst = 100;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, baseDepositFirst, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      const baseDebtCoeff = await marginlyPool.baseDebtCoeff();

      position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Short);
      positionRealBaseAmount -= baseDepositFirst;
      expect((position.discountedBaseAmount * baseDebtCoeff) / FP96.one).to.be.closeTo(positionRealBaseAmount, 1);

      const sortKeyAfter = (await marginlyPool.getHeapPosition(position.heapPosition - 1n, true))[1].key;
      const expectedSortKeyAfter = calcShortSortKey(position.discountedQuoteAmount, position.discountedBaseAmount);
      expect(sortKeyAfter).to.be.equal(expectedSortKeyAfter);
      // leverage should be less after depositBase
      expect(sortKeyAfter).to.be.lessThan(sortKeyBefore);

      const baseDepositSecond = positionRealBaseAmount * 2;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, baseDepositSecond, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      {
        const position = await marginlyPool.positions(signer.address);
        const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
        expect(position._type).to.be.equal(PositionType.Lend);
        expect(position.heapPosition).to.be.equal(0);
        expect((await marginlyPool.getHeapPosition(0, true))[0]).to.be.false;
        expect((position.discountedBaseAmount * baseCollateralCoeff) / FP96.one).to.be.closeTo(
          positionRealBaseAmount,
          2
        );
      }
    });

    it('depositBase into long position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, 10000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const firstDeposit = 1000;
      const longAmount = 63;

      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, firstDeposit, longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      const positionBefore = await marginlyPool.positions(signer.address);
      expect(positionBefore._type).to.be.equal(PositionType.Long);

      const depositBaseAmount = 100;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, depositBaseAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const positionAfter = await marginlyPool.positions(signer.address);
      expect(positionAfter._type).to.be.equal(PositionType.Long);
    });

    it('depositBase and open long position', async () => {
      const { marginlyPool, baseContract } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const lenderDeposit = 10000;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, lenderDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const depositAmount = 1000;
      const longAmount = 100;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, depositAmount, longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      // check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Long);
      expect(position.heapPosition).to.be.equal(1);
    });

    it('depositBase and open short position', async () => {
      const { marginlyPool, baseContract } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const lenderDeposit = 10000;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, lenderDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, lenderDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const depositAmount = 1000;
      const shortAmount = 100;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, depositAmount, -shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      // check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Short);
      expect(position.heapPosition).to.be.equal(1);
    });

    it('depositBase and long into short position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const swapFee = (await marginlyPool.params()).swapFee;

      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, 10000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, 10000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const firstDeposit = 1000;
      const shortAmount = 5000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, firstDeposit, shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      const positionBefore = await marginlyPool.positions(signer.address);
      const heapPositionBefore = await marginlyPool.getHeapPosition(positionBefore.heapPosition - 1n, true);
      const discountedBaseCollateralBefore = await marginlyPool.discountedBaseCollateral();
      const discountedBaseDebtBefore = await marginlyPool.discountedBaseDebt();
      const discountedQuoteCollateralBefore = await marginlyPool.discountedQuoteCollateral();
      const discountedQuoteDebtBefore = await marginlyPool.discountedQuoteDebt();

      const baseDepositFirst = 1000n;
      // making sure flip is tested on short position (deposit won't cover all the position debt)
      expect((positionBefore.discountedBaseAmount * (await marginlyPool.baseDebtCoeff())) / FP96.one).to.be.gt(
        baseDepositFirst
      );
      const longAmount = 5000n;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, baseDepositFirst, longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      const positionAfter = await marginlyPool.positions(signer.address);
      const heapPositionAfter = await marginlyPool.getHeapPosition(positionBefore.heapPosition - 1n, true);
      const discountedBaseCollateralAfter = await marginlyPool.discountedBaseCollateral();
      const discountedBaseDebtAfter = await marginlyPool.discountedBaseDebt();
      const discountedQuoteCollateralAfter = await marginlyPool.discountedQuoteCollateral();
      const discountedQuoteDebtAfter = await marginlyPool.discountedQuoteDebt();

      const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
      const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
      const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
      const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();

      expect(heapPositionBefore[1].account).to.be.eq(signer.address);
      expect(heapPositionAfter[1].account).to.be.not.eq(signer.address);
      expect(positionAfter._type).to.be.eq(PositionType.Long);

      const baseDebtDelta = positionBefore.discountedBaseAmount;
      expect(discountedBaseDebtBefore - discountedBaseDebtAfter).to.be.eq(baseDebtDelta);

      const quoteDebtDelta = (((price * longAmount) / quoteDebtCoeff) * (10n ** 6n + swapFee)) / 10n ** 6n;
      expect(discountedQuoteDebtAfter - discountedQuoteDebtBefore).to.be.eq(quoteDebtDelta);
      expect(positionAfter.discountedQuoteAmount).to.be.eq(quoteDebtDelta);

      const quoteCollDelta = positionBefore.discountedQuoteAmount;
      expect(discountedQuoteCollateralBefore - discountedQuoteCollateralAfter).to.be.eq(quoteCollDelta);

      const baseCollDelta =
        ((((positionBefore.discountedQuoteAmount * quoteCollateralCoeff * (10n ** 6n - swapFee)) / 10n ** 6n) *
          FP96.one) /
          price +
          (longAmount + baseDepositFirst) * FP96.one -
          baseDebtDelta * baseDebtCoeff) /
        baseCollateralCoeff;

      expect(positionAfter.discountedBaseAmount).to.be.closeTo(baseCollDelta, 1);
      expect(discountedBaseCollateralAfter - discountedBaseCollateralBefore).to.be.closeTo(baseCollDelta, 1);
    });

    it('depositBase should wrap ETH into WETH', async () => {
      const { marginlyPool, baseContract } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const depositAmount = 1000;
      await baseContract.connect(signer).approve(marginlyPool, 0);
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata(), {
          value: depositAmount,
        });

      // check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Lend);
      expect(position.discountedBaseAmount).to.be.equal(depositAmount);
      expect(position.discountedQuoteAmount).to.be.equal(0);
      expect(position.heapPosition).to.be.equal(0);
    });

    it('depositBase, wrong eth value', async () => {
      const { marginlyPool, baseContract } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const depositAmount = 1000;
      const value = depositAmount + 1;
      await baseContract.connect(signer).approve(marginlyPool, 0);
      const tx = marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata(), {
          value: value,
        });

      await expect(tx).to.be.revertedWithCustomError(marginlyPool, 'WrongValue');
    });
  });

  describe('Deposit quote', async () => {
    it('zero amount', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, otherSigner] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      await expect(
        marginlyPool
          .connect(otherSigner)
          .execute(CallType.DepositQuote, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'ZeroAmount');
    });

    it('exceeds limit', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, otherSigner] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      await expect(
        marginlyPool
          .connect(otherSigner)
          .execute(CallType.DepositQuote, 2_000_000, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'ExceedsLimit');
    });

    it('first deposit should create position', async () => {
      const { marginlyPool, quoteContract, baseContract } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const depositAmount = 1500;

      const tx = await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      const receipt = await tx.wait();
      expect(receipt?.logs).to.be.not.undefined;

      const depositQuoteEvent = receipt?.logs
        ?.filter((log) => log instanceof EventLog)
        .find((x) => x.eventName === 'DepositQuote');

      expect(depositQuoteEvent?.args?.user).to.be.equal(signer.address);
      expect(depositQuoteEvent?.args?.amount).to.be.equal(depositAmount);

      const expectedDQC = convertFP96ToNumber(await marginlyPool.quoteCollateralCoeff()) * depositAmount;

      // check aggregates
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC);
      expect(await marginlyPool.discountedQuoteDebt()).to.be.equal(0);
      expect(await baseContract.balanceOf(marginlyPool)).to.be.equal(0);
      expect(await quoteContract.balanceOf(marginlyPool)).to.be.equal(depositAmount);

      // check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Lend);
      expect(position.discountedBaseAmount).to.be.equal(0);
      expect(position.discountedQuoteAmount).to.be.equal(expectedDQC);
    });

    it('deposit into positive quote position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const firstDeposit = 1000;
      const secondDeposit = 500;
      const total = firstDeposit + secondDeposit;

      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, firstDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, secondDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const expectedDQC = convertFP96ToNumber(await marginlyPool.quoteCollateralCoeff()) * total;

      // check aggregates
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC);
      expect(await marginlyPool.discountedQuoteDebt()).to.be.equal(0);

      // check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Lend);
      expect(position.discountedBaseAmount).to.be.equal(0);
      expect(position.discountedQuoteAmount).to.be.equal(expectedDQC);
      expect(position.heapPosition).to.be.equal(0);
    });

    it('deposit into short position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, 10000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const firstDeposit = 1000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, firstDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      const shortAmount = 200;
      await marginlyPool
        .connect(signer)
        .execute(CallType.Short, shortAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const positionBefore = await marginlyPool.positions(signer.address);
      expect(positionBefore._type).to.be.equal(PositionType.Short);

      const quoteDeposit = 300;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, quoteDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const positionAfter = await marginlyPool.positions(signer.address);
      expect(positionAfter._type).to.be.equal(PositionType.Short);
    });

    it('deposit into long position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, 10000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      const firstDeposit = 1000n;

      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, firstDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      const longAmount = 100n;
      let positionRealQuoteAmount = (price * longAmount) / FP96.one;
      await marginlyPool
        .connect(signer)
        .execute(CallType.Long, longAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const positionBefore = await marginlyPool.positions(signer.address);
      expect(positionBefore._type).to.be.equal(PositionType.Long);
      expect(positionBefore.heapPosition).to.be.equal(1);

      const quoteDepositFirst = 20n;
      positionRealQuoteAmount = positionRealQuoteAmount - quoteDepositFirst;
      expect(positionRealQuoteAmount).to.be.greaterThan(0);
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, quoteDepositFirst, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      {
        const positionAfter = await marginlyPool.positions(signer.address);
        const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
        expect(positionAfter._type).to.be.equal(PositionType.Long);
        expect((positionAfter.discountedQuoteAmount * quoteDebtCoeff) / FP96.one).to.be.closeTo(
          positionRealQuoteAmount,
          1
        );
      }

      const quoteDepositSecond = positionRealQuoteAmount * 2n;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, quoteDepositSecond, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const positionAfter = await marginlyPool.positions(signer.address);
      const quoteCollateralCoeff = await marginlyPool.quoteDebtCoeff();
      expect(positionAfter._type).to.be.equal(PositionType.Lend);
      expect(positionAfter.heapPosition).to.be.equal(0);
      expect((await marginlyPool.getHeapPosition(0, false))[0]).to.be.false;
      expect((positionAfter.discountedQuoteAmount * quoteCollateralCoeff) / FP96.one).to.be.closeTo(
        positionRealQuoteAmount,
        1
      );
    });

    it('depositQuote and open short position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const lenderDeposit = 10000;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, lenderDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const depositAmount = 1500;
      const shortAmount = 1000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, depositAmount, shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      // check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Short);
      expect(position.heapPosition).to.be.equal(1);
    });

    it('depositQuote and open long position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const lenderDeposit = 10000n;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, lenderDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, lenderDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const depositAmount = 1500n;
      const longAmount = 1000n;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, depositAmount, -longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      // check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Long);
      expect(position.heapPosition).to.be.equal(1);
    });

    it('depositQuote and short into long position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const swapFee = (await marginlyPool.params()).swapFee;

      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, 100000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const firstDeposit = 10000n;
      const longAmount = 50000n;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, firstDeposit, longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      const positionBefore = await marginlyPool.positions(signer.address);
      const heapPositionBefore = await marginlyPool.getHeapPosition(positionBefore.heapPosition - 1n, false);
      const discountedBaseCollateralBefore = await marginlyPool.discountedBaseCollateral();
      const discountedBaseDebtBefore = await marginlyPool.discountedBaseDebt();
      const discountedQuoteCollateralBefore = await marginlyPool.discountedQuoteCollateral();
      const discountedQuoteDebtBefore = await marginlyPool.discountedQuoteDebt();

      const quoteDepositSecond = 10000n;
      // making sure flip is tested on long position (deposit won't cover all the position debt)
      expect((positionBefore.discountedQuoteAmount * (await marginlyPool.quoteDebtCoeff())) / FP96.one).to.be.gt(
        quoteDepositSecond
      );
      const shortAmount = 50000n;
      await marginlyPool
        .connect(signer)
        .execute(
          CallType.DepositQuote,
          quoteDepositSecond,
          shortAmount,
          price,
          false,
          ZeroAddress,
          uniswapV3Swapdata()
        );

      const positionAfter = await marginlyPool.positions(signer.address);
      const heapPositionAfter = await marginlyPool.getHeapPosition(positionBefore.heapPosition - 1n, false);
      const discountedBaseCollateralAfter = await marginlyPool.discountedBaseCollateral();
      const discountedBaseDebtAfter = await marginlyPool.discountedBaseDebt();
      const discountedQuoteCollateralAfter = await marginlyPool.discountedQuoteCollateral();
      const discountedQuoteDebtAfter = await marginlyPool.discountedQuoteDebt();

      const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
      const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
      const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
      const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();

      expect(heapPositionBefore[1].account).to.be.eq(signer.address);
      expect(heapPositionAfter[1].account).to.be.not.eq(signer.address);
      expect(positionAfter._type).to.be.eq(PositionType.Short);

      const quoteDebtDelta = positionBefore.discountedQuoteAmount;
      expect(discountedQuoteDebtBefore - discountedQuoteDebtAfter).to.be.eq(quoteDebtDelta);

      const baseDebtDelta = (shortAmount * FP96.one) / baseDebtCoeff;
      expect(discountedBaseDebtAfter - discountedBaseDebtBefore).to.be.eq(baseDebtDelta);
      expect(positionAfter.discountedBaseAmount).to.be.eq(baseDebtDelta);

      const baseCollDelta = positionBefore.discountedBaseAmount;
      expect(discountedBaseCollateralBefore - discountedBaseCollateralAfter).to.be.eq(baseCollDelta);

      const quoteCollDelta =
        (((((positionBefore.discountedBaseAmount * price) / FP96.one) * (10n ** 6n - swapFee)) / 10n ** 6n) *
          baseCollateralCoeff) /
          quoteCollateralCoeff +
        (((((price * shortAmount) / FP96.one) * (10n ** 6n - swapFee)) / 10n ** 6n + quoteDepositSecond) * FP96.one) /
          quoteCollateralCoeff -
        (quoteDebtDelta * quoteDebtCoeff) / quoteCollateralCoeff;

      expect(positionAfter.discountedQuoteAmount).to.be.closeTo(quoteCollDelta, 1);
      expect(discountedQuoteCollateralAfter - discountedQuoteCollateralBefore).to.be.closeTo(quoteCollDelta, 1);
    });

    it('depositQuote and short into short position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, 10000, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      const firstDeposit = 1000;
      const shortAmount1 = 63;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, firstDeposit, shortAmount1, price, false, ZeroAddress, uniswapV3Swapdata());

      const positionBefore = await marginlyPool.positions(signer.address);
      expect(positionBefore._type).to.be.equal(PositionType.Short);

      const quoteDepositSecond = 300;
      const shortAmount2 = 100;
      await marginlyPool
        .connect(signer)
        .execute(
          CallType.DepositQuote,
          quoteDepositSecond,
          shortAmount2,
          price,
          false,
          ZeroAddress,
          uniswapV3Swapdata()
        );
      expect(positionBefore._type).to.be.equal(PositionType.Short);
    });

    it('depositQuote should wrap ETH to WETH', async () => {
      const { marginlyPool, quoteContract } = await loadFixture(createMarginlyPoolQuoteTokenIsWETH);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const depositAmount = 1000;
      await quoteContract.connect(signer).approve(marginlyPool, 0);
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata(), {
          value: depositAmount,
        });

      // check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Lend);
      expect(position.discountedBaseAmount).to.be.equal(0);
      expect(position.discountedQuoteAmount).to.be.equal(depositAmount);
      expect(position.heapPosition).to.be.equal(0);
    });
  });

  describe('Withdraw base', () => {
    it('should raise error when trying to withdraw zero amount', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      await expect(
        marginlyPool
          .connect(signer)
          .execute(CallType.WithdrawBase, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'ZeroAmount');
    });

    it('should raise error when position not initialized', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer1, signer2] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 654;
      await marginlyPool
        .connect(signer1)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToWithdraw = 89;
      await expect(
        marginlyPool
          .connect(signer2)
          .execute(CallType.WithdrawBase, amountToWithdraw, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'UninitializedPosition');
    });

    it('should decrease base position', async () => {
      const { marginlyPool, baseContract } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 1000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToWithdraw = 374;
      const tx = await marginlyPool
        .connect(signer)
        .execute(CallType.WithdrawBase, amountToWithdraw, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      const receipt = await tx.wait();
      expect(receipt?.logs).to.be.not.undefined;

      const withdrawBaseEvent = receipt?.logs
        ?.filter((log) => log instanceof EventLog)
        .find((x) => x.eventName === 'WithdrawBase');
      expect(withdrawBaseEvent?.args?.user).to.be.equal(signer.address);
      expect(withdrawBaseEvent?.args?.amount).to.be.equal(amountToWithdraw);

      const expectedRBC = amountToDeposit - amountToWithdraw;
      const expectedDBC = convertFP96ToNumber(await marginlyPool.baseCollateralCoeff()) * expectedRBC;
      const expectedDQC = convertFP96ToNumber(await marginlyPool.quoteCollateralCoeff()) * amountToDeposit;

      // check aggregates
      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC);
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC);
      expect(await marginlyPool.discountedQuoteDebt()).to.be.equal(0);
      expect(await marginlyPool.discountedBaseDebt()).to.be.equal(0);
      expect(await baseContract.balanceOf(marginlyPool)).to.be.equal(amountToDeposit - amountToWithdraw);

      //check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Lend);
      expect(position.discountedBaseAmount).to.be.equal(expectedDBC);
      expect(position.discountedQuoteAmount).to.be.equal(expectedDQC);
    });

    it('withdraw with position removing', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 1000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      await marginlyPool
        .connect(signer)
        .execute(CallType.WithdrawQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer)
        .execute(CallType.WithdrawBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      //check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Uninitialized);
      expect(position.discountedBaseAmount).to.be.eq(0);
      expect(position.discountedQuoteAmount).to.be.eq(0);
    });

    it('withdrawBase should unwrap WETH to ETH', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const params = await marginlyPool.params();
      const newParams = {
        maxLeverage: params.maxLeverage,
        interestRate: params.interestRate,
        fee: params.fee,
        swapFee: params.swapFee,
        mcSlippage: params.mcSlippage,
        positionMinAmount: params.positionMinAmount,
        quoteLimit: 4000n * 10n ** 18n,
      };
      await marginlyPool.setParameters(newParams);

      const amountToDeposit = 2n * 10n ** 18n; //2 ETH
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const balanceBefore = await signer.provider.getBalance(signer);
      const amountToWithdraw = 2n * 10n ** 18n; //1 ETH
      const tx = await (
        await marginlyPool
          .connect(signer)
          .execute(CallType.WithdrawBase, amountToWithdraw, 0, price, true, ZeroAddress, uniswapV3Swapdata())
      ).wait();
      const balanceAfter = await signer.provider.getBalance(signer);
      expect(tx).to.be.not.null;
      const txFee = tx!.gasUsed * tx!.gasPrice;

      expect(balanceBefore - txFee + amountToWithdraw).to.be.equal(balanceAfter);
    });

    it('should raise error when trying to withdraw from short position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, shorter] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const amountToDeposit = 1000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const shortDeposit = 100;
      const shortAmount = 10;
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositQuote, shortDeposit, shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToWithdraw = 10;
      await expect(
        marginlyPool
          .connect(shorter)
          .execute(CallType.WithdrawBase, amountToWithdraw, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'WrongPositionType');
    });

    it('positionMinAmount violation', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, longer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const amountToDeposit = 1000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const longDeposit = (await marginlyPool.params()).positionMinAmount;
      const longAmount = 20;
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, longDeposit, longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToWithdraw = 5;
      await expect(
        marginlyPool
          .connect(longer)
          .execute(CallType.WithdrawBase, amountToWithdraw, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'LessThanMinimalAmount');
    });
  });

  describe('Withdraw quote', () => {
    it('should raise error when trying to withdraw zero amount', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      await expect(
        marginlyPool
          .connect(signer)
          .execute(CallType.WithdrawQuote, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'ZeroAmount');
    });

    it('should raise error when position not initialized', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer1, signer2] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 543;
      await marginlyPool
        .connect(signer1)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToWithdraw = 125;
      await expect(
        marginlyPool
          .connect(signer2)
          .execute(CallType.WithdrawQuote, amountToWithdraw, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'UninitializedPosition');
    });

    it('should decrease quote position', async () => {
      const { marginlyPool, quoteContract } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 1000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToWithdraw = 589;
      const tx = await marginlyPool
        .connect(signer)
        .execute(CallType.WithdrawQuote, amountToWithdraw, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      const receipt = await tx.wait();
      expect(receipt?.logs).to.be.not.undefined;

      const withdrawQuoteEvent = receipt?.logs
        ?.filter((log) => log instanceof EventLog)
        .find((x) => x.eventName === 'WithdrawQuote');
      expect(withdrawQuoteEvent?.args?.user).to.be.equal(signer.address);
      expect(withdrawQuoteEvent?.args?.amount).to.be.equal(amountToWithdraw);

      const expectedRQC = amountToDeposit - amountToWithdraw;
      const expectedDQC = convertFP96ToNumber(await marginlyPool.quoteCollateralCoeff()) * expectedRQC;
      const expectedDBC = convertFP96ToNumber(await marginlyPool.baseCollateralCoeff()) * amountToDeposit;

      // check aggregates
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC);
      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC);
      expect(await marginlyPool.discountedQuoteDebt()).to.be.equal(0);
      expect(await marginlyPool.discountedBaseDebt()).to.be.equal(0);
      expect(await quoteContract.balanceOf(marginlyPool)).to.be.equal(amountToDeposit - amountToWithdraw);

      //check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Lend);
      expect(position.discountedBaseAmount).to.be.equal(expectedDBC);
      expect(position.discountedQuoteAmount).to.be.equal(expectedDQC);
    });

    it('reinit', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, user1, user2] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const timeShift = 300 * 24 * 60 * 60;

      const user1BaseDeposit = 1000;
      const user1LongAmount = 1500;

      const user2QuoteDeposit = 5000;
      const user2ShortAmount = 600;

      await marginlyPool
        .connect(user1)
        .execute(CallType.DepositBase, user1BaseDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(user2)
        .execute(CallType.DepositQuote, user2QuoteDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      await marginlyPool
        .connect(user1)
        .execute(CallType.Long, user1LongAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(user2)
        .execute(CallType.Short, user2ShortAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const prevMarginlyPoolState = await getMarginlyPoolState(marginlyPool);

      await time.increase(timeShift);
      await marginlyPool.execute(CallType.Reinit, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      await assertAccruedRateCoeffs(marginlyPool, prevMarginlyPoolState);
    });

    it('withdraw with position removing', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 1000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      await marginlyPool
        .connect(signer)
        .execute(CallType.WithdrawBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer)
        .execute(CallType.WithdrawQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      //check position
      const position = await marginlyPool.positions(signer.address);
      expect(position._type).to.be.equal(PositionType.Uninitialized);
      expect(position.discountedBaseAmount).to.be.eq(0);
      expect(position.discountedQuoteAmount).to.be.eq(0);
    });

    it('withdrawQuote should unwrap WETH to ETH', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPoolQuoteTokenIsWETH);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const params = await marginlyPool.params();
      const newParams = {
        maxLeverage: params.maxLeverage,
        interestRate: params.interestRate,
        fee: params.fee,
        swapFee: params.swapFee,
        mcSlippage: params.mcSlippage,
        positionMinAmount: params.positionMinAmount,
        quoteLimit: 1000n * 10n ** 18n,
      };
      await marginlyPool.setParameters(newParams);

      const amountToDeposit = 2n * 10n ** 18n; //2 ETH
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const balanceBefore = await signer.provider.getBalance(signer);
      const amountToWithdraw = 2n * 10n ** 18n; //1 ETH
      const tx = await (
        await marginlyPool
          .connect(signer)
          .execute(CallType.WithdrawQuote, amountToWithdraw, 0, price, true, ZeroAddress, uniswapV3Swapdata())
      ).wait();
      const balanceAfter = await signer.provider.getBalance(signer);
      expect(tx).to.be.not.null;
      const txFee = tx!.gasUsed * tx!.gasPrice;

      expect(balanceBefore - txFee + amountToWithdraw).to.be.equal(balanceAfter);
    });

    it('should raise error when trying to withdraw from long position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, longer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const amountToDeposit = 1000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const longDeposit = 100;
      const longAmount = 10;
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, longDeposit, longAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToWithdraw = 10;
      await expect(
        marginlyPool
          .connect(longer)
          .execute(CallType.WithdrawQuote, amountToWithdraw, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'WrongPositionType');
    });
  });

  describe('Close position', () => {
    it('should raise error when attempt to close Uninitialized or Lend position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await expect(
        marginlyPool.execute(CallType.ClosePosition, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'WrongPositionType');

      const amountToDeposit = 1000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await expect(
        marginlyPool
          .connect(signer)
          .execute(CallType.ClosePosition, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'WrongPositionType');
    });

    it('close short slippage fail', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToDeposit = 1000;
      const amountOfShort = 100;

      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, amountOfShort, price, false, ZeroAddress, uniswapV3Swapdata());

      {
        const position = await marginlyPool.positions(signer.address);
        expect(position._type).to.be.equal(PositionType.Short);
      }

      await expect(
        marginlyPool
          .connect(signer)
          .execute(CallType.ClosePosition, 0, 0, (price * 99n) / 100n, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'SlippageLimit');
    });

    it('close long slippage fail', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToDeposit = 1000;
      const amountOfLong = 63;

      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, amountOfLong, price, false, ZeroAddress, uniswapV3Swapdata());

      await expect(
        marginlyPool
          .connect(signer)
          .execute(CallType.ClosePosition, 0, 0, (price * 101n) / 100n, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'SlippageLimit');
    });

    it('should close short position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToDeposit = 1000;
      const amountOfShort = 100;

      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, amountOfShort, price, false, ZeroAddress, uniswapV3Swapdata());

      {
        const position = await marginlyPool.positions(signer.address);
        expect(position._type).to.be.equal(PositionType.Short);
      }

      await marginlyPool
        .connect(signer)
        .execute(CallType.ClosePosition, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      {
        const position = await marginlyPool.positions(signer.address);
        expect(position.discountedBaseAmount).to.be.equal(0);
        expect(position._type).to.be.equal(PositionType.Lend);
        expect(position.heapPosition).to.be.equal(0);

        const DBD = await marginlyPool.discountedQuoteDebt();
        expect(DBD).to.be.equal(0);
      }
    });

    it('should close long position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToDeposit = 1000;
      const amountOfLong = 63;

      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, amountOfLong, price, false, ZeroAddress, uniswapV3Swapdata());

      await marginlyPool
        .connect(signer)
        .execute(CallType.ClosePosition, 0, 0, (price * 99n) / 100n, false, ZeroAddress, uniswapV3Swapdata());
      {
        const position = await marginlyPool.positions(signer.address);
        expect(position.discountedQuoteAmount).to.be.equal(0);
        expect(position._type).to.be.equal(PositionType.Lend);
        expect(position.heapPosition).to.be.equal(0);

        const DQD = await marginlyPool.discountedQuoteDebt();
        expect(DQD).to.be.equal(0);
      }
    });

    it('positionMinAmount violation', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, shorter] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const amountToDeposit = 1000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const shortDeposit = (price * (await marginlyPool.params()).positionMinAmount) / FP96.one;
      const shortAmount = 10;
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositQuote, shortDeposit, shortAmount, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToWithdraw = 1;
      await expect(
        marginlyPool
          .connect(shorter)
          .execute(CallType.WithdrawQuote, amountToWithdraw, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'LessThanMinimalAmount');
    });
  });

  describe('Sell collateral', () => {
    it('should raise error when attempt to sell collateral in Uninitialized or Lend position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await expect(
        marginlyPool.execute(CallType.SellCollateral, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'WrongPositionType');

      const amountToDeposit = 1000;
      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await expect(
        marginlyPool
          .connect(signer)
          .execute(CallType.SellCollateral, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'WrongPositionType');
    });

    it('sell collateral short slippage fail', async () => {
      const { marginlyPool, swapRouter } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToDeposit = 1000;
      const amountOfShort = 100;

      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, amountOfShort, price, false, ZeroAddress, uniswapV3Swapdata());

      {
        const position = await marginlyPool.positions(signer.address);
        expect(position._type).to.be.equal(PositionType.Short);
      }

      await expect(
        marginlyPool
          .connect(signer)
          .execute(CallType.SellCollateral, 0, 0, (price * 99n) / 100n, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(swapRouter, 'TooMuchRequested');
    });

    it('sell collateral long slippage fail', async () => {
      const { marginlyPool, swapRouter } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToDeposit = 1000;
      const amountOfLong = 63;

      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, amountOfLong, price, false, ZeroAddress, uniswapV3Swapdata());

      await expect(
        marginlyPool
          .connect(signer)
          .execute(CallType.SellCollateral, 0, 0, (price * 101n) / 100n, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(swapRouter, 'TooMuchRequested');
    });

    it('should sell collateral for short position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToDeposit = 1000;
      const amountOfShort = 100;

      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositQuote, amountToDeposit, amountOfShort, price, false, ZeroAddress, uniswapV3Swapdata());

      {
        const position = await marginlyPool.positions(signer.address);
        expect(position._type).to.be.equal(PositionType.Short);
      }

      await marginlyPool
        .connect(signer)
        .execute(CallType.SellCollateral, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      {
        const position = await marginlyPool.positions(signer.address);
        expect(position._type).to.be.equal(PositionType.Lend);
        expect(position.discountedBaseAmount).to.be.gt(0);
        expect(position.discountedQuoteAmount).to.be.equal(0);
        expect(position.heapPosition).to.be.equal(0);

        const DBD = await marginlyPool.discountedQuoteDebt();
        expect(DBD).to.be.equal(0);
      }
    });

    it('should sell collateral for long position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, signer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, 1000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToDeposit = 1000;
      const amountOfLong = 63;

      await marginlyPool
        .connect(signer)
        .execute(CallType.DepositBase, amountToDeposit, amountOfLong, price, false, ZeroAddress, uniswapV3Swapdata());

      await marginlyPool
        .connect(signer)
        .execute(CallType.SellCollateral, 0, 0, (price * 99n) / 100n, false, ZeroAddress, uniswapV3Swapdata());
      {
        const position = await marginlyPool.positions(signer.address);
        expect(position._type).to.be.equal(PositionType.Lend);
        expect(position.discountedBaseAmount).to.be.equal(0);
        expect(position.discountedQuoteAmount).to.be.gt(0);
        expect(position.heapPosition).to.be.equal(0);

        const DQD = await marginlyPool.discountedQuoteDebt();
        expect(DQD).to.be.equal(0);
      }
    });
  });

  describe('Short', () => {
    it('short, Uninitialized', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 10000;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const shortAmount = 1000;
      await expect(
        marginlyPool
          .connect(shorter)
          .execute(CallType.Short, shortAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'UninitializedPosition');
    });

    it('short minAmount violation', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 10000;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const shortAmount = 1;
      const shortDepositAmount = (price * (await marginlyPool.params()).positionMinAmount) / FP96.one - 1n;
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositQuote, shortDepositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await expect(
        marginlyPool
          .connect(shorter)
          .execute(CallType.Short, shortAmount, price, 0, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.rejectedWith('LessThanMinimalAmount()');
    });

    it('exceeds limit', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter, depositor] = await ethers.getSigners();
      const amountToDeposit = 450_000n;
      const basePrice = (await marginlyPool.getBasePrice()).inner;
      const shortAmount = (200_000n * FP96.one) / basePrice;

      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, shortAmount, 0, basePrice, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, basePrice, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositQuote, amountToDeposit, 0, basePrice, false, ZeroAddress, uniswapV3Swapdata());

      // 450 + 450 + 200 > 1000
      await expect(
        marginlyPool
          .connect(shorter)
          .execute(CallType.Short, shortAmount, 0, (basePrice * 99n) / 100n, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'ExceedsLimit');
    });

    it('slippage fail', async () => {
      const { marginlyPool, swapRouter } = await loadFixture(createMarginlyPool);
      const [_, shorter, depositor] = await ethers.getSigners();
      const amountToDeposit = 450_000;
      const basePrice = (await marginlyPool.getBasePrice()).inner;
      const shortAmount = 50_000;

      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, amountToDeposit, 0, basePrice, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, basePrice, false, ZeroAddress, uniswapV3Swapdata());

      await expect(
        marginlyPool
          .connect(shorter)
          .execute(
            CallType.DepositQuote,
            amountToDeposit,
            shortAmount,
            (basePrice * 101n) / 100n,
            false,
            ZeroAddress,
            uniswapV3Swapdata()
          )
      ).to.be.revertedWithCustomError(swapRouter, 'TooMuchRequested');
    });

    it('should not exceed quoteLimit when deposit base cover debt', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter, depositor] = await ethers.getSigners();
      const quoteAmountToDeposit = 450_000n;
      const basePrice = (await marginlyPool.getBasePrice()).inner;
      const baseAmountToDeposit = ((await marginlyPool.params()).quoteLimit * FP96.one) / basePrice;
      const price = (basePrice * 90n) / 100n;

      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, baseAmountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, quoteAmountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToShort = 200_000n;
      await marginlyPool
        .connect(shorter)
        .execute(
          CallType.DepositQuote,
          quoteAmountToDeposit,
          amountToShort,
          price,
          false,
          ZeroAddress,
          uniswapV3Swapdata()
        );

      //hard limit when cover debt and deposit
      await expect(
        marginlyPool
          .connect(shorter)
          .execute(CallType.DepositBase, baseAmountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'ExceedsLimit');
    });

    it('could exceed quoteLimit when deposit base amount', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter, depositor] = await ethers.getSigners();
      const quoteAmountToDeposit = 450_000;
      const basePrice = (await marginlyPool.getBasePrice()).inner;
      const baseAmountToDeposit = ((await marginlyPool.params()).quoteLimit * FP96.one) / basePrice;
      const price = (basePrice * 90n) / 100n;

      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, baseAmountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, quoteAmountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToShort = 200_000;
      await marginlyPool
        .connect(shorter)
        .execute(
          CallType.DepositQuote,
          quoteAmountToDeposit,
          amountToShort,
          price,
          false,
          ZeroAddress,
          uniswapV3Swapdata()
        );

      const additionalBaseDeposit = 205_000;

      //hard limit for lenders
      await expect(
        marginlyPool
          .connect(depositor)
          .execute(CallType.DepositBase, additionalBaseDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'ExceedsLimit');

      //soft limit for borrowers
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositBase, additionalBaseDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    });

    it('short should update leverageShort', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 10000;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const shortAmount = 1000;
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(shorter)
        .execute(CallType.Short, shortAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const position = await marginlyPool.positions(shorter.address);
      const shortHeapPositionKey = (await marginlyPool.getHeapPosition(position.heapPosition - 1n, true))[1].key;

      const expectedShortKey = calcShortSortKey(position.discountedQuoteAmount, position.discountedBaseAmount);

      expect(shortHeapPositionKey).to.be.equal(expectedShortKey);

      const leverageShort = await marginlyPool.shortLeverageX96();
      const expectedLeverageShort = calcLeverageShort(
        price,
        await marginlyPool.quoteCollateralCoeff(),
        await marginlyPool.baseDebtCoeff(),
        await marginlyPool.discountedQuoteCollateral(),
        await marginlyPool.discountedBaseDebt()
      );

      expect(leverageShort).to.be.equal(expectedLeverageShort);
    });

    it('short, changed from lend to short', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const one = FP96.one;
      const swapFee = 500_000n;
      const params = await marginlyPool.params();
      const newParams = {
        maxLeverage: params.maxLeverage,
        interestRate: params.interestRate,
        fee: params.fee,
        swapFee: swapFee,
        mcSlippage: params.mcSlippage,
        positionMinAmount: params.positionMinAmount,
        quoteLimit: params.quoteLimit,
      };
      await marginlyPool.setParameters(newParams);
      const amountToDeposit = 10000n;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const expectedDBC0 = ((await marginlyPool.baseCollateralCoeff()) * amountToDeposit) / one;
      const expectedDQC0 = ((await marginlyPool.quoteCollateralCoeff()) * amountToDeposit) / one;
      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC0);
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC0);

      const shorterPositionBefore = await marginlyPool.positions(shorter.address);
      expect(shorterPositionBefore._type).to.be.equal(PositionType.Lend);
      expect(shorterPositionBefore.discountedBaseAmount).to.be.equal(0);
      expect(shorterPositionBefore.discountedQuoteAmount).to.be.equal(expectedDQC0);

      const shortAmount = 1000n;
      await marginlyPool
        .connect(shorter)
        .execute(CallType.Short, shortAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const expectedDBC1 = ((await marginlyPool.baseCollateralCoeff()) * amountToDeposit) / one;
      const expectedRQC1 = amountToDeposit + ((WHOLE_ONE - swapFee) * shortAmount * price) / one / WHOLE_ONE;
      const expectedDQC1 = ((await marginlyPool.quoteCollateralCoeff()) * expectedRQC1) / one;
      const debtCoeff = await marginlyPool.baseDebtCoeff();
      const expectedRBD1 = shortAmount;
      const expectedDBD1 = (expectedRBD1 * one) / debtCoeff;

      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC1);
      expect(await marginlyPool.discountedBaseDebt()).to.be.equal(expectedDBD1);
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC1);
      expect(await marginlyPool.discountedQuoteDebt()).to.be.equal(0);

      const expectedLeverageShort = calcLeverageShort(
        price,
        await marginlyPool.quoteCollateralCoeff(),
        await marginlyPool.baseDebtCoeff(),
        await marginlyPool.discountedQuoteCollateral(),
        await marginlyPool.discountedBaseDebt()
      );
      expect(await marginlyPool.shortLeverageX96()).to.be.equal(expectedLeverageShort);

      const shorterPositionAfter = await marginlyPool.positions(shorter.address);
      expect(shorterPositionAfter._type).to.be.equal(PositionType.Short);
      expect(shorterPositionAfter.discountedBaseAmount).to.be.eq(expectedDBD1);
      expect(shorterPositionAfter.discountedQuoteAmount).to.be.equal(expectedDQC1);
    });

    it('short, update short position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const swapFee = 500_000n;
      const params = await marginlyPool.params();
      const newParams = {
        maxLeverage: params.maxLeverage,
        interestRate: params.interestRate,
        fee: params.fee,
        swapFee: swapFee,
        mcSlippage: params.mcSlippage,
        positionMinAmount: params.positionMinAmount,
        quoteLimit: params.quoteLimit,
      };
      await marginlyPool.setParameters(newParams);
      const one = FP96.one;
      const amountToDeposit = 10000n;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const expectedDBC0 = ((await marginlyPool.baseCollateralCoeff()) * amountToDeposit) / one;
      const expectedDQC0 = ((await marginlyPool.quoteCollateralCoeff()) * amountToDeposit) / one;
      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC0);
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC0);

      const shorterPositionBefore = await marginlyPool.positions(shorter.address);
      expect(shorterPositionBefore._type).to.be.equal(PositionType.Lend);
      expect(shorterPositionBefore.discountedBaseAmount).to.be.equal(0);
      expect(shorterPositionBefore.discountedQuoteAmount).to.be.equal(expectedDQC0);

      const shortAmount = 1000n;
      await marginlyPool
        .connect(shorter)
        .execute(CallType.Short, shortAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const expectedDBC1 = ((await marginlyPool.baseCollateralCoeff()) * amountToDeposit) / one;
      const expectedRQC1 = amountToDeposit + ((WHOLE_ONE - swapFee) * shortAmount * price) / one / WHOLE_ONE;
      const expectedDQC1 = ((await marginlyPool.quoteCollateralCoeff()) * expectedRQC1) / one;
      const debtCoeff1 = await marginlyPool.baseDebtCoeff();
      const expectedDBD1 = (shortAmount * one) / debtCoeff1;

      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC1);
      expect(await marginlyPool.discountedBaseDebt()).to.be.equal(expectedDBD1);
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC1);
      expect(await marginlyPool.discountedQuoteDebt()).to.be.equal(0);

      const expectedLeverageShort1 = calcLeverageShort(
        price,
        await marginlyPool.quoteCollateralCoeff(),
        await marginlyPool.baseDebtCoeff(),
        await marginlyPool.discountedQuoteCollateral(),
        await marginlyPool.discountedBaseDebt()
      );
      expect(await marginlyPool.shortLeverageX96()).to.be.equal(expectedLeverageShort1);

      const shorterPositionAfter = await marginlyPool.positions(shorter.address);
      expect(shorterPositionAfter._type).to.be.equal(PositionType.Short);
      expect(shorterPositionAfter.discountedBaseAmount).to.be.equal(expectedDBD1);
      expect(shorterPositionAfter.discountedQuoteAmount).to.be.equal(expectedDQC1);

      const shortAmount2 = 2000n;
      await marginlyPool
        .connect(shorter)
        .execute(CallType.Short, shortAmount2, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const totalShortAmount = shortAmount + shortAmount2;
      const expectedDBC2 = ((await marginlyPool.baseCollateralCoeff()) * amountToDeposit) / one;
      const expectedRQC2 = amountToDeposit + ((WHOLE_ONE - swapFee) * totalShortAmount * price) / one / WHOLE_ONE;
      const expectedDQC2 = ((await marginlyPool.quoteCollateralCoeff()) * expectedRQC2) / one;
      const debtCoeff2 = await marginlyPool.baseDebtCoeff();

      const expectedDBD2 = (totalShortAmount * one) / debtCoeff2;
      const epsilon = 1n; // floating point with calculation error
      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC2);
      expect(await marginlyPool.discountedBaseDebt()).to.be.closeTo(expectedDBD2, epsilon);
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC2);
      expect(await marginlyPool.discountedQuoteDebt()).to.be.equal(0);

      const expectedLeverageShort2 = calcLeverageShort(
        price,
        await marginlyPool.quoteCollateralCoeff(),
        await marginlyPool.baseDebtCoeff(),
        await marginlyPool.discountedQuoteCollateral(),
        await marginlyPool.discountedBaseDebt()
      );
      expect(await marginlyPool.shortLeverageX96()).to.be.equal(expectedLeverageShort2);

      const shorterPositionAfterUpdate = await marginlyPool.positions(shorter.address);
      expect(shorterPositionAfterUpdate._type).to.be.equal(PositionType.Short);
      expect(shorterPositionAfterUpdate.discountedBaseAmount - expectedDBD2).to.be.lessThanOrEqual(epsilon);
      expect(shorterPositionAfterUpdate.discountedQuoteAmount).to.be.equal(expectedDQC2);
    });

    it('Amount in quote', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const swapFee = (await marginlyPool.params()).swapFee;

      const deposit = 100_000n;
      const shortAmountInQuote = 10_000n;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, deposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositQuote, deposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata());

      await marginlyPool
        .connect(shorter)
        .execute(CallType.Short, shortAmountInQuote, 0, price, true, ZeroAddress, uniswapV3Swapdata());
      const shortPosition = await marginlyPool.positions(shorter);

      expect(shortPosition._type).to.be.eq(PositionType.Short);

      const fee = (shortAmountInQuote * swapFee) / WHOLE_ONE;
      const expectedDiscountedQuoteCollateral =
        ((shortAmountInQuote - fee + deposit) * FP96.one) / (await marginlyPool.quoteCollateralCoeff());
      expect(shortPosition.discountedQuoteAmount).to.be.eq(expectedDiscountedQuoteCollateral);
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.eq(expectedDiscountedQuoteCollateral);

      const expectedDiscountedBaseDebt =
        (((shortAmountInQuote * FP96.one) / price) * FP96.one) / (await marginlyPool.baseDebtCoeff());
      expect(shortPosition.discountedBaseAmount).to.be.eq(expectedDiscountedBaseDebt);
      expect(await marginlyPool.discountedBaseDebt()).to.be.eq(expectedDiscountedBaseDebt);
    });
  });

  describe('Long', () => {
    it('uninitialized', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 10000;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const longAmount = 1000;

      await expect(
        marginlyPool
          .connect(longer)
          .execute(CallType.Long, longAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'UninitializedPosition');
    });

    it('long minAmount violation', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 10000;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const longDepositAmount = (await marginlyPool.params()).positionMinAmount - 1n;
      const longAmount = 1;
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, longDepositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await expect(
        marginlyPool
          .connect(longer)
          .execute(CallType.Long, longAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.rejectedWith('LessThanMinimalAmount()');
    });

    it('exceeds limit', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const baseAmountToDeposit = 400_000n;
      const quoteLimit = (await marginlyPool.params()).quoteLimit;
      const longAmount = ((quoteLimit + 1n) * FP96.one) / price - 2n * baseAmountToDeposit;

      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, baseAmountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, quoteLimit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, baseAmountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      await expect(
        marginlyPool
          .connect(longer)
          .execute(CallType.Long, longAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'ExceedsLimit');
    });

    it('slippage fail', async () => {
      const { marginlyPool, quoteContract } = await loadFixture(createMarginlyPool);
      const [_, longer, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 400_000;

      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const longAmount = 50_000;
      await expect(
        marginlyPool
          .connect(longer)
          .execute(
            CallType.DepositBase,
            amountToDeposit,
            longAmount,
            (price * 99n) / 100n,
            false,
            ZeroAddress,
            uniswapV3Swapdata()
          )
      ).to.be.revertedWithCustomError(quoteContract, 'ERC20InsufficientAllowance');
    });

    it('should not exceed quoteLimit when deposit base cover debt', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const baseAmountToDeposit = 400_000;
      const quoteLimit = (await marginlyPool.params()).quoteLimit;
      const quoteAmountToDeposit = quoteLimit;

      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, baseAmountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, quoteAmountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToLong = 400_000; // = 100_006 in quote
      await marginlyPool
        .connect(longer)
        .execute(
          CallType.DepositBase,
          baseAmountToDeposit,
          amountToLong,
          price,
          false,
          ZeroAddress,
          uniswapV3Swapdata()
        );

      //hard limit when cover debt and deposit
      await expect(
        marginlyPool
          .connect(longer)
          .execute(CallType.DepositQuote, quoteAmountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'ExceedsLimit');
    });

    it('could exceed quoteLimit when deposit quote amount', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const baseAmountToDeposit = 400_000;
      const quoteLimit = (await marginlyPool.params()).quoteLimit;
      const quoteAmountToDeposit = quoteLimit;

      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, baseAmountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, quoteAmountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToLong = 400_000; // = 100_006 in quote
      await marginlyPool
        .connect(longer)
        .execute(
          CallType.DepositBase,
          baseAmountToDeposit,
          amountToLong,
          price,
          false,
          ZeroAddress,
          uniswapV3Swapdata()
        );

      const quoteBalanceLeft =
        (await marginlyPool.params()).quoteLimit -
        (((await marginlyPool.discountedQuoteCollateral()) * (await marginlyPool.quoteCollateralCoeff())) / FP96.one -
          ((await marginlyPool.discountedQuoteDebt()) * (await marginlyPool.quoteDebtCoeff())) / FP96.one) +
        2n; // precision loss

      //hard limit for lenders
      await expect(
        marginlyPool
          .connect(depositor)
          .execute(CallType.DepositQuote, quoteBalanceLeft, 0, price, false, ZeroAddress, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'ExceedsLimit');

      //soft limit for borrowers
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositQuote, quoteBalanceLeft, 0, price, false, ZeroAddress, uniswapV3Swapdata());
    });

    it('long should update leverageLong', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const amountToDeposit = 10000;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const shortAmount = 1000;
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(longer)
        .execute(CallType.Long, shortAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const position = await marginlyPool.positions(longer.address);
      const basePrice = await marginlyPool.getBasePrice();
      const longHeapPositionKey = (await marginlyPool.getHeapPosition(position.heapPosition - 1n, false))[1].key;

      const expectedSortKey = calcLongSortKey(position.discountedQuoteAmount, position.discountedBaseAmount);

      expect(longHeapPositionKey).to.be.equal(expectedSortKey);
      const leverageLong = await marginlyPool.longLeverageX96();
      const expectedLeverageLong = calcLeverageLong(
        basePrice.inner,
        await marginlyPool.quoteDebtCoeff(),
        await marginlyPool.baseCollateralCoeff(),
        await marginlyPool.discountedQuoteDebt(),
        await marginlyPool.discountedBaseCollateral()
      );

      expect(leverageLong).to.be.equal(expectedLeverageLong);
    });

    it('changed from lend to long', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const swapFee = 100_000n;
      const one = FP96.one;
      const params = await marginlyPool.params();
      const newParams = {
        maxLeverage: params.maxLeverage,
        interestRate: params.interestRate,
        fee: params.fee,
        swapFee: swapFee,
        mcSlippage: params.mcSlippage,
        positionMinAmount: params.positionMinAmount,
        quoteLimit: params.quoteLimit,
      };
      await marginlyPool.setParameters(newParams);
      const amountToDeposit = 100000n;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const expectedDBC = ((await marginlyPool.baseCollateralCoeff()) * amountToDeposit) / one;
      const expectedDQC = ((await marginlyPool.quoteCollateralCoeff()) * amountToDeposit) / one;

      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC);
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC);

      const longerPositionBefore = await marginlyPool.positions(longer.address);
      expect(longerPositionBefore._type).to.be.equal(PositionType.Lend);
      expect(longerPositionBefore.discountedBaseAmount).to.be.equal(expectedDBC);
      expect(longerPositionBefore.discountedQuoteAmount).to.be.equal(0);

      const longAmount = 1000n;
      const quoteAmount = ((WHOLE_ONE + swapFee) * longAmount * price) / one / WHOLE_ONE;
      await marginlyPool
        .connect(longer)
        .execute(CallType.Long, longAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const expectedRBC1 = amountToDeposit + longAmount;
      const expectedDBC1 = ((await marginlyPool.baseCollateralCoeff()) * expectedRBC1) / one;
      const expectedDQC1 = ((await marginlyPool.quoteCollateralCoeff()) * amountToDeposit) / one;
      const debtCoeff = await marginlyPool.quoteDebtCoeff();
      const expectedDQD1 = (quoteAmount * one) / debtCoeff;
      const leverageLongDenom = expectedRBC1 - (quoteAmount * price) / one;

      const epsilon = 1n; // floating point with calculation error
      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC1);
      expect(await marginlyPool.discountedBaseDebt()).to.be.equal(0);
      expect((await marginlyPool.discountedQuoteDebt()) - expectedDQD1).to.be.lessThanOrEqual(epsilon);
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC1);

      const expectedLeverageLong = calcLeverageLong(
        price,
        await marginlyPool.quoteDebtCoeff(),
        await marginlyPool.baseCollateralCoeff(),
        await marginlyPool.discountedQuoteDebt(),
        await marginlyPool.discountedBaseCollateral()
      );
      expect(await marginlyPool.longLeverageX96()).to.be.equal(expectedLeverageLong);

      const longerPositionAfter = await marginlyPool.positions(longer.address);
      expect(longerPositionAfter._type).to.be.equal(PositionType.Long);
      expect(longerPositionAfter.discountedBaseAmount).to.be.equal(expectedDBC1);
      expect(longerPositionAfter.discountedQuoteAmount).to.be.closeTo(expectedDQD1, epsilon);
    });

    it('update long position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const swapFee = 0.1;
      const one = FP96.one;
      const params = await marginlyPool.params();
      const newParams = {
        maxLeverage: params.maxLeverage,
        interestRate: params.interestRate,
        fee: params.fee,
        swapFee: 100_000n,
        mcSlippage: params.mcSlippage,
        positionMinAmount: params.positionMinAmount,
        quoteLimit: params.quoteLimit,
      };
      await marginlyPool.setParameters(newParams);
      const amountToDeposit = 10000;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const expectedDBC = convertFP96ToNumber(await marginlyPool.baseCollateralCoeff()) * amountToDeposit;
      const expectedDQC = convertFP96ToNumber(await marginlyPool.quoteCollateralCoeff()) * amountToDeposit;

      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC);
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC);

      const longerPositionBefore = await marginlyPool.positions(longer.address);
      expect(longerPositionBefore._type).to.be.equal(PositionType.Lend);
      expect(longerPositionBefore.discountedBaseAmount).to.be.equal(amountToDeposit);
      expect(longerPositionBefore.discountedQuoteAmount).to.be.equal(0);

      const longAmount = 600;
      const quoteAmount = (BigInt((1.0 + swapFee) * longAmount) * price) / FP96.one;
      await marginlyPool
        .connect(longer)
        .execute(CallType.Long, longAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const expectedRBC1 = amountToDeposit + longAmount;
      const expectedDBC1 = convertFP96ToNumber(await marginlyPool.baseCollateralCoeff()) * expectedRBC1;
      const expectedDQC1 = convertFP96ToNumber(await marginlyPool.quoteCollateralCoeff()) * amountToDeposit;
      const debtCoeff = await marginlyPool.quoteDebtCoeff();
      const expectedDQD1 = (quoteAmount * FP96.one) / debtCoeff;

      const epsilon = 2n; // floating point with calculation error
      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC1);
      expect(await marginlyPool.discountedBaseDebt()).to.be.equal(0);
      expect(await marginlyPool.discountedQuoteDebt()).to.be.closeTo(expectedDQD1, epsilon);
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(expectedDQC1);

      const expectedLeverageLong1 = calcLeverageLong(
        price,
        await marginlyPool.quoteDebtCoeff(),
        await marginlyPool.baseCollateralCoeff(),
        await marginlyPool.discountedQuoteDebt(),
        await marginlyPool.discountedBaseCollateral()
      );
      expect(await marginlyPool.longLeverageX96()).to.be.equal(expectedLeverageLong1);

      const longerPositionAfter = await marginlyPool.positions(longer.address);
      expect(longerPositionAfter._type).to.be.equal(PositionType.Long);
      expect(longerPositionAfter.discountedBaseAmount).to.be.equal(expectedDBC1);
      expect(longerPositionAfter.discountedQuoteAmount).to.be.closeTo(expectedDQD1, epsilon);

      const longAmount2 = 2000;
      const totalLongAmount = longAmount + longAmount2;
      const quoteAmount2 = (BigInt((1.0 + swapFee) * longAmount2) * price) / FP96.one;
      const totalQuoteAmount = quoteAmount + quoteAmount2;
      await marginlyPool
        .connect(longer)
        .execute(CallType.Long, longAmount2, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const expectedRBC2 = amountToDeposit + longAmount + longAmount2;
      const expectedDBC2 = convertFP96ToNumber(await marginlyPool.baseCollateralCoeff()) * expectedRBC2;
      const expectedDQC2 = convertFP96ToNumber(await marginlyPool.quoteCollateralCoeff()) * amountToDeposit;
      const debtCoeff2 = await marginlyPool.quoteDebtCoeff();
      const expectedDQD2 = (totalQuoteAmount * one) / debtCoeff2;

      expect(await marginlyPool.discountedBaseCollateral()).to.be.equal(expectedDBC2);
      expect(await marginlyPool.discountedBaseDebt()).to.be.equal(0);
      expect(await marginlyPool.discountedQuoteDebt()).to.be.closeTo(expectedDQD2, epsilon);
      expect(await marginlyPool.discountedQuoteCollateral()).to.be.equal(Math.floor(expectedDQC2));

      const expectedLeverageLong2 = calcLeverageLong(
        price,
        await marginlyPool.quoteDebtCoeff(),
        await marginlyPool.baseCollateralCoeff(),
        await marginlyPool.discountedQuoteDebt(),
        await marginlyPool.discountedBaseCollateral()
      );
      expect(await marginlyPool.longLeverageX96()).to.be.equal(expectedLeverageLong2);

      const longerPositionAfterUpdate = await marginlyPool.positions(longer.address);
      expect(longerPositionAfterUpdate._type).to.be.equal(PositionType.Long);
      expect(longerPositionAfterUpdate.discountedBaseAmount).to.be.equal(expectedDBC2);
      expect(longerPositionAfterUpdate.discountedQuoteAmount).to.be.closeTo(expectedDQD2, epsilon);
    });

    it('Amount in quote', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer, lender] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const swapFee = (await marginlyPool.params()).swapFee;

      const deposit = 100_000n;
      const longAmountInQuote = 10_000n;
      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, deposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, deposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata());

      await marginlyPool
        .connect(longer)
        .execute(CallType.Long, longAmountInQuote, 0, price, true, ZeroAddress, uniswapV3Swapdata());
      const longPosition = await marginlyPool.positions(longer);

      expect(longPosition._type).to.be.eq(PositionType.Long);

      const fee = (longAmountInQuote * swapFee) / WHOLE_ONE;
      const expectedDiscountedQuoteDebt =
        ((longAmountInQuote + fee) * FP96.one) / (await marginlyPool.quoteDebtCoeff());
      expect(longPosition.discountedQuoteAmount).to.be.eq(expectedDiscountedQuoteDebt);
      expect(await marginlyPool.discountedQuoteDebt()).to.be.eq(expectedDiscountedQuoteDebt);

      const expectedDiscountedBaseCollateral =
        (((longAmountInQuote * FP96.one) / price + deposit) * FP96.one) / (await marginlyPool.baseCollateralCoeff());
      expect(longPosition.discountedBaseAmount).to.be.eq(expectedDiscountedBaseCollateral);
      expect(await marginlyPool.discountedBaseCollateral()).to.be.eq(expectedDiscountedBaseCollateral);
    });
  });

  describe('Flip', () => {
    it('Short with flip', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const swapFee = (await marginlyPool.params()).swapFee;

      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, 100000, 0, 0, false, ZeroAddress, uniswapV3Swapdata());

      const shorterBaseAmount = 10000n;
      const shortAmount = 50000n;
      const shorterQuoteAmount = 3000n;
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositBase, shorterBaseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositQuote, shorterQuoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata());

      const discountedBaseCollateralBefore = await marginlyPool.discountedBaseCollateral();
      const discountedQuoteCollateralBefore = await marginlyPool.discountedQuoteCollateral();
      const discountedBaseDebtBefore = await marginlyPool.discountedBaseDebt();
      const positionBefore = await marginlyPool.positions(shorter.address);

      await marginlyPool
        .connect(shorter)
        .execute(CallType.Short, shortAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const discountedBaseCollateralAfter = await marginlyPool.discountedBaseCollateral();
      const discountedQuoteCollateralAfter = await marginlyPool.discountedQuoteCollateral();
      const discountedBaseDebtAfter = await marginlyPool.discountedBaseDebt();
      const positionAfter = await marginlyPool.positions(shorter.address);

      const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
      const baseCollCoeff = await marginlyPool.baseCollateralCoeff();
      const quoteCollCoeff = await marginlyPool.quoteCollateralCoeff();

      const baseCollDelta = (shorterBaseAmount * FP96.one) / baseCollCoeff;
      const baseDebtDelta = (shortAmount * FP96.one) / baseDebtCoeff;

      const quoteCollDelta =
        ((shortAmount + shorterBaseAmount) * price * (10n ** 6n - swapFee)) / 10n ** 6n / quoteCollCoeff;

      expect(discountedBaseCollateralBefore - discountedBaseCollateralAfter).to.be.eq(baseCollDelta);
      expect(discountedQuoteCollateralAfter - discountedQuoteCollateralBefore).to.be.closeTo(quoteCollDelta, 1);
      expect(discountedBaseDebtAfter - discountedBaseDebtBefore).to.be.eq(baseDebtDelta);

      expect(positionAfter._type).to.be.eq(PositionType.Short);
      expect(positionAfter.discountedBaseAmount).to.be.eq(baseDebtDelta);
      expect(positionAfter.discountedQuoteAmount - positionBefore.discountedQuoteAmount).to.be.closeTo(
        quoteCollDelta,
        1
      );
    });

    it('Short with flip, amount in quote', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const swapFee = (await marginlyPool.params()).swapFee;

      const baseDepositAmount = 100_000n;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, baseDepositAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata());

      const shortAmount = 10000n;
      const shorterQuoteDeposit = 3000n;
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositBase, baseDepositAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(shorter)
        .execute(CallType.DepositQuote, shorterQuoteDeposit, 0, 0, false, ZeroAddress, uniswapV3Swapdata());

      const discountedBaseCollateralBefore = await marginlyPool.discountedBaseCollateral();
      const discountedQuoteCollateralBefore = await marginlyPool.discountedQuoteCollateral();
      const discountedBaseDebtBefore = await marginlyPool.discountedBaseDebt();
      const positionBefore = await marginlyPool.positions(shorter.address);

      await marginlyPool
        .connect(shorter)
        .execute(CallType.Short, shortAmount, 0, price / 2n, true, ZeroAddress, uniswapV3Swapdata());

      const discountedBaseCollateralAfter = await marginlyPool.discountedBaseCollateral();
      const discountedQuoteCollateralAfter = await marginlyPool.discountedQuoteCollateral();
      const discountedBaseDebtAfter = await marginlyPool.discountedBaseDebt();
      const positionAfter = await marginlyPool.positions(shorter.address);

      const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
      const baseCollCoeff = await marginlyPool.baseCollateralCoeff();
      const quoteCollCoeff = await marginlyPool.quoteCollateralCoeff();

      const baseCollDelta = (baseDepositAmount * FP96.one) / baseCollCoeff;
      const baseDebtDelta = (((shortAmount * FP96.one) / price) * FP96.one) / baseDebtCoeff;

      const quoteCollDelta =
        (((baseDepositAmount * price) / FP96.one + shortAmount) * (WHOLE_ONE - swapFee) * FP96.one) /
        WHOLE_ONE /
        quoteCollCoeff;

      expect(discountedBaseCollateralBefore - discountedBaseCollateralAfter).to.be.eq(baseCollDelta);
      expect(discountedQuoteCollateralAfter - discountedQuoteCollateralBefore).to.be.eq(quoteCollDelta);
      expect(discountedBaseDebtAfter - discountedBaseDebtBefore).to.be.eq(baseDebtDelta);

      expect(positionAfter._type).to.be.eq(PositionType.Short);
      expect(positionAfter.discountedBaseAmount).to.be.eq(baseDebtDelta);
      expect(positionAfter.discountedQuoteAmount - positionBefore.discountedQuoteAmount).to.be.eq(quoteCollDelta);
    });

    it('Long with flip', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const swapFee = (await marginlyPool.params()).swapFee;

      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, 10000, 0, 0, false, ZeroAddress, uniswapV3Swapdata());

      const longerBaseAmount = 1000n;
      const longAmount = 5000n;
      const longerQuoteAmount = 3000n;
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, longerBaseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositQuote, longerQuoteAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata());

      const discountedBaseCollateralBefore = await marginlyPool.discountedBaseCollateral();
      const discountedQuoteCollateralBefore = await marginlyPool.discountedQuoteCollateral();
      const discountedQuoteDebtBefore = await marginlyPool.discountedQuoteDebt();
      const positionBefore = await marginlyPool.positions(longer.address);

      await marginlyPool
        .connect(longer)
        .execute(CallType.Long, longAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const discountedBaseCollateralAfter = await marginlyPool.discountedBaseCollateral();
      const discountedQuoteCollateralAfter = await marginlyPool.discountedQuoteCollateral();
      const discountedQuoteDebtAfter = await marginlyPool.discountedQuoteDebt();
      const positionAfter = await marginlyPool.positions(longer.address);

      const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
      const baseCollCoeff = await marginlyPool.baseCollateralCoeff();
      const quoteCollCoeff = await marginlyPool.quoteCollateralCoeff();

      const baseCollDelta =
        (((((longerQuoteAmount * (10n ** 6n - swapFee)) / 10n ** 6n) * FP96.one) / price + longAmount) * FP96.one) /
        baseCollCoeff;
      const quoteDebtDelta = (((longAmount * price) / quoteDebtCoeff) * (10n ** 6n + swapFee)) / 10n ** 6n;
      const quoteCollDelta = (longerQuoteAmount * FP96.one) / quoteCollCoeff;

      expect(discountedBaseCollateralAfter - discountedBaseCollateralBefore).to.be.eq(baseCollDelta);
      expect(discountedQuoteCollateralBefore - discountedQuoteCollateralAfter).to.be.eq(quoteCollDelta);
      expect(discountedQuoteDebtAfter - discountedQuoteDebtBefore).to.be.eq(quoteDebtDelta);

      expect(positionAfter._type).to.be.eq(PositionType.Long);
      expect(positionAfter.discountedQuoteAmount).to.be.eq(quoteDebtDelta);
      expect(positionAfter.discountedBaseAmount - positionBefore.discountedBaseAmount).to.be.eq(baseCollDelta);
    });

    it('Long with flip, amount in quote', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;
      const swapFee = (await marginlyPool.params()).swapFee;

      const quoteDepositAmount = 10_000n;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, quoteDepositAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata());

      const longerBaseAmount = 1000n;
      const longAmount = 5000n;
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositBase, longerBaseAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(longer)
        .execute(CallType.DepositQuote, quoteDepositAmount, 0, 0, false, ZeroAddress, uniswapV3Swapdata());

      const discountedBaseCollateralBefore = await marginlyPool.discountedBaseCollateral();
      const discountedQuoteCollateralBefore = await marginlyPool.discountedQuoteCollateral();
      const discountedQuoteDebtBefore = await marginlyPool.discountedQuoteDebt();
      const positionBefore = await marginlyPool.positions(longer.address);

      await marginlyPool
        .connect(longer)
        .execute(CallType.Long, longAmount, 0, price * 2n, true, ZeroAddress, uniswapV3Swapdata());

      const discountedBaseCollateralAfter = await marginlyPool.discountedBaseCollateral();
      const discountedQuoteCollateralAfter = await marginlyPool.discountedQuoteCollateral();
      const discountedQuoteDebtAfter = await marginlyPool.discountedQuoteDebt();
      const positionAfter = await marginlyPool.positions(longer.address);

      const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
      const baseCollCoeff = await marginlyPool.baseCollateralCoeff();
      const quoteCollCoeff = await marginlyPool.quoteCollateralCoeff();

      const quoteDebtDelta = (((longAmount * FP96.one) / quoteDebtCoeff) * (WHOLE_ONE + swapFee)) / WHOLE_ONE;
      const quoteCollDelta = (quoteDepositAmount * FP96.one) / quoteCollCoeff;

      const quoteDeltaFromFlip = (quoteDepositAmount * (WHOLE_ONE - swapFee)) / WHOLE_ONE;
      const quoteDeltaFromLong = longAmount;
      const baseCollDelta =
        ((((quoteDeltaFromFlip + quoteDeltaFromLong) * FP96.one) / price) * FP96.one) / baseCollCoeff;

      expect(discountedBaseCollateralAfter - discountedBaseCollateralBefore).to.be.eq(baseCollDelta);
      expect(discountedQuoteCollateralBefore - discountedQuoteCollateralAfter).to.be.eq(quoteCollDelta);
      expect(discountedQuoteDebtAfter - discountedQuoteDebtBefore).to.be.eq(quoteDebtDelta);

      expect(positionAfter._type).to.be.eq(PositionType.Long);
      expect(positionAfter.discountedQuoteAmount).to.be.eq(quoteDebtDelta);
      expect(positionAfter.discountedBaseAmount - positionBefore.discountedBaseAmount).to.be.eq(baseCollDelta);
    });
  });

  describe('Position sort keys', () => {
    it('should properly calculate sort key for long position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer1, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const amountToDeposit = 10000;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(longer1)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToLong = 250;
      await marginlyPool
        .connect(longer1)
        .execute(CallType.Long, amountToLong, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const position1 = await marginlyPool.positions(longer1.address);
      const [success, node] = await marginlyPool.getHeapPosition(position1.heapPosition - 1n, false);
      expect(success).to.be.true;

      const longSortKeyX48 = node.key;

      const expectedLongSortKeyX48 = (position1.discountedQuoteAmount * FP48.Q48) / position1.discountedBaseAmount;

      expect(longSortKeyX48).to.be.equal(expectedLongSortKeyX48);
    });

    it('should properly calculate sort key for short position', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter1, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const amountToDeposit = 10000;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(shorter1)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const amountToLong = 25;
      await marginlyPool
        .connect(shorter1)
        .execute(CallType.Short, amountToLong, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const position1 = await marginlyPool.positions(shorter1.address);
      const [success, node] = await marginlyPool.getHeapPosition(position1.heapPosition - 1n, true);
      expect(success).to.be.true;

      const shortSortKeyX48 = node.key;

      const expectedShortSortKeyX48 = (position1.discountedBaseAmount * FP48.Q48) / position1.discountedQuoteAmount;

      expect(shortSortKeyX48).to.be.equal(expectedShortSortKeyX48);
    });

    it('long position sortKey', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, longer1, longer2, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const amountToDeposit = 10000;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const longAmount1 = 10;
      await marginlyPool
        .connect(longer1)
        .execute(CallType.DepositBase, amountToDeposit, longAmount1, price, false, ZeroAddress, uniswapV3Swapdata());

      const longAmount2 = 25;
      await marginlyPool
        .connect(longer2)
        .execute(CallType.DepositBase, amountToDeposit, longAmount2, price, false, ZeroAddress, uniswapV3Swapdata());

      const position1 = await marginlyPool.positions(longer1.address);
      const position2 = await marginlyPool.positions(longer2.address);

      expect(position2.heapPosition).to.be.lessThan(position1.heapPosition);
    });

    it('short position sortKey', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [_, shorter1, shorter2, shorter3, depositor] = await ethers.getSigners();
      const price = (await marginlyPool.getBasePrice()).inner;

      const amountToDeposit = 10000;
      await marginlyPool
        .connect(depositor)
        .execute(CallType.DepositBase, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      const shortAmount1 = 10;
      await marginlyPool
        .connect(shorter1)
        .execute(CallType.DepositQuote, amountToDeposit, shortAmount1, price, false, ZeroAddress, uniswapV3Swapdata());

      const shortAmount2 = 25;
      await marginlyPool
        .connect(shorter2)
        .execute(CallType.DepositQuote, amountToDeposit, shortAmount2, price, false, ZeroAddress, uniswapV3Swapdata());
      await marginlyPool
        .connect(shorter3)
        .execute(CallType.DepositQuote, amountToDeposit, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      let position1 = await marginlyPool.positions(shorter1.address);
      let position2 = await marginlyPool.positions(shorter2.address);

      expect(position2.heapPosition).to.be.lessThan(position1.heapPosition);

      const shortAmount3 = 45;
      await marginlyPool
        .connect(shorter3)
        .execute(CallType.Short, shortAmount3, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      position1 = await marginlyPool.positions(shorter1.address);
      position2 = await marginlyPool.positions(shorter2.address);
      const position3 = await marginlyPool.positions(shorter3.address);

      expect(position1.heapPosition).to.be.equal(2);
      expect(position2.heapPosition).to.be.equal(3);
      expect(position3.heapPosition).to.be.equal(1);
    });
  });

  it('should limit system leverage after long liquidation', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [, longer1, longer2, depositor] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;
    console.log(price);

    const depositAmount = 40000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollateral1 = 100;
    const longAmount1 = 1800;
    await marginlyPool
      .connect(longer1)
      .execute(CallType.DepositBase, baseCollateral1, longAmount1, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollateral2 = 100;
    const longAmount2 = 1780;
    await marginlyPool
      .connect(longer2)
      .execute(CallType.DepositBase, baseCollateral2, longAmount2, price, false, ZeroAddress, uniswapV3Swapdata());

    const longer1PositionBefore = await marginlyPool.positions(longer1.address);
    expect(longer1PositionBefore.heapPosition).to.be.eq(1);

    const longer2PositionBefore = await marginlyPool.positions(longer2.address);
    expect(longer2PositionBefore.heapPosition).to.be.eq(2);

    const systemLeverageLongBefore = convertFP96ToNumber(await marginlyPool.longLeverageX96());
    expect(systemLeverageLongBefore).to.be.lessThan(20);

    // wait 2 days for accrue interest
    const timeShift = 2 * 24 * 60 * 60;
    await time.increase(timeShift);

    await marginlyPool
      .connect(depositor)
      .execute(CallType.Reinit, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const longer1PositionAfter = await marginlyPool.positions(longer1.address);
    expect(longer1PositionAfter.heapPosition).to.be.eq(0);

    const longer2PositionAfter = await marginlyPool.positions(longer2.address);
    expect(longer2PositionAfter.heapPosition).to.be.eq(1);

    const basePrice = await marginlyPool.getBasePrice();
    const longer2LeverageAfter = convertFP96ToNumber(
      calcLeverageLong(
        basePrice.inner,
        await marginlyPool.quoteDebtCoeff(),
        await marginlyPool.baseCollateralCoeff(),
        longer2PositionAfter.discountedQuoteAmount,
        longer2PositionAfter.discountedBaseAmount
      )
    );
    expect(longer2LeverageAfter).to.be.greaterThan(20);

    const systemLeverageLongAfter = convertFP96ToNumber(await marginlyPool.longLeverageX96());
    expect(systemLeverageLongAfter).to.be.eq(20);
  });

  it('should limit system leverage after short liquidation', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [, shorter1, shorter2, depositor] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 40000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const quoteCollateral1 = 100;
    const shortAmount1 = 7500;
    await marginlyPool
      .connect(shorter1)
      .execute(CallType.DepositQuote, quoteCollateral1, shortAmount1, price, false, ZeroAddress, uniswapV3Swapdata());

    const quoteCollateral2 = 100;
    const shortAmount2 = 7400;
    await marginlyPool
      .connect(shorter2)
      .execute(CallType.DepositQuote, quoteCollateral2, shortAmount2, price, false, ZeroAddress, uniswapV3Swapdata());

    const shorter1PositionBefore = await marginlyPool.positions(shorter1.address);
    expect(shorter1PositionBefore.heapPosition).to.be.eq(1);

    const shorter2PositionBefore = await marginlyPool.positions(shorter2.address);
    expect(shorter2PositionBefore.heapPosition).to.be.eq(2);

    const systemLeverageShortBefore = convertFP96ToNumber(await marginlyPool.shortLeverageX96());
    expect(systemLeverageShortBefore).to.be.lessThan(20);

    // wait 2 days for accrue interest
    const timeShift = 2 * 24 * 60 * 60;
    await time.increase(timeShift);

    await marginlyPool
      .connect(depositor)
      .execute(CallType.Reinit, 0, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const shorter1PositionAfter = await marginlyPool.positions(shorter1.address);
    expect(shorter1PositionAfter.heapPosition).to.be.eq(0);

    const shorter2PositionAfter = await marginlyPool.positions(shorter2.address);
    expect(shorter2PositionAfter.heapPosition).to.be.eq(1);

    const basePrice = await marginlyPool.getBasePrice();
    const shorter2LeverageAfter = convertFP96ToNumber(
      calcLeverageShort(
        basePrice.inner,
        await marginlyPool.quoteCollateralCoeff(),
        await marginlyPool.baseDebtCoeff(),
        shorter2PositionAfter.discountedQuoteAmount,
        shorter2PositionAfter.discountedBaseAmount
      )
    );
    expect(shorter2LeverageAfter).to.be.greaterThan(20);

    const systemLeverageShortAfter = convertFP96ToNumber(await marginlyPool.shortLeverageX96());
    expect(systemLeverageShortAfter).to.be.eq(20);
  });

  it('systemLeverageShort update after caller MC: worst position', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [, shorter1, shorter2, depositor] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 40000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const quoteCollateral1 = 100;
    const shortAmount1 = 7500;
    await marginlyPool
      .connect(shorter1)
      .execute(CallType.DepositQuote, quoteCollateral1, shortAmount1, price, false, ZeroAddress, uniswapV3Swapdata());

    const quoteCollateral2 = 100;
    const shortAmount2 = 2000;
    await marginlyPool
      .connect(shorter2)
      .execute(CallType.DepositQuote, quoteCollateral2, shortAmount2, price, false, ZeroAddress, uniswapV3Swapdata());

    // wait 2 days for accrue interest
    const timeShift = 2 * 24 * 60 * 60;
    await time.increase(timeShift);

    const shorterToCheck = shorter1;
    const worstPositionData = await marginlyPool.getHeapPosition(0, true);
    expect(worstPositionData.success).to.be.true;
    expect(worstPositionData[1].account).to.be.eq(shorterToCheck.address);

    await marginlyPool
      .connect(shorterToCheck)
      .execute(CallType.DepositBase, 100, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const shorterToCheckPositionAfter = await marginlyPool.positions(shorterToCheck.address);
    expect(shorterToCheckPositionAfter.heapPosition).to.be.eq(0);

    const basePrice = (await marginlyPool.getBasePrice()).inner;
    const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
    const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
    const discountedQuoteCollateral = await marginlyPool.discountedQuoteCollateral();
    const discountedBaseDebt = await marginlyPool.discountedBaseDebt();

    const realQuoteCollateral = (quoteCollateralCoeff * discountedQuoteCollateral) / FP96.one;
    const realBaseDebt = (baseDebtCoeff * discountedBaseDebt) / FP96.one;
    const realBaseDebtInQuote = (realBaseDebt * basePrice) / FP96.one;

    const expectedSystemLeverageShort = (realQuoteCollateral * FP96.one) / (realQuoteCollateral - realBaseDebtInQuote);
    expect(await marginlyPool.shortLeverageX96()).to.be.eq(expectedSystemLeverageShort);
  });

  it('systemLeverageShort update after caller MC: not worst position', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [, shorter1, shorter2, shorter3, depositor] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 40000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositBase, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const quoteCollateral1 = 100;
    const shortAmount1 = 7500;
    await marginlyPool
      .connect(shorter1)
      .execute(CallType.DepositQuote, quoteCollateral1, shortAmount1, price, false, ZeroAddress, uniswapV3Swapdata());

    const quoteCollateral2 = 100;
    const shortAmount2 = 7400;
    await marginlyPool
      .connect(shorter2)
      .execute(CallType.DepositQuote, quoteCollateral2, shortAmount2, price, false, ZeroAddress, uniswapV3Swapdata());

    const quoteCollateral3 = 100;
    const shortAmount3 = 2000;
    await marginlyPool
      .connect(shorter3)
      .execute(CallType.DepositQuote, quoteCollateral3, shortAmount3, price, false, ZeroAddress, uniswapV3Swapdata());

    // wait 2 days for accrue interest
    const timeShift = 2 * 24 * 60 * 60;
    await time.increase(timeShift);

    const shorterToCheck = shorter2;
    const secondWorstPositionData = await marginlyPool.getHeapPosition(1, true);
    expect(secondWorstPositionData.success).to.be.true;
    expect(secondWorstPositionData[1].account).to.be.eq(shorterToCheck.address);

    await marginlyPool
      .connect(shorterToCheck)
      .execute(CallType.DepositBase, 100, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const shorterToCheckPositionAfter = await marginlyPool.positions(shorterToCheck.address);
    expect(shorterToCheckPositionAfter.heapPosition).to.be.eq(0);

    const basePrice = (await marginlyPool.getBasePrice()).inner;
    const quoteCollateralCoeff = await marginlyPool.quoteCollateralCoeff();
    const baseDebtCoeff = await marginlyPool.baseDebtCoeff();
    const discountedQuoteCollateral = await marginlyPool.discountedQuoteCollateral();
    const discountedBaseDebt = await marginlyPool.discountedBaseDebt();

    const realQuoteCollateral = (quoteCollateralCoeff * discountedQuoteCollateral) / FP96.one;
    const realBaseDebt = (baseDebtCoeff * discountedBaseDebt) / FP96.one;
    const realBaseDebtInQuote = (realBaseDebt * basePrice) / FP96.one;

    const expectedSystemLeverageShort = (realQuoteCollateral * FP96.one) / (realQuoteCollateral - realBaseDebtInQuote);
    expect(await marginlyPool.shortLeverageX96()).to.be.eq(expectedSystemLeverageShort);
  });

  it('systemLeverageLong update after caller MC: worst position', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [, longer1, longer2, depositor] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 40000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollateral1 = 100;
    const longAmount1 = 1800;
    await marginlyPool
      .connect(longer1)
      .execute(CallType.DepositBase, baseCollateral1, longAmount1, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollateral2 = 100;
    const longAmount2 = 1000;
    await marginlyPool
      .connect(longer2)
      .execute(CallType.DepositBase, baseCollateral2, longAmount2, price, false, ZeroAddress, uniswapV3Swapdata());

    // wait 2 days for accrue interest
    const timeShift = 2 * 24 * 60 * 60;
    await time.increase(timeShift);

    const longerToCheck = longer1;
    const worstPositionData = await marginlyPool.getHeapPosition(0, false);
    expect(worstPositionData.success).to.be.true;
    expect(worstPositionData[1].account).to.be.eq(longerToCheck.address);

    await marginlyPool
      .connect(longerToCheck)
      .execute(CallType.DepositBase, 100, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const longerToCheckPositionAfter = await marginlyPool.positions(longerToCheck.address);
    expect(longerToCheckPositionAfter.heapPosition).to.be.eq(0);

    const basePrice = (await marginlyPool.getBasePrice()).inner;
    const expectedSystemLeverageLong = calcLeverageLong(
      basePrice,
      await marginlyPool.quoteDebtCoeff(),
      await marginlyPool.baseCollateralCoeff(),
      await marginlyPool.discountedQuoteDebt(),
      await marginlyPool.discountedBaseCollateral()
    );
    expect(await marginlyPool.longLeverageX96()).to.be.eq(expectedSystemLeverageLong);
  });

  it('systemLeverageLong update after caller MC: not worst position', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    const [, longer1, longer2, longer3, depositor] = await ethers.getSigners();
    const price = (await marginlyPool.getBasePrice()).inner;

    const depositAmount = 40000;
    await marginlyPool
      .connect(depositor)
      .execute(CallType.DepositQuote, depositAmount, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollateral1 = 100;
    const longAmount1 = 1800;
    await marginlyPool
      .connect(longer1)
      .execute(CallType.DepositBase, baseCollateral1, longAmount1, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollateral2 = 100;
    const longAmount2 = 1780;
    await marginlyPool
      .connect(longer2)
      .execute(CallType.DepositBase, baseCollateral2, longAmount2, price, false, ZeroAddress, uniswapV3Swapdata());

    const baseCollateral3 = 100;
    const longAmount3 = 1000;
    await marginlyPool
      .connect(longer3)
      .execute(CallType.DepositBase, baseCollateral3, longAmount3, price, false, ZeroAddress, uniswapV3Swapdata());

    // wait 2 days for accrue interest
    const timeShift = 2 * 24 * 60 * 60;
    await time.increase(timeShift);

    const longerToCheck = longer2;
    const secondWorstPositionData = await marginlyPool.getHeapPosition(1, false);
    expect(secondWorstPositionData.success).to.be.true;
    expect(secondWorstPositionData[1].account).to.be.eq(longerToCheck.address);

    await marginlyPool
      .connect(longerToCheck)
      .execute(CallType.DepositBase, 100, 0, price, false, ZeroAddress, uniswapV3Swapdata());

    const longerToCheckPositionAfter = await marginlyPool.positions(longerToCheck.address);
    expect(longerToCheckPositionAfter.heapPosition).to.be.eq(0);

    const basePrice = (await marginlyPool.getBasePrice()).inner;
    const baseCollateralCoeff = await marginlyPool.baseCollateralCoeff();
    const quoteDebtCoeff = await marginlyPool.quoteDebtCoeff();
    const discountedBaseCollateral = await marginlyPool.discountedBaseCollateral();
    const discountedQuoteDebt = await marginlyPool.discountedQuoteDebt();

    const realBaseCollateral = (baseCollateralCoeff * discountedBaseCollateral) / FP96.one;
    const realBaseCollateralInQuote = (realBaseCollateral * basePrice) / FP96.one;
    const realQuoteDebt = (quoteDebtCoeff * discountedQuoteDebt) / FP96.one + 1n;

    const expectedSystemLeverageLong =
      (realBaseCollateralInQuote * FP96.one) / (realBaseCollateralInQuote - realQuoteDebt);
    expect(await marginlyPool.longLeverageX96()).to.be.eq(expectedSystemLeverageLong);
  });

  it('should fail if receivePosition is called with a negative amount2 parameter', async () => {
    const { marginlyPool } = await loadFixture(createMarginlyPool);
    await expect(
      marginlyPool.execute(CallType.ReceivePosition, 0, -1, 0, false, ZeroAddress, uniswapV3Swapdata())
    ).to.be.revertedWithCustomError(marginlyPool, 'WrongValue');
  });

  describe('Position transfer', () => {
    it('Deposit base and transfer', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [, bundler, user] = await ethers.getSigners();

      const price = (await marginlyPool.getBasePrice()).inner;

      await marginlyPool
        .connect(bundler)
        .execute(CallType.DepositBase, 100, 0, price, false, user, uniswapV3Swapdata());

      const bundlerPosition = await marginlyPool.positions(bundler);
      expect(bundlerPosition._type).to.be.eq(PositionType.Uninitialized);
      expect(bundlerPosition.discountedBaseAmount).to.be.eq(0);
      expect(bundlerPosition.discountedQuoteAmount).to.be.eq(0);

      const userPosition = await marginlyPool.positions(user);
      expect(userPosition._type).to.be.eq(PositionType.Lend);
      expect(userPosition.discountedBaseAmount).to.be.gt(0);
      expect(userPosition.discountedQuoteAmount).to.be.eq(0);
    });

    it('Deposit quote and transfer', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [, bundler, user] = await ethers.getSigners();

      const price = (await marginlyPool.getBasePrice()).inner;

      await marginlyPool
        .connect(bundler)
        .execute(CallType.DepositQuote, 100, 0, price, false, user, uniswapV3Swapdata());

      const bundlerPosition = await marginlyPool.positions(bundler);
      expect(bundlerPosition._type).to.be.eq(PositionType.Uninitialized);
      expect(bundlerPosition.discountedBaseAmount).to.be.eq(0);
      expect(bundlerPosition.discountedQuoteAmount).to.be.eq(0);

      const userPosition = await marginlyPool.positions(user);
      expect(userPosition._type).to.be.eq(PositionType.Lend);
      expect(userPosition.discountedBaseAmount).to.be.eq(0);
      expect(userPosition.discountedQuoteAmount).to.be.gt(0);
    });

    it('Long and transfer', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [, bundler, user, lender] = await ethers.getSigners();

      const price = (await marginlyPool.getBasePrice()).inner;

      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositQuote, 10_000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      await marginlyPool
        .connect(bundler)
        .execute(CallType.DepositBase, 100, 100, price, false, user, uniswapV3Swapdata());

      const bundlerPosition = await marginlyPool.positions(bundler);
      expect(bundlerPosition._type).to.be.eq(PositionType.Uninitialized);
      expect(bundlerPosition.discountedBaseAmount).to.be.eq(0);
      expect(bundlerPosition.discountedQuoteAmount).to.be.eq(0);

      const userPosition = await marginlyPool.positions(user);
      expect(userPosition._type).to.be.eq(PositionType.Long);
      expect(userPosition.discountedBaseAmount).to.be.gt(0);
      expect(userPosition.discountedQuoteAmount).to.be.gt(0);
    });

    it('Short and transfer', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [, bundler, user, lender] = await ethers.getSigners();

      const price = (await marginlyPool.getBasePrice()).inner;

      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, 10_000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      await marginlyPool
        .connect(bundler)
        .execute(CallType.DepositQuote, 100, 100, price, false, user, uniswapV3Swapdata());

      const bundlerPosition = await marginlyPool.positions(bundler);
      expect(bundlerPosition._type).to.be.eq(PositionType.Uninitialized);
      expect(bundlerPosition.discountedBaseAmount).to.be.eq(0);
      expect(bundlerPosition.discountedQuoteAmount).to.be.eq(0);

      const userPosition = await marginlyPool.positions(user);
      expect(userPosition._type).to.be.eq(PositionType.Short);
      expect(userPosition.discountedBaseAmount).to.be.gt(0);
      expect(userPosition.discountedQuoteAmount).to.be.gt(0);
    });

    it('Position transfer forbidden', async () => {
      const { marginlyPool } = await loadFixture(createMarginlyPool);
      const [, bundler, lender] = await ethers.getSigners();

      const price = (await marginlyPool.getBasePrice()).inner;

      await marginlyPool
        .connect(lender)
        .execute(CallType.DepositBase, 10_000, 0, price, false, ZeroAddress, uniswapV3Swapdata());

      await expect(
        marginlyPool.connect(bundler).execute(CallType.DepositBase, 100, 0, price, false, lender, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'Forbidden');

      await expect(
        marginlyPool.connect(bundler).execute(CallType.DepositQuote, 100, 0, price, false, lender, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'Forbidden');

      await expect(
        marginlyPool.connect(bundler).execute(CallType.DepositBase, 100, 100, price, false, lender, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'Forbidden');

      await expect(
        marginlyPool
          .connect(bundler)
          .execute(CallType.DepositQuote, 100, 100, price, false, lender, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'Forbidden');

      await expect(
        marginlyPool.connect(bundler).execute(CallType.WithdrawBase, 100, 0, price, false, lender, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'Forbidden');

      await expect(
        marginlyPool.connect(bundler).execute(CallType.WithdrawQuote, 100, 0, price, false, lender, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'Forbidden');

      await expect(
        marginlyPool.connect(bundler).execute(CallType.Long, 100, 0, price, false, lender, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'Forbidden');

      await expect(
        marginlyPool.connect(bundler).execute(CallType.Short, 100, 0, price, false, lender, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'Forbidden');

      await expect(
        marginlyPool.connect(bundler).execute(CallType.ClosePosition, 0, 0, price, false, lender, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'Forbidden');

      await expect(
        marginlyPool.connect(bundler).execute(CallType.SellCollateral, 0, 0, price, false, lender, uniswapV3Swapdata())
      ).to.be.revertedWithCustomError(marginlyPool, 'Forbidden');
    });
  });
});
