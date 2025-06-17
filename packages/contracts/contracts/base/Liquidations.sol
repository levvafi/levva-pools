// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

import '../dataTypes/Position.sol';
import '../dataTypes/Mode.sol';
import '../libraries/MaxBinaryHeapLib.sol';
import '../libraries/FP96.sol';
import './Funding.sol';

abstract contract Liquidations is Funding {
  using FP96 for FP96.FixedPoint;
  using LowGasSafeMath for uint256;

  /// @dev FP96 inner value of count of seconds in year. Equal 365.25 * 24 * 60 * 60
  uint256 private constant SECONDS_IN_YEAR_X96 = 2500250661360148260042022567123353600;

  function _accrueInterest() internal returns (bool) {
    uint256 secondsPassed = block.timestamp - lastReinitTimestampSeconds;
    if (secondsPassed == 0) {
      return false;
    }
    lastReinitTimestampSeconds = block.timestamp;

    FP96.FixedPoint memory secondsInYear = FP96.FixedPoint({inner: SECONDS_IN_YEAR_X96});
    FP96.FixedPoint memory interestRate = FP96.fromRatio(params.interestRate, WHOLE_ONE);
    FP96.FixedPoint memory onePlusFee = FP96.fromRatio(params.fee, WHOLE_ONE).div(secondsInYear).add(FP96.one());

    // FEE(dt) = (1 + fee)^dt
    FP96.FixedPoint memory feeDt = FP96.powTaylor(onePlusFee, secondsPassed);

    (uint256 baseDebtDelta, uint256 discountedBaseFee) = _accrueInterestShort(
      secondsPassed,
      secondsInYear,
      interestRate,
      feeDt
    );
    (uint256 quoteDebtDelta, uint256 discountedQuoteFee) = _accrueInterestLong(
      secondsPassed,
      secondsInYear,
      interestRate,
      feeDt
    );

    // keep debt fee in technical position
    if (discountedBaseFee != 0 || discountedQuoteFee != 0) {
      Position storage techPosition = _getTechPosition();
      techPosition.discountedBaseAmount = techPosition.discountedBaseAmount.add(discountedBaseFee);
      techPosition.discountedQuoteAmount = techPosition.discountedQuoteAmount.add(discountedQuoteFee);

      discountedBaseCollateral = discountedBaseCollateral.add(discountedBaseFee);
      discountedQuoteCollateral = discountedQuoteCollateral.add(discountedQuoteFee);
    }

    emit Reinit(lastReinitTimestampSeconds, baseDebtDelta, quoteDebtDelta);

    return true;
  }

  function _reinit() internal returns (bool callerMarginCalled, FP96.FixedPoint memory basePrice) {
    basePrice = getBasePrice();
    if (!_accrueInterest()) {
      return (callerMarginCalled, basePrice); // (false, basePrice)
    }

    address worstOwner = _getWorstShortPositionOwner();
    if (worstOwner != address(0)) {
      bool marginCallHappened = _reinitAccount(worstOwner, basePrice);
      callerMarginCalled = marginCallHappened && worstOwner == msg.sender;
    }

    worstOwner = _getWorstLongPositionOwner();
    if (worstOwner != address(0)) {
      bool marginCallHappened = _reinitAccount(worstOwner, basePrice);
      callerMarginCalled = callerMarginCalled || (marginCallHappened && worstOwner == msg.sender); // since caller can be in short or long position
    }
  }

  /// @dev Recalculates and saves user leverage and enact marginal if needed
  function _reinitAccount(address user, FP96.FixedPoint memory basePrice) internal returns (bool marginCallHappened) {
    Position storage position = positions[user];

    marginCallHappened = _positionHasBadLeverage(position, basePrice);
    if (marginCallHappened) {
      _liquidate(user, position, basePrice);
    }
  }

  /// @dev User liquidation: applies deleverage if needed then enacts MC
  /// @param user User's address
  /// @param position User's position to reinit
  function _liquidate(address user, Position storage position, FP96.FixedPoint memory basePrice) internal {
    if (position._type == PositionType.Long) {
      _liquidateLong(position, basePrice);
    } else if (position._type == PositionType.Short) {
      _liquidateShort(position, basePrice);
    } else {
      revert MarginlyErrors.WrongPositionType();
    }
    _enactMarginCall(user, position);
  }

  /// @dev Enact margin call procedure for the position
  /// @param positionOwner User's address
  /// @param position User's position to reinit
  function _enactMarginCall(address positionOwner, Position storage position) private {
    uint256 baseDelta;
    uint256 quoteDelta;
    int256 collateralSurplus;
    PositionType _type = position._type;
    // it's guaranteed by liquidate() function, that position._type is either Short or Long
    // else is used to save some contract space
    if (_type == PositionType.Long) {
      (baseDelta, quoteDelta, collateralSurplus) = _enactMarginCallLong(position);
    } else {
      (quoteDelta, baseDelta, collateralSurplus) = _enactMarginCallShort(position);
    }

    delete positions[positionOwner];
    emit EnactMarginCall(positionOwner, _calcSwapPrice(quoteDelta, baseDelta), collateralSurplus, _type);
  }

  /// @notice Liquidate bad position and receive position collateral and debt
  /// @param badPositionAddress address of position to liquidate
  /// @param quoteAmount amount of quote token to be deposited
  /// @param baseAmount amount of base token to be deposited
  function _receivePosition(address badPositionAddress, uint256 quoteAmount, uint256 baseAmount) internal {
    if (mode != Mode.Regular) revert MarginlyErrors.EmergencyMode();

    Position storage position = positions[msg.sender];
    if (position._type != PositionType.Uninitialized) revert MarginlyErrors.PositionInitialized();

    _accrueInterest();
    Position storage badPosition = positions[badPositionAddress];

    FP96.FixedPoint memory basePrice = getBasePrice();
    if (!_positionHasBadLeverage(badPosition, basePrice)) revert MarginlyErrors.NotLiquidatable();

    // previous require guarantees that position is either long or short
    if (badPosition._type == PositionType.Long) {
      _receiveLong(badPosition, position, baseAmount, quoteAmount);
    } else {
      _receiveShort(badPosition, position, baseAmount, quoteAmount);
    }

    _updateHeap(position);
    _updateSystemLeverages(basePrice);

    delete positions[badPositionAddress];

    if (_positionHasBadLeverage(position, basePrice)) revert MarginlyErrors.BadLeverage();
    _wrapAndTransferFrom(baseToken, msg.sender, baseAmount);
    _wrapAndTransferFrom(quoteToken, msg.sender, quoteAmount);

    emit ReceivePosition(
      msg.sender,
      badPositionAddress,
      position._type,
      position.discountedQuoteAmount,
      position.discountedBaseAmount
    );
  }

  function _updateHeap(Position storage position) internal {
    if (position._type == PositionType.Long) {
      _updateHeapLong(position);
    } else if (position._type == PositionType.Short) {
      _updateHeapShort(position);
    }
  }

  function _updateSystemLeverages(FP96.FixedPoint memory basePrice) internal {
    _updateSystemLeverageLong(basePrice);
    _updateSystemLeverageShort(basePrice);
  }
}
