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
  uint256 public shortX96Leverage = FP96.one().inner;

  error ShortUnavailable();

  /// @notice Short is no availible for farming pools
  function _short(uint256, uint256, FP96.FixedPoint memory, Position storage, uint256) internal pure {
    revert ShortUnavailable();
  }

  function _closeShortPosition(uint256, Position storage, uint256) internal pure returns (uint256, uint256) {
    revert ShortUnavailable();
  }

  function _liquidateShort(Position storage, FP96.FixedPoint memory) internal pure override {
    return;
  }

  function _enactMarginCallShort(Position storage) internal pure override {
    return;
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
  ) internal pure virtual override returns (uint256 discountedBaseFee) {
    return 0;
  }

  function _deleverageShort(uint256, uint256) internal virtual override {
    return;
  }

  function _calcRealBaseDebtTotal() internal view virtual override returns (uint256) {
    return 0;
  }

  function _calcRealBaseDebt(uint256) internal pure virtual override returns (uint256) {
    return 0;
  }

  function _getWorstShortPositionOwner() internal pure virtual override returns (address) {
    return address(0);
  }

  function _updateHeapShort(Position storage) internal pure virtual override {
    return;
  }
}
