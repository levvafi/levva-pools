// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';

import '../Liquidations.sol';

abstract contract ShortTrading is Liquidations {
  using FP96 for FP96.FixedPoint;
  using MaxBinaryHeapLib for MaxBinaryHeapLib.Heap;
  using LowGasSafeMath for uint256;

  /// @dev Sum of all base token in debt
  uint256 public discountedBaseDebt;

  /// @dev Aggregate for deleveraged quote collateral
  FP96.FixedPoint public quoteDelevCoeff;
  /// @dev Accrued interest rate and fee for base debt
  FP96.FixedPoint public baseDebtCoeff;

  /// @dev Leverage of all short positions in the system
  uint256 public shortLeverageX96;

  ///@dev Heap of short positions, root - the worst long position. Sort key - leverage calculated with discounted collateral, debt
  MaxBinaryHeapLib.Heap internal shortHeap;

  function __ShortTrading_init() internal {
    baseDebtCoeff = FP96.one();
  }

  /// @notice Short with leverage
  /// @param basePrice current oracle base price, got by getBasePrice() method
  /// @param position position which performs short operation
  /// @param positionOwner address which owns provided position
  function _short(
    uint256 amount,
    bool amountInQuote,
    uint256 limitPriceX96,
    FP96.FixedPoint memory basePrice,
    Position storage position,
    address positionOwner,
    uint256 swapCalldata
  ) internal virtual override {
    // this function guaranties the position is gonna be either Short or Lend with 0 base balance
    _sellBaseForQuote(position, positionOwner, limitPriceX96, swapCalldata);

    uint256 positionDisBaseDebt = position.discountedBaseAmount;
    uint256 positionDisQuoteCollateral = position.discountedQuoteAmount;
    if (
      _calcRealQuoteCollateral(positionDisQuoteCollateral, positionDisBaseDebt) <
      basePrice.mul(params.positionMinAmount)
    ) revert MarginlyErrors.LessThanMinimalAmount();

    (uint256 quoteCollateralDelta, uint256 baseDebtDelta, uint256 swapPriceX96) = _shortSwap(
      amount,
      amountInQuote,
      limitPriceX96,
      swapCalldata
    );
    if (_newPoolQuoteBalance(quoteCollateralDelta) > params.quoteLimit) revert MarginlyErrors.ExceedsLimit();

    uint256 discountedBaseDebtDelta = baseDebtCoeff.recipMul(baseDebtDelta);
    position.discountedBaseAmount = positionDisBaseDebt.add(discountedBaseDebtDelta);
    discountedBaseDebt = discountedBaseDebt.add(discountedBaseDebtDelta);

    uint256 discountedQuoteDelta = quoteCollateralCoeff.recipMul(
      quoteCollateralDelta.add(quoteDelevCoeff.mul(discountedBaseDebtDelta))
    );
    position.discountedQuoteAmount = positionDisQuoteCollateral.add(discountedQuoteDelta);
    discountedQuoteCollateral = discountedQuoteCollateral.add(discountedQuoteDelta);

    if (position._type == PositionType.Lend) {
      if (position.heapPosition != 0) revert MarginlyErrors.WrongIndex();
      // init heap with default value 0, it will be updated by 'updateHeap' function later
      shortHeap.insert(positions, MaxBinaryHeapLib.Node({key: 0, account: positionOwner}));
      position._type = PositionType.Short;
    }

    if (_positionHasBadLeverage(position, basePrice)) revert MarginlyErrors.BadLeverage();

    emit Short(positionOwner, amount, amountInQuote, swapPriceX96, discountedQuoteDelta, discountedBaseDebtDelta);
  }

  function _closeShortPosition(
    uint256 limitPriceX96,
    Position storage position,
    uint256 swapCalldata
  )
    internal
    virtual
    override
    returns (uint256 realCollateralDelta, uint256 discountedCollateralDelta, uint256 swapPriceX96)
  {
    uint256 positionDiscountedBaseDebtPrev = position.discountedBaseAmount;
    uint256 realQuoteCollateral = _calcRealQuoteCollateral(
      position.discountedQuoteAmount,
      position.discountedBaseAmount
    );
    uint256 realBaseDebt = _calcRealBaseDebt(positionDiscountedBaseDebtPrev);

    {
      // quoteInMaximum is defined by user input limitPriceX96
      uint256 quoteInMaximum = Math.mulDiv(limitPriceX96, realBaseDebt, FP96.Q96);

      realCollateralDelta = _swapExactOutput(true, realQuoteCollateral, realBaseDebt, swapCalldata);
      if (realCollateralDelta > quoteInMaximum) revert MarginlyErrors.SlippageLimit();
      swapPriceX96 = _calcSwapPrice(realCollateralDelta, realBaseDebt);

      uint256 realFeeAmount = Math.mulDiv(params.swapFee, realCollateralDelta, WHOLE_ONE);
      _chargeFee(realFeeAmount);

      realCollateralDelta = realCollateralDelta.add(realFeeAmount);
      discountedCollateralDelta = quoteCollateralCoeff.recipMul(
        realCollateralDelta.add(quoteDelevCoeff.mul(position.discountedBaseAmount))
      );
    }

    discountedQuoteCollateral = discountedQuoteCollateral.sub(discountedCollateralDelta);
    discountedBaseDebt = discountedBaseDebt.sub(positionDiscountedBaseDebtPrev);

    position.discountedQuoteAmount = position.discountedQuoteAmount.sub(discountedCollateralDelta);
    position.discountedBaseAmount = 0;
    position._type = PositionType.Lend;

    uint32 heapIndex = position.heapPosition - 1;
    shortHeap.remove(positions, heapIndex);
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

  /// @notice sells all the quote tokens from lend position for base ones
  /// @dev no liquidity limit check since this function goes prior to 'long' call and it fail there anyway
  /// @dev you may consider adding that check here if this method is used in any other way
  function _sellQuoteForBase(
    Position storage position,
    address positionOwner,
    uint256 limitPriceX96,
    uint256 swapCalldata
  ) internal override {
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

    uint256 realBaseDebt = _calcRealBaseDebt(posDiscountedBaseDebt);
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
      emit BaseDebtRepaid(positionOwner, realBaseDebt, posDiscountedBaseDebt);
    } else {
      position.discountedBaseAmount += discountedBaseCollateralDelta;
    }
    emit SellQuoteForBase(
      positionOwner,
      quoteInSubFee,
      baseAmountOut,
      posDiscountedQuoteColl,
      discountedBaseCollateralDelta
    );
  }

  function _liquidateShort(Position storage position, FP96.FixedPoint memory basePrice) internal override {
    uint256 realQuoteCollateral = _calcRealQuoteCollateral(
      position.discountedQuoteAmount,
      position.discountedBaseAmount
    );

    // positionRealQuoteCollateral > poolQuoteBalance = poolQuoteCollateral - poolQuoteDebt
    // positionRealQuoteCollateral + poolQuoteDebt > poolQuoteCollateral
    uint256 poolQuoteCollateral = _calcRealQuoteCollateralTotal();
    uint256 posQuoteCollPlusPoolQuoteDebt = _calcRealQuoteDebtTotal().add(realQuoteCollateral);

    if (posQuoteCollPlusPoolQuoteDebt > poolQuoteCollateral) {
      // quoteDebtToReduce = positionRealQuoteCollateral - (poolQuoteCollateral - poolQuoteDebt) =
      // = (positionRealQuoteCollateral + poolQuoteDebt) - poolQuoteCollateral
      uint256 quoteDebtToReduce = posQuoteCollPlusPoolQuoteDebt.sub(poolQuoteCollateral);
      uint256 baseCollToReduce = basePrice.recipMul(quoteDebtToReduce);
      uint256 positionBaseDebt = _calcRealBaseDebt(position.discountedBaseAmount);
      if (baseCollToReduce > positionBaseDebt) {
        baseCollToReduce = positionBaseDebt;
      }
      _deleverageLong(baseCollToReduce, quoteDebtToReduce);

      uint256 disBaseDelta = baseDebtCoeff.recipMul(baseCollToReduce);
      position.discountedBaseAmount = position.discountedBaseAmount.sub(disBaseDelta);
      discountedBaseDebt = discountedBaseDebt.sub(disBaseDelta);

      uint256 disQuoteDelta = quoteCollateralCoeff.recipMul(quoteDebtToReduce.add(quoteDelevCoeff.mul(disBaseDelta)));
      position.discountedQuoteAmount = position.discountedQuoteAmount.sub(disQuoteDelta);
      discountedQuoteCollateral = discountedQuoteCollateral.sub(disQuoteDelta);
    }
  }

  function _enactMarginCallShort(
    Position storage position
  ) internal override returns (int256 baseCollateralSurplus, uint256 swapPriceX96) {
    uint256 realQuoteCollateral = _calcRealQuoteCollateral(
      position.discountedQuoteAmount,
      position.discountedBaseAmount
    );
    uint256 realBaseDebt = _calcRealBaseDebt(position.discountedBaseAmount);

    // short position mc
    uint256 swappedBaseDebt;
    if (realQuoteCollateral != 0) {
      uint baseOutMinimum = FP96.fromRatio(WHOLE_ONE - params.mcSlippage, WHOLE_ONE).mul(
        getLiquidationPrice().recipMul(realQuoteCollateral)
      );
      swappedBaseDebt = _swapExactInput(true, realQuoteCollateral, baseOutMinimum, defaultSwapCallData);
      swapPriceX96 = _calcSwapPrice(realQuoteCollateral, swappedBaseDebt);
    }

    FP96.FixedPoint memory factor;
    // baseCollateralCoeff += rcd * (rqc - sqc) / sqc
    if (swappedBaseDebt >= realBaseDebt) {
      // Position has enough collateral to repay debt
      factor = FP96.one().add(FP96.fromRatio(swappedBaseDebt.sub(realBaseDebt), _calcRealBaseCollateralTotal()));
      baseCollateralSurplus = int256(swappedBaseDebt.sub(realBaseDebt));
    } else {
      // Position's debt has been repaid by pool
      factor = FP96.one().sub(FP96.fromRatio(realBaseDebt.sub(swappedBaseDebt), _calcRealBaseCollateralTotal()));
      baseCollateralSurplus = -int256(realBaseDebt.sub(swappedBaseDebt));
    }
    _updateBaseCollateralCoeffs(factor);

    discountedQuoteCollateral = discountedQuoteCollateral.sub(position.discountedQuoteAmount);
    discountedBaseDebt = discountedBaseDebt.sub(position.discountedBaseAmount);

    // remove position
    shortHeap.remove(positions, position.heapPosition - 1);
  }

  function _receiveShort(
    Position storage badPosition,
    Position storage position,
    uint256 baseAmount,
    uint256 quoteAmount
  ) internal virtual override {
    uint256 discountedQuoteCollateralDelta = quoteCollateralCoeff.recipMul(quoteAmount);
    discountedQuoteCollateral = discountedQuoteCollateral.add(discountedQuoteCollateralDelta);
    position.discountedQuoteAmount = badPosition.discountedQuoteAmount.add(discountedQuoteCollateralDelta);

    uint32 heapIndex = badPosition.heapPosition - 1;
    uint256 badPositionBaseDebt = _calcRealBaseDebt(badPosition.discountedBaseAmount);
    uint256 discountedBaseDebtDelta;
    if (baseAmount >= badPositionBaseDebt) {
      discountedBaseDebtDelta = badPosition.discountedBaseAmount;

      uint256 discountedBaseCollateralDelta = baseCollateralCoeff.recipMul(baseAmount.sub(badPositionBaseDebt));
      position.discountedBaseAmount = discountedBaseCollateralDelta;
      discountedBaseCollateral = discountedBaseCollateral.add(discountedBaseCollateralDelta);

      position._type = PositionType.Lend;

      shortHeap.remove(positions, heapIndex);
    } else {
      position._type = PositionType.Short;
      position.heapPosition = heapIndex + 1;
      discountedBaseDebtDelta = baseDebtCoeff.recipMul(baseAmount);
      position.discountedBaseAmount = badPosition.discountedBaseAmount.sub(discountedBaseDebtDelta);

      shortHeap.updateAccount(heapIndex, msg.sender);
    }

    discountedBaseDebt = discountedBaseDebt.sub(discountedBaseDebtDelta);
    discountedQuoteCollateralDelta = quoteCollateralCoeff.recipMul(quoteDelevCoeff.mul(discountedBaseDebtDelta));
    discountedQuoteCollateral -= discountedQuoteCollateralDelta;
    position.discountedQuoteAmount -= discountedQuoteCollateralDelta;
  }

  function _updateSystemLeverageShort(FP96.FixedPoint memory basePrice) internal virtual override {
    if (discountedBaseDebt == 0) {
      shortLeverageX96 = uint128(FP96.Q96);
      return;
    }

    uint256 realQuoteCollateral = _calcRealQuoteCollateralTotal();
    uint256 realBaseDebt = basePrice.mul(_calcRealBaseDebtTotal());
    uint128 leverageX96 = uint128(Math.mulDiv(FP96.Q96, realQuoteCollateral, realQuoteCollateral.sub(realBaseDebt)));
    uint128 maxLeverageX96 = uint128(params.maxLeverage) << FP96.RESOLUTION;
    shortLeverageX96 = leverageX96 < maxLeverageX96 ? leverageX96 : maxLeverageX96;
  }

  function _accrueInterestShort(
    uint256 secondsPassed,
    FP96.FixedPoint memory secondsInYear,
    FP96.FixedPoint memory interestRate,
    FP96.FixedPoint memory feeDt
  ) internal virtual override returns (uint256 quoteDebtDistributed, uint256 discountedBaseFee) {
    if (discountedBaseDebt != 0) {
      FP96.FixedPoint memory baseDebtCoeffPrev = baseDebtCoeff;
      uint256 realBaseDebtPrev = baseDebtCoeffPrev.mul(discountedBaseDebt, Math.Rounding.Ceil);
      FP96.FixedPoint memory onePlusIR = interestRate
        .mul(FP96.FixedPoint({inner: shortLeverageX96}))
        .div(secondsInYear)
        .add(FP96.one());

      // AR(dt) =  (1+ ir)^dt
      FP96.FixedPoint memory accruedRateDt = FP96.powTaylor(onePlusIR, secondsPassed);
      baseDebtCoeff = baseDebtCoeffPrev.mul(accruedRateDt).mul(feeDt);
      quoteDebtDistributed = accruedRateDt.sub(FP96.one()).mul(realBaseDebtPrev);
      FP96.FixedPoint memory factor = FP96.one().add(
        FP96.fromRatio(quoteDebtDistributed, _calcRealBaseCollateralTotal())
      );
      _updateBaseCollateralCoeffs(factor);
      discountedBaseFee = baseCollateralCoeff.recipMul(accruedRateDt.mul(feeDt.sub(FP96.one())).mul(realBaseDebtPrev));
    }
  }

  function _updateQuoteCollateralCoeffs(FP96.FixedPoint memory factor) internal virtual override {
    super._updateQuoteCollateralCoeffs(factor);
    quoteDelevCoeff = quoteDelevCoeff.mul(factor);
  }

  /// @dev All short positions deleverage
  /// @param realQuoteCollateral Total quote collateral to reduce on all short positions
  /// @param realBaseDebt Total base debt to reduce on all short positions
  function _deleverageShort(uint256 realQuoteCollateral, uint256 realBaseDebt) internal virtual override {
    quoteDelevCoeff = quoteDelevCoeff.add(FP96.fromRatio(realQuoteCollateral, discountedBaseDebt));
    baseDebtCoeff = baseDebtCoeff.sub(FP96.fromRatio(realBaseDebt, discountedBaseDebt));

    // this error is highly unlikely to occur and requires lots of big whales liquidations prior to it
    // however if it happens, the ways to fix what seems like a pool deadlock are 'receivePosition' and 'balanceSync'
    if (baseDebtCoeff.inner < FP96.halfPrecision().inner) revert MarginlyErrors.BigPrecisionLoss();

    emit Deleverage(PositionType.Short, realQuoteCollateral, realBaseDebt);
  }

  function _calcRealQuoteCollateralTotal() internal view virtual override returns (uint256) {
    return _calcRealQuoteCollateral(discountedQuoteCollateral, discountedBaseDebt);
  }

  function _calcRealBaseDebtTotal() internal view virtual override returns (uint256) {
    return _calcRealBaseDebt(discountedBaseDebt);
  }

  function _calcRealQuoteCollateral(
    uint256 disQuoteCollateral,
    uint256 disBaseDebt
  ) internal view virtual override returns (uint256) {
    return quoteCollateralCoeff.mul(disQuoteCollateral).sub(quoteDelevCoeff.mul(disBaseDebt, Math.Rounding.Ceil));
  }

  function _calcRealBaseDebt(uint256 disBaseDebt) internal view virtual override returns (uint256) {
    return baseDebtCoeff.mul(disBaseDebt, Math.Rounding.Ceil);
  }

  function _getWorstShortPositionOwner() internal view virtual override returns (address) {
    (, MaxBinaryHeapLib.Node memory root) = shortHeap.getNodeByIndex(0);
    return root.account;
  }

  function _updateHeapShort(Position storage position) internal virtual override {
    uint96 sortKey = _calcSortKey(position.discountedQuoteAmount, position.discountedBaseAmount);
    uint32 heapIndex = position.heapPosition - 1;
    shortHeap.update(positions, heapIndex, sortKey);
  }

  function _shortSwap(
    uint256 amount,
    bool amountInQuote,
    uint256 limitPriceX96,
    uint256 swapCalldata
  ) private returns (uint256 quoteCollateralDelta, uint256 baseDebtDelta, uint256 swapPriceX96) {
    if (amountInQuote) {
      uint256 baseInMaximum = Math.mulDiv(amount, FP96.Q96, limitPriceX96);
      baseDebtDelta = _swapExactOutput(false, baseInMaximum, amount, swapCalldata);
      swapPriceX96 = _calcSwapPrice(amount, baseDebtDelta);

      uint256 swapFee = Math.mulDiv(params.swapFee, amount, WHOLE_ONE);
      quoteCollateralDelta = amount.sub(swapFee);
      _chargeFee(swapFee);
    } else {
      baseDebtDelta = amount;
      uint256 quoteOutMinimum = Math.mulDiv(limitPriceX96, amount, FP96.Q96);
      uint256 quoteOutWithFee = _swapExactInput(false, amount, quoteOutMinimum, swapCalldata);
      swapPriceX96 = _calcSwapPrice(quoteOutWithFee, amount);

      uint256 swapFee = Math.mulDiv(params.swapFee, quoteOutWithFee, WHOLE_ONE);
      quoteCollateralDelta = quoteOutWithFee.sub(swapFee);
      _chargeFee(swapFee);
    }
  }
}
