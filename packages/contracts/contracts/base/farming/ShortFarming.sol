// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';

import '../Liquidations.sol';

abstract contract ShortFarming is Liquidations {
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
  uint256 public shortLeverageX96 = FP96.one().inner;

  error ShortUnavailable();

  /// @notice Short is no availible for farming pools
  function _short(uint256, uint256, FP96.FixedPoint memory, Position storage, address, uint256) internal pure override {
    revert ShortUnavailable();
  }

  function _closeShortPosition(
    uint256,
    Position storage,
    uint256
  ) internal pure override returns (uint256, uint256, uint256) {
    revert ShortUnavailable();
  }

  function _repayBaseDebt(uint256, FP96.FixedPoint memory, Position storage) internal pure override {
    revert ShortUnavailable();
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

    uint256 realBaseDebt = baseDebtCoeff.mul(posDiscountedBaseDebt);
    uint256 discountedBaseCollateralDelta = baseCollateralCoeff.recipMul(baseAmountOut.sub(realBaseDebt));

    discountedQuoteCollateral -= posDiscountedQuoteColl;
    position.discountedQuoteAmount = 0;
    discountedBaseCollateral += discountedBaseCollateralDelta;
    position.discountedBaseAmount += discountedBaseCollateralDelta;

    emit SellQuoteForBase(
      positionOwner,
      quoteInSubFee,
      baseAmountOut,
      posDiscountedQuoteColl,
      discountedBaseCollateralDelta
    );
  }

  function _liquidateShort(Position storage, FP96.FixedPoint memory) internal pure override {
    return;
  }

  function _enactMarginCallShort(Position storage) internal pure override returns (uint256, uint256, int256) {
    return (0, 0, 0);
  }

  function _receiveShort(Position storage, Position storage, uint256, uint256) internal pure virtual override {
    return;
  }

  function _updateSystemLeverageShort(FP96.FixedPoint memory) internal virtual override {
    return;
  }

  function _accrueInterestShort(
    uint256,
    FP96.FixedPoint memory,
    FP96.FixedPoint memory,
    FP96.FixedPoint memory
  ) internal pure virtual override returns (uint256 baseDebtDelta, uint256 discountedBaseFee) {
    return (0, 0);
  }

  function _deleverageShort(uint256, uint256) internal virtual override {
    return;
  }

  function _updateHeapShort(Position storage) internal pure virtual override {
    return;
  }
}
