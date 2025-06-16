// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/utils/Address.sol';

import '../interfaces/IWETH9.sol';
import '../dataTypes/Position.sol';
import '../libraries/FP96.sol';
import './LevvaPoolCommon.sol';

abstract contract Funding is LevvaPoolCommon {
  using FP96 for FP96.FixedPoint;
  using LowGasSafeMath for uint256;

  receive() external payable {
    if (msg.sender != _getWETH9Address()) revert MarginlyErrors.NotWETH9();
  }

  /// @notice Deposit base token
  /// @param amount Amount of base token to deposit
  /// @param basePrice current oracle base price, got by getBasePrice() method
  /// @param position msg.sender position
  function _depositBase(uint256 amount, FP96.FixedPoint memory basePrice, Position storage position) internal {
    if (amount == 0) revert MarginlyErrors.ZeroAmount();

    if (position._type == PositionType.Uninitialized) {
      position._type = PositionType.Lend;
    }

    if (position._type == PositionType.Short) {
      _repayBaseDebt(amount, basePrice, position);
    } else {
      if (basePrice.mul(_newPoolBaseBalance(amount)) > params.quoteLimit) revert MarginlyErrors.ExceedsLimit();

      // Lend position, increase collateral on amount
      // discountedCollateralDelta = amount / baseCollateralCoeff
      uint256 discountedCollateralDelta = baseCollateralCoeff.recipMul(amount);
      position.discountedBaseAmount = position.discountedBaseAmount.add(discountedCollateralDelta);

      // update aggregates
      discountedBaseCollateral = discountedBaseCollateral.add(discountedCollateralDelta);
    }

    _wrapAndTransferFrom(baseToken, msg.sender, amount);
    emit DepositBase(msg.sender, amount, position._type, position.discountedBaseAmount);
  }

  /// @notice Deposit quote token
  /// @param amount Amount of quote token
  /// @param position msg.sender position
  function _depositQuote(uint256 amount, Position storage position) internal {
    if (amount == 0) revert MarginlyErrors.ZeroAmount();

    if (position._type == PositionType.Uninitialized) {
      position._type = PositionType.Lend;
    }

    if (position._type == PositionType.Long) {
      _repayQuoteDebt(amount, position);
    } else {
      if (_newPoolQuoteBalance(amount) > params.quoteLimit) revert MarginlyErrors.ExceedsLimit();

      // Lend position, increase collateral on amount
      // discountedQuoteCollateralDelta = amount / quoteCollateralCoeff
      uint256 discountedQuoteCollateralDelta = quoteCollateralCoeff.recipMul(amount);
      position.discountedQuoteAmount = position.discountedQuoteAmount.add(discountedQuoteCollateralDelta);

      // update aggregates
      discountedQuoteCollateral = discountedQuoteCollateral.add(discountedQuoteCollateralDelta);
    }

    _wrapAndTransferFrom(quoteToken, msg.sender, amount);
    emit DepositQuote(msg.sender, amount, position._type, position.discountedQuoteAmount);
  }

  /// @notice Withdraw base token
  /// @param realAmount Amount of base token
  /// @param unwrapWETH flag to unwrap WETH to ETH
  /// @param basePrice current oracle base price, got by getBasePrice() method
  /// @param position msg.sender position
  function _withdrawBase(
    uint256 realAmount,
    bool unwrapWETH,
    FP96.FixedPoint memory basePrice,
    Position storage position
  ) internal {
    if (realAmount == 0) revert MarginlyErrors.ZeroAmount();

    PositionType _type = position._type;
    if (_type == PositionType.Uninitialized) revert MarginlyErrors.UninitializedPosition();
    if (_type == PositionType.Short) revert MarginlyErrors.WrongPositionType();

    uint256 positionBaseAmount = position.discountedBaseAmount;
    uint256 positionQuoteDebt = _type == PositionType.Lend ? 0 : position.discountedQuoteAmount;

    uint256 realBaseAmount = _calcRealBaseCollateral(positionBaseAmount, positionQuoteDebt);
    uint256 realAmountToWithdraw;
    uint256 discountedBaseCollateralDelta;
    if (realAmount >= realBaseAmount) {
      // full withdraw
      realAmountToWithdraw = realBaseAmount;
      discountedBaseCollateralDelta = positionBaseAmount;

      if (position.discountedQuoteAmount == 0) {
        delete positions[msg.sender];
      }
    } else {
      // partial withdraw
      realAmountToWithdraw = realAmount;
      discountedBaseCollateralDelta = baseCollateralCoeff.recipMul(realAmountToWithdraw);
    }

    if (_type == PositionType.Long) {
      uint256 realQuoteDebt = _calcRealQuoteDebt(positionQuoteDebt);
      // margin = (baseColl - baseCollDelta) - quoteDebt / price < minAmount
      // minAmount + quoteDebt / price > baseColl - baseCollDelta
      if (basePrice.recipMul(realQuoteDebt).add(params.positionMinAmount) > realBaseAmount.sub(realAmountToWithdraw)) {
        revert MarginlyErrors.LessThanMinimalAmount();
      }
    }

    position.discountedBaseAmount = positionBaseAmount.sub(discountedBaseCollateralDelta);
    discountedBaseCollateral = discountedBaseCollateral.sub(discountedBaseCollateralDelta);

    if (_positionHasBadLeverage(position, basePrice)) revert MarginlyErrors.BadLeverage();

    _unwrapAndTransfer(unwrapWETH, baseToken, msg.sender, realAmountToWithdraw);

    emit WithdrawBase(msg.sender, realAmountToWithdraw, discountedBaseCollateralDelta);
  }

  /// @notice Withdraw quote token
  /// @param realAmount Amount of quote token
  /// @param unwrapWETH flag to unwrap WETH to ETH
  /// @param basePrice current oracle base price, got by getBasePrice() method
  /// @param position msg.sender position
  function _withdrawQuote(
    uint256 realAmount,
    bool unwrapWETH,
    FP96.FixedPoint memory basePrice,
    Position storage position
  ) internal {
    if (realAmount == 0) revert MarginlyErrors.ZeroAmount();

    PositionType _type = position._type;
    if (_type == PositionType.Uninitialized) revert MarginlyErrors.UninitializedPosition();
    if (_type == PositionType.Long) revert MarginlyErrors.WrongPositionType();

    uint256 positionQuoteAmount = position.discountedQuoteAmount;
    uint256 positionBaseDebt = _type == PositionType.Lend ? 0 : position.discountedBaseAmount;

    uint256 realQuoteAmount = _calcRealQuoteCollateral(positionQuoteAmount, positionBaseDebt);
    uint256 realAmountToWithdraw;
    uint256 discountedQuoteCollateralDelta;
    if (realAmount >= realQuoteAmount) {
      // full withdraw
      realAmountToWithdraw = realQuoteAmount;
      discountedQuoteCollateralDelta = positionQuoteAmount;

      if (position.discountedBaseAmount == 0) {
        delete positions[msg.sender];
      }
    } else {
      // partial withdraw
      realAmountToWithdraw = realAmount;
      discountedQuoteCollateralDelta = quoteCollateralCoeff.recipMul(realAmountToWithdraw);
    }

    if (_type == PositionType.Short) {
      uint256 realBaseDebt = _calcRealBaseDebt(positionBaseDebt);
      // margin = (quoteColl - quoteCollDelta) - baseDebt * price < minAmount * price
      // (minAmount + baseDebt) * price > quoteColl - quoteCollDelta
      if (basePrice.mul(realBaseDebt.add(params.positionMinAmount)) > realQuoteAmount.sub(realAmountToWithdraw)) {
        revert MarginlyErrors.LessThanMinimalAmount();
      }
    }

    position.discountedQuoteAmount = positionQuoteAmount.sub(discountedQuoteCollateralDelta);
    discountedQuoteCollateral = discountedQuoteCollateral.sub(discountedQuoteCollateralDelta);

    if (_positionHasBadLeverage(position, basePrice)) revert MarginlyErrors.BadLeverage();

    _unwrapAndTransfer(unwrapWETH, quoteToken, msg.sender, realAmountToWithdraw);

    emit WithdrawQuote(msg.sender, realAmountToWithdraw, discountedQuoteCollateralDelta);
  }

  /// @dev Wraps ETH into WETH if need and makes transfer from `payer`
  function _wrapAndTransferFrom(address token, address payer, uint256 value) internal {
    if (msg.value >= value) {
      if (token == _getWETH9Address()) {
        IWETH9(token).deposit{value: value}();
        return;
      }
    }
    SafeERC20.safeTransferFrom(IERC20(token), payer, address(this), value);
  }

  /// @dev Unwraps WETH to ETH and makes transfer to `recipient`
  function _unwrapAndTransfer(bool unwrapWETH, address token, address recipient, uint256 value) internal {
    if (unwrapWETH) {
      if (token == _getWETH9Address()) {
        IWETH9(token).withdraw(value);
        Address.sendValue(payable(recipient), value);
        return;
      }
    }
    SafeERC20.safeTransfer(IERC20(token), recipient, value);
  }
}
