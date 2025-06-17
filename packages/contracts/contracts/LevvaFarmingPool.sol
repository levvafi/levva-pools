// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import './base/trading/LongTrading.sol';
import './base/farming/ShortFarming.sol';
import './base/Emergency.sol';

contract LevvaFarmingPool is LongTrading, ShortFarming, Emergency {
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

    __LevvaPoolCommon_init(_quoteToken, _baseToken, _priceOracle, _defaultSwapCallData, _params);
    __LongTrading_init();
  }

  /// @param flag unwrapETH in case of withdraw calls or syncBalance in case of reinit call
  function execute(
    CallType call,
    uint256 amount1,
    int256 amount2,
    uint256 limitPriceX96,
    bool flag,
    address positionAddress,
    uint256 swapCalldata
  ) external payable override lock {
    if (call == CallType.ReceivePosition) {
      if (amount2 < 0) revert MarginlyErrors.WrongValue();
      _receivePosition(positionAddress, amount1, uint256(amount2));
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

    (Position storage position, address positionOwner) = _getPosition(positionAddress);

    if (_positionHasBadLeverage(position, basePrice)) {
      _liquidate(msg.sender, position, basePrice);
      _updateSystemLeverages(basePrice);
      return;
    }

    if (call == CallType.DepositBase) {
      _depositBase(amount1, basePrice, position, positionOwner);
      if (amount2 > 0) {
        _long(uint256(amount2), limitPriceX96, basePrice, position, positionOwner, swapCalldata);
      } else if (amount2 < 0) {
        _short(uint256(-amount2), limitPriceX96, basePrice, position, positionOwner, swapCalldata);
      }
    } else if (call == CallType.DepositQuote) {
      _depositQuote(amount1, position, positionOwner);
      if (amount2 > 0) {
        _short(uint256(amount2), limitPriceX96, basePrice, position, positionOwner, swapCalldata);
      } else if (amount2 < 0) {
        _long(uint256(-amount2), limitPriceX96, basePrice, position, positionOwner, swapCalldata);
      }
    } else if (call == CallType.WithdrawBase) {
      _withdrawBase(amount1, flag, basePrice, position);
    } else if (call == CallType.WithdrawQuote) {
      _withdrawQuote(amount1, flag, basePrice, position);
    } else if (call == CallType.Short) {
      _short(amount1, limitPriceX96, basePrice, position, positionOwner, swapCalldata);
    } else if (call == CallType.Long) {
      _long(amount1, limitPriceX96, basePrice, position, positionOwner, swapCalldata);
    } else if (call == CallType.ClosePosition) {
      _closePosition(limitPriceX96, position, swapCalldata);
    } else if (call == CallType.SellCollateral) {
      _sellCollateral(limitPriceX96, position, swapCalldata);
      if (flag) {
        _withdrawQuote(type(uint256).max, false, basePrice, position);
      }
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
  ) external view returns (bool success, MaxBinaryHeapLib.Node memory node) {
    if (_short) {
      return (false, node);
    } else {
      return longHeap.getNodeByIndex(index);
    }
  }

  function _calcRealBaseCollateralTotal() internal view override(LevvaPoolCommon, LongTrading) returns (uint256) {
    return LongTrading._calcRealBaseCollateralTotal();
  }

  function _calcRealQuoteDebtTotal() internal view override(LevvaPoolVirtual, LongTrading) returns (uint256) {
    return LongTrading._calcRealQuoteDebtTotal();
  }

  function _calcRealBaseCollateral(
    uint256 disBaseCollateral,
    uint256 disQuoteDebt
  ) internal view override(LevvaPoolCommon, LongTrading) returns (uint256) {
    return LongTrading._calcRealBaseCollateral(disBaseCollateral, disQuoteDebt);
  }

  function _calcRealQuoteDebt(
    uint256 disQuoteDebt
  ) internal view override(LevvaPoolVirtual, LongTrading) returns (uint256) {
    return LongTrading._calcRealQuoteDebt(disQuoteDebt);
  }

  function _updateBaseCollateralCoeffs(FP96.FixedPoint memory factor) internal override(LevvaPoolCommon, LongTrading) {
    return LongTrading._updateBaseCollateralCoeffs(factor);
  }

  function _deleverageLong(
    uint256 realQuoteCollateral,
    uint256 realBaseDebt
  ) internal override(LongTrading, LevvaPoolVirtual) {
    LongTrading._deleverageLong(realQuoteCollateral, realBaseDebt);
  }

  function _getWorstLongPositionOwner() internal view override(LongTrading, LevvaPoolVirtual) returns (address) {
    return LongTrading._getWorstLongPositionOwner();
  }

  function _updateHeapLong(Position storage position) internal override(LongTrading, LevvaPoolVirtual) {
    return LongTrading._updateHeapLong(position);
  }
}
