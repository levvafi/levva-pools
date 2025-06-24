// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/access/Ownable2Step.sol';

import '../interfaces/IMarginlyPool.sol';
import '../dataTypes/Position.sol';
import '../dataTypes/Call.sol';

contract MockMarginlyPool is IMarginlyPool {
  address public override quoteToken;
  address public override baseToken;
  address public override factory;
  uint32 public override defaultSwapCallData;
  MarginlyParams public params;

  address private badPositionAddress;
  uint256 private quoteAmount;
  uint256 private baseAmount;
  uint256 private dust = 1000; // some sweep
  PositionType private positionType;

  constructor(address _factory, address _quoteToken, address _baseToken) {
    factory = _factory;
    quoteToken = _quoteToken;
    baseToken = _baseToken;
  }

  function _onlyFactoryOwner() private view {
    if (msg.sender != Ownable2Step(factory).owner()) revert('Access denied');
  }

  modifier onlyFactoryOwner() {
    _onlyFactoryOwner();
    _;
  }

  function setBadPosition(
    address _badPositionAddress,
    uint256 _quoteAmount,
    uint256 _baseAmount,
    PositionType _positionType
  ) external {
    badPositionAddress = _badPositionAddress;
    quoteAmount = _quoteAmount;
    baseAmount = _baseAmount;

    require(_positionType == PositionType.Short || _positionType == PositionType.Long, 'Wrong position type');
    positionType = _positionType;
  }

  function initialize(
    address _quoteToken,
    address _baseToken,
    address _priceOracle,
    uint32 _defaultSwapCallData,
    MarginlyParams memory _params
  ) external {}

  function setParameters(MarginlyParams calldata _params) external onlyFactoryOwner {
    params = _params;
  }

  function shutDown(uint256 swapCalldata) external onlyFactoryOwner {}

  function sweepETH() external onlyFactoryOwner {}

  function setRecoveryMode(bool set) external {}

  function priceOracle() external pure returns (address) {}

  function execute(
    CallType call,
    uint256 amount1,
    int256 amount2,
    uint256,
    bool,
    address receivePositionAddress,
    uint256
  ) external payable override {
    if (call == CallType.ReceivePosition) {
      require(receivePositionAddress == badPositionAddress);

      IERC20(quoteToken).transferFrom(msg.sender, address(this), amount1);
      IERC20(baseToken).transferFrom(msg.sender, address(this), uint256(amount2));
    } else if (call == CallType.WithdrawBase) {
      if (positionType == PositionType.Short) {
        IERC20(baseToken).transfer(msg.sender, dust);
      } else {
        IERC20(baseToken).transfer(msg.sender, baseAmount);
      }
    } else if (call == CallType.WithdrawQuote) {
      if (positionType == PositionType.Short) {
        IERC20(quoteToken).transfer(msg.sender, quoteAmount);
      } else {
        IERC20(quoteToken).transfer(msg.sender, dust);
      }
    }
  }

  function getBasePrice() external view returns (FP96.FixedPoint memory) {}
}
