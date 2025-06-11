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
  uint256 public shortX96Leverage;

  ///@dev Heap of short positions, root - the worst long position. Sort key - leverage calculated with discounted collateral, debt
  MaxBinaryHeapLib.Heap internal shortHeap;

  function __ShortTrading_init() internal {
    baseDebtCoeff = FP96.one();
  }

  /// @notice Short with leverage
  /// @param realBaseAmount Amount of base token
  /// @param basePrice current oracle base price, got by getBasePrice() method
  /// @param position msg.sender position
  function _short(
    uint256 realBaseAmount,
    uint256 limitPriceX96,
    FP96.FixedPoint memory basePrice,
    Position storage position,
    uint256 swapCalldata
  ) internal {
    // revert MarginlyErrors.Forbidden();
    // this function guaranties the position is gonna be either Short or Lend with 0 base balance
    _sellBaseForQuote(position, limitPriceX96, swapCalldata);

    uint256 positionDisBaseDebt = position.discountedBaseAmount;
    uint256 positionDisQuoteCollateral = position.discountedQuoteAmount;

    {
      uint256 currentQuoteCollateral = _calcRealQuoteCollateral(positionDisQuoteCollateral, positionDisBaseDebt);
      if (currentQuoteCollateral < basePrice.mul(params.positionMinAmount))
        revert MarginlyErrors.LessThanMinimalAmount();
    }

    // quoteOutMinimum is defined by user input limitPriceX96
    uint256 quoteOutMinimum = Math.mulDiv(limitPriceX96, realBaseAmount, FP96.Q96);
    uint256 realQuoteCollateralChangeWithFee = _swapExactInput(false, realBaseAmount, quoteOutMinimum, swapCalldata);

    uint256 realSwapFee = Math.mulDiv(params.swapFee, realQuoteCollateralChangeWithFee, WHOLE_ONE);
    uint256 realQuoteCollateralChange = realQuoteCollateralChangeWithFee.sub(realSwapFee);

    if (_newPoolQuoteBalance(realQuoteCollateralChange) > params.quoteLimit) revert MarginlyErrors.ExceedsLimit();

    uint256 discountedBaseDebtChange = baseDebtCoeff.recipMul(realBaseAmount);
    position.discountedBaseAmount = positionDisBaseDebt.add(discountedBaseDebtChange);
    discountedBaseDebt = discountedBaseDebt.add(discountedBaseDebtChange);

    uint256 discountedQuoteChange = quoteCollateralCoeff.recipMul(
      realQuoteCollateralChange.add(quoteDelevCoeff.mul(discountedBaseDebtChange))
    );
    position.discountedQuoteAmount = positionDisQuoteCollateral.add(discountedQuoteChange);
    discountedQuoteCollateral = discountedQuoteCollateral.add(discountedQuoteChange);
    _chargeFee(realSwapFee);

    if (position._type == PositionType.Lend) {
      if (position.heapPosition != 0) revert MarginlyErrors.WrongIndex();
      // init heap with default value 0, it will be updated by 'updateHeap' function later
      shortHeap.insert(positions, MaxBinaryHeapLib.Node({key: 0, account: msg.sender}));
      position._type = PositionType.Short;
    }

    if (_positionHasBadLeverage(position, basePrice)) revert MarginlyErrors.BadLeverage();

    // emit Short(msg.sender, realBaseAmount, discountedQuoteChange, discountedBaseDebtChange);
  }

  function _closeShortPosition(
    uint256 limitPriceX96,
    Position storage position,
    uint256 swapCalldata
  ) internal returns (uint256 realCollateralDelta, uint256 discountedCollateralDelta) {
    uint256 positionDiscountedBaseDebtPrev = position.discountedBaseAmount;
    uint256 realQuoteCollateral = _calcRealQuoteCollateral(
      position.discountedQuoteAmount,
      position.discountedBaseAmount
    );
    uint256 realBaseDebt = baseDebtCoeff.mul(positionDiscountedBaseDebtPrev, Math.Rounding.Ceil);

    {
      // quoteInMaximum is defined by user input limitPriceX96
      uint256 quoteInMaximum = Math.mulDiv(limitPriceX96, realBaseDebt, FP96.Q96);

      realCollateralDelta = _swapExactOutput(true, realQuoteCollateral, realBaseDebt, swapCalldata);
      if (realCollateralDelta > quoteInMaximum) revert MarginlyErrors.SlippageLimit();

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

  function _liquidateShort(Position storage position, FP96.FixedPoint memory basePrice) internal override {
    uint256 realQuoteCollateral = _calcRealQuoteCollateral(
      position.discountedQuoteAmount,
      position.discountedBaseAmount
    );

    // positionRealQuoteCollateral > poolQuoteBalance = poolQuoteCollateral - poolQuoteDebt
    // positionRealQuoteCollateral + poolQuoteDebt > poolQuoteCollateral
    uint256 poolQuoteCollateral = _calcRealQuoteCollateral(discountedQuoteCollateral, discountedBaseDebt);
    uint256 posQuoteCollPlusPoolQuoteDebt = _calcRealQuoteDebtTotal().add(realQuoteCollateral);

    if (posQuoteCollPlusPoolQuoteDebt > poolQuoteCollateral) {
      // quoteDebtToReduce = positionRealQuoteCollateral - (poolQuoteCollateral - poolQuoteDebt) =
      // = (positionRealQuoteCollateral + poolQuoteDebt) - poolQuoteCollateral
      uint256 quoteDebtToReduce = posQuoteCollPlusPoolQuoteDebt.sub(poolQuoteCollateral);
      uint256 baseCollToReduce = basePrice.recipMul(quoteDebtToReduce);
      uint256 positionBaseDebt = baseDebtCoeff.mul(position.discountedBaseAmount);
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

  function _enactMarginCallShort(Position storage position) internal override {
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
      // swapPriceX96 = getSwapPrice(realQuoteCollateral, swappedBaseDebt);
    }

    FP96.FixedPoint memory factor;
    // baseCollateralCoeff += rcd * (rqc - sqc) / sqc
    if (swappedBaseDebt >= realBaseDebt) {
      // Position has enough collateral to repay debt
      factor = FP96.one().add(FP96.fromRatio(swappedBaseDebt.sub(realBaseDebt), _calcRealBaseCollateralTotal()));
    } else {
      // Position's debt has been repaid by pool
      factor = FP96.one().sub(FP96.fromRatio(realBaseDebt.sub(swappedBaseDebt), _calcRealBaseCollateralTotal()));
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
    uint256 badPositionBaseDebt = baseDebtCoeff.mul(badPosition.discountedBaseAmount);
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
    if (discountedQuoteCollateral == 0) {
      shortX96Leverage = uint128(FP96.Q96);
      return;
    }

    uint256 realQuoteCollateral = _calcRealQuoteCollateral(discountedQuoteCollateral, discountedBaseDebt);
    uint256 realBaseDebt = baseDebtCoeff.mul(basePrice).mul(discountedBaseDebt);
    uint128 leverageX96 = uint128(Math.mulDiv(FP96.Q96, realQuoteCollateral, realQuoteCollateral.sub(realBaseDebt)));
    uint128 maxLeverageX96 = uint128(params.maxLeverage) << FP96.RESOLUTION;
    shortX96Leverage = leverageX96 < maxLeverageX96 ? leverageX96 : maxLeverageX96;
  }

  function _accrueInterestShort(
    uint256 secondsPassed,
    FP96.FixedPoint memory secondsInYear,
    FP96.FixedPoint memory interestRate,
    FP96.FixedPoint memory feeDt
  ) internal virtual override returns (uint256 discountedBaseFee) {
    if (discountedBaseCollateral != 0) {
      FP96.FixedPoint memory baseDebtCoeffPrev = baseDebtCoeff;
      uint256 realBaseDebtPrev = baseDebtCoeffPrev.mul(discountedBaseDebt);
      FP96.FixedPoint memory onePlusIR = interestRate
        .mul(FP96.FixedPoint({inner: shortX96Leverage}))
        .div(secondsInYear)
        .add(FP96.one());

      // AR(dt) =  (1+ ir)^dt
      FP96.FixedPoint memory accruedRateDt = FP96.powTaylor(onePlusIR, secondsPassed);
      baseDebtCoeff = baseDebtCoeffPrev.mul(accruedRateDt).mul(feeDt);
      FP96.FixedPoint memory factor = FP96.one().add(
        FP96.fromRatio(accruedRateDt.sub(FP96.one()).mul(realBaseDebtPrev), _calcRealBaseCollateralTotal())
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
    return quoteCollateralCoeff.mul(disQuoteCollateral).sub(quoteDelevCoeff.mul(disBaseDebt));
  }

  function _calcRealBaseDebt(uint256 disBaseDebt) internal view virtual override returns (uint256) {
    return baseDebtCoeff.mul(disBaseDebt);
  }

  function _getWorstShortPositionOwner() internal view virtual override returns (address) {
    (, MaxBinaryHeapLib.Node memory root) = shortHeap.getNodeByIndex(0);
    return root.account;
  }

  function _updateHeapShort(Position storage position) internal virtual override {
    uint96 sortKey = _calcSortKey(position.discountedQuoteAmount, initialPrice.mul(position.discountedBaseAmount));
    uint32 heapIndex = position.heapPosition - 1;
    shortHeap.update(positions, heapIndex, sortKey);
  }
}
