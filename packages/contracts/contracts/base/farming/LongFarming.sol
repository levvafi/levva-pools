// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';

import '../Liquidations.sol';

abstract contract LongFarming is Liquidations {
  using FP96 for FP96.FixedPoint;
  using MaxBinaryHeapLib for MaxBinaryHeapLib.Heap;
  using LowGasSafeMath for uint256;

  /// @dev Sum of all quote token in debt
  uint256 public discountedQuoteDebt;

  /// @dev Aggregate for deleveraged base collateral
  FP96.FixedPoint public baseDelevCoeff;
  /// @dev Accrued interest rate and fee for quote debt
  FP96.FixedPoint public quoteDebtCoeff;

  /// @dev Leverage of all long positions in the system
  uint256 public longX96Leverage;

  ///@dev Heap of long positions, root - the worst long position. Sort key - leverage calculated with discounted collateral, debt
  MaxBinaryHeapLib.Heap internal longHeap;

  function __LongFarming_init() internal {
    quoteDebtCoeff = FP96.one();
  }

  /// @notice Long with leverage
  /// @param realBaseAmount Amount of base token
  /// @param basePrice current oracle base price, got by getBasePrice() method
  /// @param position msg.sender position
  function _long(
    uint256 realBaseAmount,
    uint256 limitPriceX96,
    FP96.FixedPoint memory basePrice,
    Position storage position,
    uint256 swapCalldata
  ) internal {
    if (basePrice.mul(_newPoolBaseBalance(realBaseAmount)) > params.quoteLimit) revert MarginlyErrors.ExceedsLimit();

    // this function guaranties the position is gonna be either Long or Lend with 0 quote balance
    _sellQuoteForBase(position, limitPriceX96, swapCalldata);

    uint256 positionDisQuoteDebt = position.discountedQuoteAmount;
    uint256 positionDisBaseCollateral = position.discountedBaseAmount;

    {
      uint256 currentBaseCollateral = _calcRealBaseCollateral(positionDisBaseCollateral, positionDisQuoteDebt);
      if (currentBaseCollateral < params.positionMinAmount) revert MarginlyErrors.LessThanMinimalAmount();
    }

    // realQuoteInMaximum is defined by user input limitPriceX96
    uint256 realQuoteInMaximum = Math.mulDiv(limitPriceX96, realBaseAmount, FP96.Q96);
    uint256 realQuoteAmount = _swapExactOutput(true, realQuoteInMaximum, realBaseAmount, swapCalldata);

    uint256 realSwapFee = Math.mulDiv(params.swapFee, realQuoteAmount, WHOLE_ONE);
    _chargeFee(realSwapFee);

    uint256 discountedQuoteDebtChange = quoteDebtCoeff.recipMul(realQuoteAmount.add(realSwapFee));
    position.discountedQuoteAmount = positionDisQuoteDebt.add(discountedQuoteDebtChange);
    discountedQuoteDebt = discountedQuoteDebt.add(discountedQuoteDebtChange);

    uint256 discountedBaseCollateralChange = baseCollateralCoeff.recipMul(
      realBaseAmount.add(baseDelevCoeff.mul(discountedQuoteDebtChange))
    );
    position.discountedBaseAmount = positionDisBaseCollateral.add(discountedBaseCollateralChange);
    discountedBaseCollateral = discountedBaseCollateral.add(discountedBaseCollateralChange);

    if (position._type == PositionType.Lend) {
      if (position.heapPosition != 0) revert MarginlyErrors.WrongIndex();
      // init heap with default value 0, it will be updated by 'updateHeap' function later
      longHeap.insert(positions, MaxBinaryHeapLib.Node({key: 0, account: msg.sender}));
      position._type = PositionType.Long;
    }

    if (_positionHasBadLeverage(position, basePrice)) revert MarginlyErrors.BadLeverage();

    // emit Long(msg.sender, realBaseAmount, discountedQuoteDebtChange, discountedBaseCollateralChange);
  }

  /// @notice Close position
  /// @param position msg.sender position
  function _closeLongPosition(
    uint256 limitPriceX96,
    Position storage position,
    uint256 swapCalldata
  ) internal returns (uint256 realCollateralDelta, uint256 discountedCollateralDelta) {
    uint256 positionDiscountedQuoteDebtPrev = position.discountedQuoteAmount;
    discountedCollateralDelta = position.discountedBaseAmount;
    uint256 discountedDebtDelta = position.discountedQuoteAmount;
    realCollateralDelta = _calcRealBaseCollateral(discountedCollateralDelta, discountedDebtDelta);
    uint256 realQuoteDebt = quoteDebtCoeff.mul(positionDiscountedQuoteDebtPrev, Math.Rounding.Ceil);

    uint256 milSlippageAmount = FP96.fromRatio(WHOLE_ONE - params.mcSlippage, WHOLE_ONE).mul(
      limitPriceX96.mul(realCollateralDelta)
    );

    uint256 quoteOutMinimum = milSlippageAmount > realQuoteDebt ? milSlippageAmount : realQuoteDebt;
    uint256 exactQuoteOut = _swapExactInput(false, realCollateralDelta, quoteOutMinimum, swapCalldata);

    uint256 realFeeAmount = Math.mulDiv(params.swapFee, exactQuoteOut, WHOLE_ONE);
    _chargeFee(realFeeAmount);

    position.discountedBaseAmount = quoteCollateralCoeff.recipMul(exactQuoteOut.sub(realFeeAmount).sub(realQuoteDebt));
    position.discountedBaseAmount = 0;
    position._type = PositionType.Lend;

    discountedBaseCollateral = discountedBaseCollateral.sub(discountedCollateralDelta);
    discountedQuoteDebt = discountedQuoteDebt.sub(discountedCollateralDelta);

    uint32 heapIndex = position.heapPosition - 1;
    longHeap.remove(positions, heapIndex);
  }

  function _liquidateLong(Position storage position, FP96.FixedPoint memory basePrice) internal override {
    uint256 realBaseCollateral = _calcRealBaseCollateral(position.discountedBaseAmount, position.discountedQuoteAmount);

    // positionRealBaseCollateral > poolBaseBalance = poolBaseCollateral - poolBaseDebt
    // positionRealBaseCollateral + poolBaseDebt > poolBaseCollateral
    uint256 poolBaseCollateral = _calcRealBaseCollateral(discountedBaseCollateral, discountedQuoteDebt);
    uint256 posBaseCollPlusPoolBaseDebt = _calcRealBaseDebtTotal().add(realBaseCollateral);

    if (posBaseCollPlusPoolBaseDebt > poolBaseCollateral) {
      // baseDebtToReduce = positionRealBaseCollateral - (poolBaseCollateral - poolBaseDebt) =
      // = (positionRealBaseCollateral + poolBaseDebt) - poolBaseCollateral
      uint256 baseDebtToReduce = posBaseCollPlusPoolBaseDebt.sub(poolBaseCollateral);
      uint256 quoteCollToReduce = basePrice.mul(baseDebtToReduce);
      uint256 positionQuoteDebt = quoteDebtCoeff.mul(position.discountedQuoteAmount);
      if (quoteCollToReduce > positionQuoteDebt) {
        quoteCollToReduce = positionQuoteDebt;
      }
      _deleverageShort(quoteCollToReduce, baseDebtToReduce);

      uint256 disQuoteDelta = quoteDebtCoeff.recipMul(quoteCollToReduce);
      position.discountedQuoteAmount = position.discountedQuoteAmount.sub(disQuoteDelta);
      discountedQuoteDebt = discountedQuoteDebt.sub(disQuoteDelta);

      uint256 disBaseDelta = baseCollateralCoeff.recipMul(baseDebtToReduce.add(baseDelevCoeff.mul(disQuoteDelta)));
      position.discountedBaseAmount = position.discountedBaseAmount.sub(disBaseDelta);
      discountedBaseCollateral = discountedBaseCollateral.sub(disBaseDelta);
    }
  }

  function _enactMarginCallLong(Position storage position) internal override {
    uint256 realBaseCollateral = _calcRealBaseCollateral(position.discountedBaseAmount, position.discountedQuoteAmount);
    uint256 realQuoteDebt = quoteDebtCoeff.mul(position.discountedQuoteAmount);

    // long position mc
    uint256 swappedQuoteDebt;
    if (realBaseCollateral != 0) {
      uint256 quoteOutMinimum = FP96.fromRatio(WHOLE_ONE - params.mcSlippage, WHOLE_ONE).mul(
        getLiquidationPrice().mul(realBaseCollateral)
      );
      swappedQuoteDebt = _swapExactInput(false, realBaseCollateral, quoteOutMinimum, defaultSwapCallData);
      // swapPriceX96 = getSwapPrice(swappedQuoteDebt, realBaseCollateral);
    }

    FP96.FixedPoint memory factor;
    // quoteCollateralCoef += rqd * (rbc - sbc) / sbc
    if (swappedQuoteDebt >= realQuoteDebt) {
      // Position has enough collateral to repay debt
      factor = FP96.one().add(FP96.fromRatio(swappedQuoteDebt.sub(realQuoteDebt), _calcRealQuoteCollateralTotal()));
    } else {
      // Position's debt has been repaid by pool
      factor = FP96.one().sub(FP96.fromRatio(realQuoteDebt.sub(swappedQuoteDebt), _calcRealQuoteCollateralTotal()));
    }
    _updateQuoteCollateralCoeffs(factor);

    discountedBaseCollateral = discountedBaseCollateral.sub(position.discountedBaseAmount);
    discountedQuoteDebt = discountedQuoteDebt.sub(position.discountedQuoteAmount);

    //remove position
    longHeap.remove(positions, position.heapPosition - 1);
  }

  function _receiveLong(
    Position storage badPosition,
    Position storage position,
    uint256 baseAmount,
    uint256 quoteAmount
  ) internal virtual override {
    uint256 discountedBaseCollateralDelta = baseCollateralCoeff.recipMul(baseAmount);
    discountedBaseCollateral = discountedBaseCollateral.add(discountedBaseCollateralDelta);
    position.discountedBaseAmount = badPosition.discountedBaseAmount.add(discountedBaseCollateralDelta);

    uint32 heapIndex = badPosition.heapPosition - 1;
    uint256 badPositionQuoteDebt = quoteDebtCoeff.mul(badPosition.discountedQuoteAmount);
    uint256 discountedQuoteDebtDelta;
    if (quoteAmount >= badPositionQuoteDebt) {
      discountedQuoteDebtDelta = badPosition.discountedQuoteAmount;

      uint256 discountedQuoteCollateralDelta = quoteCollateralCoeff.recipMul(quoteAmount.sub(badPositionQuoteDebt));
      position.discountedQuoteAmount = discountedQuoteCollateralDelta;
      discountedQuoteCollateral = discountedQuoteCollateral.add(discountedQuoteCollateralDelta);

      position._type = PositionType.Lend;

      longHeap.remove(positions, heapIndex);
    } else {
      position._type = PositionType.Long;
      position.heapPosition = heapIndex + 1;
      discountedQuoteDebtDelta = quoteDebtCoeff.recipMul(quoteAmount);
      position.discountedQuoteAmount = badPosition.discountedQuoteAmount.sub(discountedQuoteDebtDelta);

      longHeap.updateAccount(heapIndex, msg.sender);
    }

    discountedQuoteDebt = discountedQuoteDebt.sub(discountedQuoteDebtDelta);
    discountedBaseCollateralDelta = baseCollateralCoeff.recipMul(baseDelevCoeff.mul(discountedQuoteDebtDelta));
    discountedBaseCollateral -= discountedBaseCollateralDelta;
    position.discountedBaseAmount -= discountedBaseCollateralDelta;
  }

  function _updateSystemLeverageLong(FP96.FixedPoint memory basePrice) internal virtual override {
    if (discountedBaseCollateral == 0) {
      longX96Leverage = uint128(FP96.Q96);
      return;
    }

    uint256 realBaseCollateral = basePrice.mul(_calcRealBaseCollateral(discountedBaseCollateral, discountedQuoteDebt));
    uint256 realQuoteDebt = quoteDebtCoeff.mul(discountedQuoteDebt);
    uint128 leverageX96 = uint128(Math.mulDiv(FP96.Q96, realBaseCollateral, realBaseCollateral.sub(realQuoteDebt)));
    uint128 maxLeverageX96 = uint128(params.maxLeverage) << FP96.RESOLUTION;
    longX96Leverage = leverageX96 < maxLeverageX96 ? leverageX96 : maxLeverageX96;
  }

  function _accrueInterestLong(
    uint256 secondsPassed,
    FP96.FixedPoint memory secondsInYear,
    FP96.FixedPoint memory interestRate,
    FP96.FixedPoint memory feeDt
  ) internal virtual override returns (uint256 discountedQuoteFee) {
    if (discountedQuoteCollateral != 0) {
      FP96.FixedPoint memory quoteDebtCoeffPrev = quoteDebtCoeff;
      uint256 realQuoteDebtPrev = quoteDebtCoeffPrev.mul(discountedQuoteDebt);
      FP96.FixedPoint memory onePlusIR = interestRate
        .mul(FP96.FixedPoint({inner: longX96Leverage}))
        .div(secondsInYear)
        .add(FP96.one());

      // AR(dt) =  (1+ ir)^dt
      FP96.FixedPoint memory accruedRateDt = FP96.powTaylor(onePlusIR, secondsPassed);
      quoteDebtCoeff = quoteDebtCoeffPrev.mul(accruedRateDt).mul(feeDt);
      FP96.FixedPoint memory factor = FP96.one().add(
        FP96.fromRatio(accruedRateDt.sub(FP96.one()).mul(realQuoteDebtPrev), _calcRealQuoteCollateralTotal())
      );
      _updateQuoteCollateralCoeffs(factor);
      discountedQuoteFee = quoteCollateralCoeff.recipMul(
        accruedRateDt.mul(feeDt.sub(FP96.one())).mul(realQuoteDebtPrev)
      );
    }
  }

  function _updateBaseCollateralCoeffs(FP96.FixedPoint memory factor) internal virtual override {
    super._updateBaseCollateralCoeffs(factor);
    baseDelevCoeff = baseDelevCoeff.mul(factor);
  }

  /// @dev All long positions deleverage
  /// @param realBaseCollateral Total base collateral to reduce on all long positions
  /// @param realQuoteDebt Total quote debt to reduce on all long positions
  function _deleverageLong(uint256 realBaseCollateral, uint256 realQuoteDebt) internal virtual override {
    baseDelevCoeff = baseDelevCoeff.add(FP96.fromRatio(realBaseCollateral, discountedQuoteDebt));
    quoteDebtCoeff = quoteDebtCoeff.sub(FP96.fromRatio(realQuoteDebt, discountedQuoteDebt));

    // this error is highly unlikely to occur and requires lots of big whales liquidations prior to it
    // however if it happens, the ways to fix what seems like a pool deadlock are 'receivePosition' and 'balanceSync'
    if (quoteDebtCoeff.inner < FP96.halfPrecision().inner) revert MarginlyErrors.BigPrecisionLoss();

    emit Deleverage(PositionType.Long, realBaseCollateral, realQuoteDebt);
  }

  function _calcRealBaseCollateralTotal() internal view virtual override returns (uint256) {
    return _calcRealBaseCollateral(discountedBaseCollateral, discountedQuoteDebt);
  }

  function _calcRealQuoteDebtTotal() internal view virtual override returns (uint256) {
    return _calcRealQuoteDebt(discountedQuoteDebt);
  }

  function _calcRealBaseCollateral(
    uint256 disBaseCollateral,
    uint256 disQuoteDebt
  ) internal view virtual override returns (uint256) {
    return baseCollateralCoeff.mul(disBaseCollateral).sub(baseDelevCoeff.mul(disQuoteDebt));
  }

  function _calcRealQuoteDebt(uint256 disQuoteDebt) internal view virtual override returns (uint256) {
    return quoteDebtCoeff.mul(disQuoteDebt);
  }

  function _getWorstLongPositionOwner() internal view virtual override returns (address) {
    (, MaxBinaryHeapLib.Node memory root) = longHeap.getNodeByIndex(0);
    return root.account;
  }

  function _updateHeapLong(Position storage position) internal virtual override {
    uint96 sortKey = _calcSortKey(initialPrice.mul(position.discountedBaseAmount), position.discountedQuoteAmount);
    uint32 heapIndex = position.heapPosition - 1;
    longHeap.update(positions, heapIndex, sortKey);
  }
}
