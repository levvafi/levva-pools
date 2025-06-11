// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import '../interfaces/IMarginlyPool.sol';
import '../interfaces/IMarginlyFactory.sol';
import '../interfaces/IPriceOracle.sol';

abstract contract LevvaVirtual is IMarginlyPool {
  // =============================================
  // ============ Levva math methods =============
  // =============================================

  function _calcRealBaseCollateralTotal() internal view virtual returns (uint256) {
    return 0;
  }

  function _calcRealQuoteCollateralTotal() internal view virtual returns (uint256) {
    return 0;
  }

  function _calcRealBaseDebtTotal() internal view virtual returns (uint256) {
    return 0;
  }

  function _calcRealQuoteDebtTotal() internal view virtual returns (uint256) {
    return 0;
  }

  function _calcRealBaseCollateral(
    uint256 /*disBaseCollateral*/,
    uint256 /*disQuoteDebt*/
  ) internal view virtual returns (uint256) {
    return 0;
  }

  function _calcRealQuoteCollateral(
    uint256 /*disQuoteCollateral*/,
    uint256 /*disBaseDebt*/
  ) internal view virtual returns (uint256) {
    return 0;
  }

  function _calcRealBaseDebt(uint256 /*disQuoteDebt*/) internal view virtual returns (uint256) {
    return 0;
  }

  function _calcRealQuoteDebt(uint256 /*disQuoteDebt*/) internal view virtual returns (uint256) {
    return 0;
  }

  // =============================================
  // ========= Interest rate calculations ========
  // =============================================

  function _accrueInterestLong(
    uint256 secondsPassed,
    FP96.FixedPoint memory secondsInYear,
    FP96.FixedPoint memory interestRate,
    FP96.FixedPoint memory feeDt
  ) internal virtual returns (uint256 discountedQuoteFee);

  function _accrueInterestShort(
    uint256 secondsPassed,
    FP96.FixedPoint memory secondsInYear,
    FP96.FixedPoint memory interestRate,
    FP96.FixedPoint memory feeDt
  ) internal virtual returns (uint256 discountedBaseFee);

  // =============================================
  // ======== Position liquidation methods =======
  // =============================================

  function _liquidateLong(Position storage position, FP96.FixedPoint memory basePrice) internal virtual;

  function _liquidateShort(Position storage position, FP96.FixedPoint memory basePrice) internal virtual;

  function _receiveLong(
    Position storage badPosition,
    Position storage position,
    uint256 baseAmount,
    uint256 quoteAmount
  ) internal virtual;

  function _receiveShort(
    Position storage badPosition,
    Position storage position,
    uint256 baseAmount,
    uint256 quoteAmount
  ) internal virtual;

  function _enactMarginCallLong(Position storage position) internal virtual;

  function _enactMarginCallShort(Position storage position) internal virtual;

  function _deleverageLong(uint256 realBaseCollateral, uint256 realQuoteDebt) internal virtual;

  function _deleverageShort(uint256 realQuoteCollateral, uint256 realBaseDebt) internal virtual;

  function _getWorstLongPositionOwner() internal view virtual returns (address) {
    return address(0);
  }

  function _getWorstShortPositionOwner() internal view virtual returns (address) {
    return address(0);
  }

  // =============================================
  // ======= Position funds update methods =======
  // =============================================

  function _repayBaseDebt(uint256 amount, FP96.FixedPoint memory basePrice, Position storage position) internal virtual;

  function _repayQuoteDebt(uint256 amount, Position storage position) internal virtual;

  function _sellQuoteForBase(Position storage position, uint256 limitPriceX96, uint256 swapCalldata) internal virtual;

  function _sellBaseForQuote(Position storage position, uint256 limitPriceX96, uint256 swapCalldata) internal virtual;

  // =============================================
  // =========== System update methods ===========
  // =============================================

  function _updateBaseCollateralCoeffs(FP96.FixedPoint memory factor) internal virtual;

  function _updateQuoteCollateralCoeffs(FP96.FixedPoint memory factor) internal virtual;

  function _updateHeapLong(Position storage position) internal virtual;

  function _updateHeapShort(Position storage position) internal virtual;

  function _updateSystemLeverageLong(FP96.FixedPoint memory basePrice) internal virtual;

  function _updateSystemLeverageShort(FP96.FixedPoint memory basePrice) internal virtual;
}
