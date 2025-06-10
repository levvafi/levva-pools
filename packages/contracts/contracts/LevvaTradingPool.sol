// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import './base/LongTrading.sol';
import './base/ShortTrading.sol';
import './base/Emergency.sol';

contract LevvaTradingPool is LongTrading, ShortTrading, Emergency {
  using FP96 for FP96.FixedPoint;
  using LowGasSafeMath for uint256;
  using MaxBinaryHeapLib for MaxBinaryHeapLib.Heap;

  /// @inheritdoc IMarginlyPool
  function initialize(
    address _quoteToken,
    address _baseToken,
    address _priceOracle,
    uint32 _defaultSwapCallData,
    MarginlyParams calldata _params
  ) external virtual {
    if (factory != address(0)) revert MarginlyErrors.Forbidden();

    __LevvaCommon_init(_quoteToken, _baseToken, _priceOracle, _defaultSwapCallData, _params);
    __LongTrading_init();
    __ShortTrading_init();
  }

  /// @param flag unwrapETH in case of withdraw calls or syncBalance in case of reinit call
  function execute(
    CallType call,
    uint256 amount1,
    int256 amount2,
    uint256 limitPriceX96,
    bool flag,
    address receivePositionAddress,
    uint256 swapCalldata
  ) external payable override lock {
    if (call == CallType.ReceivePosition) {
      if (amount2 < 0) revert MarginlyErrors.WrongValue();
      _receivePosition(receivePositionAddress, amount1, uint256(amount2));
      return;
    } else if (call == CallType.EmergencyWithdraw) {
      _emergencyWithdraw(flag);
      return;
    }

    if (mode != Mode.Regular) revert MarginlyErrors.EmergencyMode();

    (bool callerMarginCalled, FP96.FixedPoint memory basePrice) = _reinit();
    if (callerMarginCalled) {
      _updateSystemLeverages(basePrice);
      return;
    }

    Position storage position = positions[msg.sender];

    if (_positionHasBadLeverage(position, basePrice)) {
      _liquidate(msg.sender, position, basePrice);
      _updateSystemLeverages(basePrice);
      return;
    }

    if (call == CallType.DepositBase) {
      _depositBase(amount1, basePrice, position);
      if (amount2 > 0) {
        _long(uint256(amount2), limitPriceX96, basePrice, position, swapCalldata);
      } else if (amount2 < 0) {
        _short(uint256(-amount2), limitPriceX96, basePrice, position, swapCalldata);
      }
    } else if (call == CallType.DepositQuote) {
      _depositQuote(amount1, position);
      if (amount2 > 0) {
        _short(uint256(amount2), limitPriceX96, basePrice, position, swapCalldata);
      } else if (amount2 < 0) {
        _long(uint256(-amount2), limitPriceX96, basePrice, position, swapCalldata);
      }
    } else if (call == CallType.WithdrawBase) {
      _withdrawBase(amount1, flag, basePrice, position);
    } else if (call == CallType.WithdrawQuote) {
      _withdrawQuote(amount1, flag, basePrice, position);
    } else if (call == CallType.Short) {
      _short(amount1, limitPriceX96, basePrice, position, swapCalldata);
    } else if (call == CallType.Long) {
      _long(amount1, limitPriceX96, basePrice, position, swapCalldata);
    } else if (call == CallType.ClosePosition) {
      _closePosition(limitPriceX96, position, swapCalldata);
    } else if (call == CallType.Reinit && flag) {
      // reinit itself has already taken place
      _syncBaseBalance();
      _syncQuoteBalance();
      emit BalanceSync();
    }

    _updateHeap(position);
    _updateSystemLeverages(basePrice);
  }

  /// @dev Used by keeper service
  function getHeapPosition(
    uint32 index,
    bool _short
  ) external view returns (bool success, MaxBinaryHeapLib.Node memory) {
    if (_short) {
      return shortHeap.getNodeByIndex(index);
    } else {
      return longHeap.getNodeByIndex(index);
    }
  }

  /// @notice Close position
  /// @param position msg.sender position
  function _closePosition(uint256 limitPriceX96, Position storage position, uint256 swapCalldata) private {
    uint256 realCollateralDelta;
    uint256 discountedCollateralDelta;
    address collateralToken;
    uint256 swapPriceX96;
    if (position._type == PositionType.Long) {
      _closeLongPosition(limitPriceX96, position, swapCalldata);
    } else if (position._type == PositionType.Short) {
      _closeShortPosition(limitPriceX96, position, swapCalldata);
    } else {
      revert MarginlyErrors.WrongPositionType();
    }

    emit ClosePosition(msg.sender, collateralToken, realCollateralDelta, swapPriceX96, discountedCollateralDelta);
  }

  function _repayBaseDebt(
    uint256 amount,
    FP96.FixedPoint memory basePrice,
    Position storage position
  ) internal override {
    FP96.FixedPoint memory _baseDebtCoeff = baseDebtCoeff;
    uint256 positionDiscountedBaseAmountPrev = position.discountedBaseAmount;
    uint256 realBaseDebt = _calcRealBaseDebt(positionDiscountedBaseAmountPrev);
    uint256 discountedBaseDebtDelta;

    if (amount >= realBaseDebt) {
      uint256 newRealBaseCollateral = amount.sub(realBaseDebt);
      if (amount != realBaseDebt) {
        if (basePrice.mul(_newPoolBaseBalance(newRealBaseCollateral)) > params.quoteLimit) {
          revert MarginlyErrors.ExceedsLimit();
        }
      }

      shortHeap.remove(positions, position.heapPosition - 1);
      // Short position debt <= depositAmount, increase collateral on delta, change position to Lend
      // discountedBaseCollateralDelta = (amount - realDebt)/ baseCollateralCoeff
      uint256 discountedBaseCollateralDelta = baseCollateralCoeff.recipMul(newRealBaseCollateral);
      discountedBaseDebtDelta = positionDiscountedBaseAmountPrev;
      position._type = PositionType.Lend;
      position.discountedBaseAmount = discountedBaseCollateralDelta;

      // update aggregates
      discountedBaseCollateral = discountedBaseCollateral.add(discountedBaseCollateralDelta);
    } else {
      // Short position, debt > depositAmount, decrease debt
      discountedBaseDebtDelta = _baseDebtCoeff.recipMul(amount);
      position.discountedBaseAmount = positionDiscountedBaseAmountPrev.sub(discountedBaseDebtDelta);
    }

    uint256 discountedQuoteCollDelta = quoteCollateralCoeff.recipMul(quoteDelevCoeff.mul(discountedBaseDebtDelta));
    position.discountedQuoteAmount = position.discountedQuoteAmount.sub(discountedQuoteCollDelta);
    discountedBaseDebt = discountedBaseDebt.sub(discountedBaseDebtDelta);
    discountedQuoteCollateral = discountedQuoteCollateral.sub(discountedQuoteCollDelta);
  }

  function _repayQuoteDebt(uint256 amount, Position storage position) internal override {
    FP96.FixedPoint memory _quoteDebtCoeff = quoteDebtCoeff;
    uint256 positionDiscountedQuoteAmountPrev = position.discountedQuoteAmount;
    uint256 realQuoteDebt = _quoteDebtCoeff.mul(positionDiscountedQuoteAmountPrev);
    uint256 discountedQuoteDebtDelta;

    if (amount >= realQuoteDebt) {
      uint256 newRealQuoteCollateral = amount.sub(realQuoteDebt);
      if (amount != realQuoteDebt) {
        if (_newPoolQuoteBalance(newRealQuoteCollateral) > params.quoteLimit) revert MarginlyErrors.ExceedsLimit();
      }

      longHeap.remove(positions, position.heapPosition - 1);
      // Long position, debt <= depositAmount, increase collateral on delta, move position to Lend
      // quoteCollateralChange = (amount - discountedDebt)/ quoteCollateralCoef
      uint256 discountedQuoteCollateralDelta = quoteCollateralCoeff.recipMul(newRealQuoteCollateral);
      discountedQuoteDebtDelta = positionDiscountedQuoteAmountPrev;
      position._type = PositionType.Lend;
      position.discountedQuoteAmount = discountedQuoteCollateralDelta;

      // update aggregates
      discountedQuoteCollateral = discountedQuoteCollateral.add(discountedQuoteCollateralDelta);
    } else {
      // Long position, debt > depositAmount, decrease debt on delta
      discountedQuoteDebtDelta = _quoteDebtCoeff.recipMul(amount);
      position.discountedQuoteAmount = positionDiscountedQuoteAmountPrev.sub(discountedQuoteDebtDelta);
    }

    uint256 discountedBaseCollDelta = baseCollateralCoeff.recipMul(baseDelevCoeff.mul(discountedQuoteDebtDelta));
    position.discountedBaseAmount = position.discountedBaseAmount.sub(discountedBaseCollDelta);
    discountedQuoteDebt = discountedQuoteDebt.sub(discountedQuoteDebtDelta);
    discountedBaseCollateral = discountedBaseCollateral.sub(discountedBaseCollDelta);
  }

  function _calcRealBaseCollateralTotal() internal view override(LevvaCommon, LongTrading) returns (uint256) {
    return LongTrading._calcRealBaseCollateralTotal();
  }

  function _calcRealQuoteCollateralTotal() internal view override(LevvaCommon, ShortTrading) returns (uint256) {
    return ShortTrading._calcRealQuoteCollateralTotal();
  }

  function _calcRealBaseDebtTotal() internal view override(LevvaCommon, ShortTrading) returns (uint256) {
    return ShortTrading._calcRealBaseDebtTotal();
  }

  function _calcRealQuoteDebtTotal() internal view override(LevvaCommon, LongTrading) returns (uint256) {
    return LongTrading._calcRealQuoteDebtTotal();
  }

  function _calcRealBaseCollateral(
    uint256 disBaseCollateral,
    uint256 disQuoteDebt
  ) internal view override(LevvaCommon, LongTrading) returns (uint256) {
    return LongTrading._calcRealBaseCollateral(disBaseCollateral, disQuoteDebt);
  }

  function _calcRealQuoteCollateral(
    uint256 disQuoteCollateral,
    uint256 disBaseDebt
  ) internal view override(LevvaCommon, ShortTrading) returns (uint256) {
    return ShortTrading._calcRealQuoteCollateral(disQuoteCollateral, disBaseDebt);
  }

  function _calcRealBaseDebt(uint256 disBaseDebt) internal view override(LevvaCommon, ShortTrading) returns (uint256) {
    return ShortTrading._calcRealBaseDebt(disBaseDebt);
  }

  function _calcRealQuoteDebt(uint256 disQuoteDebt) internal view override(LevvaCommon, LongTrading) returns (uint256) {
    return LongTrading._calcRealQuoteDebt(disQuoteDebt);
  }

  function _updateBaseCollateralCoeffs(FP96.FixedPoint memory factor) internal override(LevvaCommon, LongTrading) {
    return LongTrading._updateBaseCollateralCoeffs(factor);
  }

  function _updateQuoteCollateralCoeffs(FP96.FixedPoint memory factor) internal override(LevvaCommon, ShortTrading) {
    return ShortTrading._updateQuoteCollateralCoeffs(factor);
  }

  function _deleverageLong(
    uint256 realQuoteCollateral,
    uint256 realBaseDebt
  ) internal override(LongTrading, LevvaVirtual) {
    LongTrading._deleverageLong(realQuoteCollateral, realBaseDebt);
  }

  function _deleverageShort(
    uint256 realBaseCollateral,
    uint256 realQuoteDebt
  ) internal override(ShortTrading, LevvaVirtual) {
    ShortTrading._deleverageShort(realBaseCollateral, realQuoteDebt);
  }

  function _getWorstLongPositionOwner() internal view override(LongTrading, LevvaVirtual) returns (address) {
    return LongTrading._getWorstLongPositionOwner();
  }

  function _getWorstShortPositionOwner() internal view override(ShortTrading, LevvaVirtual) returns (address) {
    return ShortTrading._getWorstShortPositionOwner();
  }

  function _updateHeapLong(Position storage position) internal override(LongTrading, LevvaVirtual) {
    return LongTrading._updateHeapLong(position);
  }

  function _updateHeapShort(Position storage position) internal override(ShortTrading, LevvaVirtual) {
    return ShortTrading._updateHeapShort(position);
  }

  /// @notice sells all the base tokens from lend position for quote ones
  /// @dev no liquidity limit check since this function goes prior to 'short' call and it fail there anyway
  /// @dev you may consider adding that check here if this method is used in any other way
  function _sellBaseForQuote(Position storage position, uint256 limitPriceX96, uint256 swapCalldata) internal override {
    PositionType _type = position._type;
    if (_type == PositionType.Uninitialized) revert MarginlyErrors.UninitializedPosition();
    if (_type == PositionType.Short) return;

    bool isLong = _type == PositionType.Long;

    uint256 posDiscountedBaseColl = position.discountedBaseAmount;
    uint256 posDiscountedQuoteDebt = isLong ? position.discountedQuoteAmount : 0;
    uint256 baseAmountIn = _calcRealBaseCollateral(posDiscountedBaseColl, posDiscountedQuoteDebt);
    if (baseAmountIn == 0) return;

    uint256 quoteAmountOut = _swapExactInput(
      false,
      baseAmountIn,
      Math.mulDiv(limitPriceX96, baseAmountIn, FP96.Q96),
      swapCalldata
    );
    uint256 fee = Math.mulDiv(params.swapFee, quoteAmountOut, WHOLE_ONE);
    _chargeFee(fee);

    uint256 quoteOutSubFee = quoteAmountOut.sub(fee);
    uint256 realQuoteDebt = quoteDebtCoeff.mul(posDiscountedQuoteDebt);
    uint256 discountedQuoteCollateralDelta = quoteCollateralCoeff.recipMul(quoteOutSubFee.sub(realQuoteDebt));

    discountedBaseCollateral -= posDiscountedBaseColl;
    position.discountedBaseAmount = 0;
    discountedQuoteCollateral += discountedQuoteCollateralDelta;
    if (isLong) {
      discountedQuoteDebt -= posDiscountedQuoteDebt;
      position.discountedQuoteAmount = discountedQuoteCollateralDelta;

      position._type = PositionType.Lend;
      uint32 heapIndex = position.heapPosition - 1;
      longHeap.remove(positions, heapIndex);
      emit QuoteDebtRepaid(msg.sender, realQuoteDebt, posDiscountedQuoteDebt);
    } else {
      position.discountedQuoteAmount += discountedQuoteCollateralDelta;
    }

    emit SellBaseForQuote(
      msg.sender,
      baseAmountIn,
      quoteOutSubFee,
      posDiscountedBaseColl,
      discountedQuoteCollateralDelta
    );
  }

  /// @notice sells all the quote tokens from lend position for base ones
  /// @dev no liquidity limit check since this function goes prior to 'long' call and it fail there anyway
  /// @dev you may consider adding that check here if this method is used in any other way
  function _sellQuoteForBase(Position storage position, uint256 limitPriceX96, uint256 swapCalldata) internal override {
    PositionType _type = position._type;
    if (_type == PositionType.Uninitialized) revert MarginlyErrors.UninitializedPosition();
    if (_type == PositionType.Long) return;

    bool isShort = _type == PositionType.Short;

    uint256 posDiscountedQuoteColl = position.discountedQuoteAmount;
    uint256 posDiscountedBaseDebt = isShort ? position.discountedBaseAmount : 0;
    uint256 quoteAmountIn = _calcRealQuoteCollateral(posDiscountedQuoteColl, posDiscountedBaseDebt);
    if (quoteAmountIn == 0) return;

    uint256 fee = Math.mulDiv(params.swapFee, quoteAmountIn, WHOLE_ONE);
    uint256 quoteInSubFee = quoteAmountIn.sub(fee);

    uint256 baseAmountOut = _swapExactInput(
      true,
      quoteInSubFee,
      Math.mulDiv(FP96.Q96, quoteInSubFee, limitPriceX96),
      swapCalldata
    );
    _chargeFee(fee);

    uint256 realBaseDebt = baseDebtCoeff.mul(posDiscountedBaseDebt);
    uint256 discountedBaseCollateralDelta = baseCollateralCoeff.recipMul(baseAmountOut.sub(realBaseDebt));

    discountedQuoteCollateral -= posDiscountedQuoteColl;
    position.discountedQuoteAmount = 0;
    discountedBaseCollateral += discountedBaseCollateralDelta;
    if (isShort) {
      discountedBaseDebt -= posDiscountedBaseDebt;
      position.discountedBaseAmount = discountedBaseCollateralDelta;

      position._type = PositionType.Lend;
      uint32 heapIndex = position.heapPosition - 1;
      shortHeap.remove(positions, heapIndex);
      emit BaseDebtRepaid(msg.sender, realBaseDebt, posDiscountedBaseDebt);
    } else {
      position.discountedBaseAmount += discountedBaseCollateralDelta;
    }
    emit SellQuoteForBase(
      msg.sender,
      quoteInSubFee,
      baseAmountOut,
      posDiscountedQuoteColl,
      discountedBaseCollateralDelta
    );
  }

  /// @dev Changes tech position base collateral so total calculated base balance to be equal to actual
  function _syncBaseBalance() internal override {
    uint256 baseBalance = _getBalance(baseToken);
    uint256 actualBaseCollateral = baseDebtCoeff.mul(discountedBaseDebt).add(baseBalance);
    uint256 baseCollateral = _calcRealBaseCollateralTotal();
    Position storage techPosition = _getTechPosition();
    if (actualBaseCollateral > baseCollateral) {
      uint256 discountedBaseDelta = baseCollateralCoeff.recipMul(actualBaseCollateral.sub(baseCollateral));
      techPosition.discountedBaseAmount += discountedBaseDelta;
      discountedBaseCollateral += discountedBaseDelta;
    } else {
      uint256 discountedBaseDelta = baseCollateralCoeff.recipMul(baseCollateral.sub(actualBaseCollateral));
      techPosition.discountedBaseAmount -= discountedBaseDelta;
      discountedBaseCollateral -= discountedBaseDelta;
    }
  }

  /// @dev Changes tech position quote collateral so total calculated quote balance to be equal to actual
  function _syncQuoteBalance() internal override {
    uint256 quoteBalance = _getBalance(quoteToken);
    uint256 actualQuoteCollateral = quoteDebtCoeff.mul(discountedQuoteDebt).add(quoteBalance);
    uint256 quoteCollateral = _calcRealQuoteCollateralTotal();
    Position storage techPosition = _getTechPosition();
    if (actualQuoteCollateral > quoteCollateral) {
      uint256 discountedQuoteDelta = quoteCollateralCoeff.recipMul(actualQuoteCollateral.sub(quoteCollateral));
      techPosition.discountedQuoteAmount += discountedQuoteDelta;
      discountedQuoteCollateral += discountedQuoteDelta;
    } else {
      uint256 discountedQuoteDelta = quoteCollateralCoeff.recipMul(quoteCollateral.sub(actualQuoteCollateral));
      techPosition.discountedQuoteAmount -= discountedQuoteDelta;
      discountedQuoteCollateral -= discountedQuoteDelta;
    }
  }
}
