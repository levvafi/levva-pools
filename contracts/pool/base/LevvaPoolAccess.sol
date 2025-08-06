// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import '@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/access/Ownable2Step.sol';
import '@openzeppelin/contracts/utils/Address.sol';

import './LevvaPoolCommon.sol';
import '../interfaces/IMarginlyFactory.sol';
import '../interfaces/IPriceOracle.sol';

abstract contract LevvaPoolAccess is LevvaPoolCommon {
  using FP96 for FP96.FixedPoint;
  using LowGasSafeMath for uint256;

  /// @dev reentrancy guard
  bool private locked;

  /// @dev Protects against reentrancy
  modifier lock() {
    _lock();
    _;
    delete locked;
  }

  modifier onlyFactoryOwner() {
    _onlyFactoryOwner();
    _;
  }

  function sweepETH() external onlyFactoryOwner {
    if (address(this).balance > 0) {
      Address.sendValue(payable(msg.sender), address(this).balance);
    }
  }

  function setParameters(MarginlyParams calldata _params) external onlyFactoryOwner {
    _setParameters(_params);
  }

  function _lock() private {
    if (locked) revert MarginlyErrors.Locked();
    locked = true;
  }

  function _onlyFactoryOwner() private view {
    if (msg.sender != Ownable2Step(factory).owner()) revert MarginlyErrors.AccessDenied();
  }
}
