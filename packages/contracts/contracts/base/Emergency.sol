// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;
import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';

import '../dataTypes/Mode.sol';
import '../libraries/FP96.sol';
import './Liquidations.sol';
import './LevvaPoolAccess.sol';

abstract contract Emergency is Liquidations, LevvaPoolAccess {
  using FP96 for FP96.FixedPoint;
  using LowGasSafeMath for uint256;

  /// @dev Ratio of best side collaterals before and after margin call of opposite side in shutdown mode
  FP96.FixedPoint public emergencyWithdrawCoeff;
  FP96.FixedPoint public shutDownPrice;

  /// @inheritdoc IMarginlyPoolOwnerActions
  function shutDown(uint256 swapCalldata) external onlyFactoryOwner lock {
    if (mode != Mode.Regular) revert MarginlyErrors.EmergencyMode();
    _accrueInterest();

    _syncBaseBalance();
    _syncQuoteBalance();

    FP96.FixedPoint memory basePrice = getBasePrice();

    /* We use Rounding.Up in baseDebt/quoteDebt calculation 
       to avoid case when "surplus = quoteCollateral - quoteDebt"
       a bit more than IERC20(quoteToken).balanceOf(address(this))
     */

    uint256 baseDebt = _calcRealBaseDebtTotal(); // TODO: Math.Rounding.Ceil
    uint256 quoteCollateral = _calcRealQuoteCollateralTotal();

    uint256 quoteDebt = _calcRealQuoteDebtTotal(); // TODO: Math.Rounding.Ceil
    uint256 baseCollateral = _calcRealBaseCollateralTotal();

    if (basePrice.mul(baseDebt) > quoteCollateral) {
      // removing all non-emergency position with bad leverages (negative net positions included)
      address worstOwner = _getWorstLongPositionOwner();
      if (worstOwner != address(0)) {
        if (_reinitAccount(worstOwner, basePrice)) {
          return;
        }
      }

      _setEmergencyMode(
        Mode.ShortEmergency,
        basePrice,
        baseCollateral,
        baseDebt,
        quoteCollateral,
        quoteDebt,
        swapCalldata
      );
      return;
    }

    if (quoteDebt > basePrice.mul(baseCollateral)) {
      // removing all non-emergency position with bad leverages (negative net positions included)
      address worstOwner = _getWorstShortPositionOwner();
      if (worstOwner != address(0)) {
        if (_reinitAccount(worstOwner, basePrice)) {
          return;
        }
      }

      _setEmergencyMode(
        Mode.LongEmergency,
        basePrice,
        quoteCollateral,
        quoteDebt,
        baseCollateral,
        baseDebt,
        swapCalldata
      );
      return;
    }

    revert MarginlyErrors.NotEmergency();
  }

  ///@dev Set emergency mode and calc emergencyWithdrawCoeff
  function _setEmergencyMode(
    Mode _mode,
    FP96.FixedPoint memory _shutDownPrice,
    uint256 collateral,
    uint256 debt,
    uint256 emergencyCollateral,
    uint256 emergencyDebt,
    uint256 swapCalldata
  ) private {
    mode = _mode;
    shutDownPrice = _shutDownPrice;

    uint256 balance = collateral >= debt ? collateral.sub(debt) : 0;

    if (emergencyCollateral > emergencyDebt) {
      uint256 surplus = emergencyCollateral.sub(emergencyDebt);

      uint256 collateralSurplus = _swapExactInput(_mode == Mode.ShortEmergency, surplus, 0, swapCalldata);

      balance = balance.add(collateralSurplus);
    }

    if (mode == Mode.ShortEmergency) {
      // coeff = price * baseBalance / (price * baseCollateral - quoteDebt)
      emergencyWithdrawCoeff = FP96.fromRatio(
        _shutDownPrice.mul(balance),
        _shutDownPrice.mul(collateral).sub(emergencyDebt)
      );
    } else {
      // coeff = quoteBalance / (quoteCollateral - price * baseDebt)
      emergencyWithdrawCoeff = FP96.fromRatio(balance, collateral.sub(_shutDownPrice.mul(emergencyDebt)));
    }

    emit Emergency(_mode);
  }

  /// @notice Withdraw position collateral in emergency mode
  /// @param unwrapWETH flag to unwrap WETH to ETH
  function _emergencyWithdraw(bool unwrapWETH) internal {
    if (mode == Mode.Regular) revert MarginlyErrors.NotEmergency();

    Position memory position = positions[msg.sender];
    if (position._type == PositionType.Uninitialized) revert MarginlyErrors.UninitializedPosition();

    address token;
    uint256 transferAmount;

    if (mode == Mode.ShortEmergency) {
      if (position._type == PositionType.Short) revert MarginlyErrors.ShortEmergency();

      // baseNet =  baseColl - quoteDebt / price
      uint256 positionBaseNet = _calcRealBaseCollateral(position.discountedBaseAmount, position.discountedQuoteAmount)
        .sub(shutDownPrice.recipMul(_calcRealQuoteDebt(position.discountedQuoteAmount)));
      transferAmount = emergencyWithdrawCoeff.mul(positionBaseNet);
      token = baseToken;
    } else {
      if (position._type == PositionType.Long) revert MarginlyErrors.LongEmergency();

      // quoteNet = quoteColl - baseDebt * price
      uint256 positionQuoteNet = _calcRealQuoteCollateral(position.discountedQuoteAmount, position.discountedBaseAmount)
        .sub(shutDownPrice.mul(_calcRealBaseDebt(position.discountedBaseAmount)));
      transferAmount = emergencyWithdrawCoeff.mul(positionQuoteNet);
      token = quoteToken;
    }

    delete positions[msg.sender];
    _unwrapAndTransfer(unwrapWETH, token, msg.sender, transferAmount);

    emit EmergencyWithdraw(msg.sender, token, transferAmount);
  }
}
