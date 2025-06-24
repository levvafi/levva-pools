// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/access/Ownable2Step.sol';

import '../pool/interfaces/IMarginlyFactory.sol';
import '../pool/dataTypes/Position.sol';

contract MockMarginlyFactory is IMarginlyFactory, Ownable2Step {
  address public override swapRouter;

  constructor(address initialOwner, address _swapRouter) Ownable(initialOwner == address(0) ? msg.sender : initialOwner) {
    swapRouter = _swapRouter;
  }

  function createPool(
    address,
    address,
    address,
    uint32,
    MarginlyParams memory
  ) external pure override returns (address pool) {
    return address(0);
  }

  function changeSwapRouter(address newSwapRouter) external onlyOwner {
    swapRouter = newSwapRouter;
  }

  /// @notice Swap fee holder address
  function feeHolder() external pure override returns (address) {
    return address(0);
  }

  function WETH9() external view override returns (address) {}

  function techPositionOwner() external view returns (address) {}
}
