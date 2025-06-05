// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

import '@pythnetwork/pyth-sdk-solidity/IPyth.sol';

contract MockPyth is IPyth {
  error NotImplemented();
  error StalePrice();

  mapping(bytes32 => PythStructs.Price) public prices;

  function setPrice(bytes32 id, int64 price, int32 expo, uint64 publishTime) external {
    prices[id] = PythStructs.Price({price: price, conf: 0, expo: expo, publishTime: publishTime});
  }

  function getPrice(bytes32 id) external view returns (PythStructs.Price memory price) {
    return prices[id];
  }

  function getValidTimePeriod() external pure returns (uint) {
    revert NotImplemented();
  }

  function getEmaPrice(bytes32) external pure returns (PythStructs.Price memory) {
    revert NotImplemented();
  }

  function getPriceUnsafe(bytes32) external pure returns (PythStructs.Price memory) {
    revert NotImplemented();
  }

  function getPriceNoOlderThan(bytes32 id, uint age) external view returns (PythStructs.Price memory price) {
    price = prices[id];
    if (price.publishTime < block.timestamp - age) revert StalePrice();
  }

  function getEmaPriceUnsafe(bytes32) external pure returns (PythStructs.Price memory) {
    revert NotImplemented();
  }

  function getEmaPriceNoOlderThan(bytes32, uint) external pure returns (PythStructs.Price memory) {
    revert NotImplemented();
  }

  function updatePriceFeeds(bytes[] calldata) external payable {
    revert NotImplemented();
  }

  function updatePriceFeedsIfNecessary(bytes[] calldata, bytes32[] calldata, uint64[] calldata) external payable {
    revert NotImplemented();
  }

  function getUpdateFee(bytes[] calldata) external pure returns (uint) {
    revert NotImplemented();
  }

  function parsePriceFeedUpdates(
    bytes[] calldata,
    bytes32[] calldata,
    uint64,
    uint64
  ) external payable returns (PythStructs.PriceFeed[] memory) {
    revert NotImplemented();
  }

  function parsePriceFeedUpdatesUnique(
    bytes[] calldata,
    bytes32[] calldata,
    uint64,
    uint64
  ) external payable returns (PythStructs.PriceFeed[] memory) {
    revert NotImplemented();
  }

  function parseTwapPriceFeedUpdates(
    bytes[] calldata,
    bytes32[] calldata
  ) external payable override returns (PythStructs.TwapPriceFeed[] memory) {
    revert NotImplemented();
  }

  function parsePriceFeedUpdatesWithSlots(
    bytes[] calldata,
    bytes32[] calldata,
    uint64,
    uint64
  ) external payable override returns (PythStructs.PriceFeed[] memory, uint64[] memory) {
    revert NotImplemented();
  }
}
