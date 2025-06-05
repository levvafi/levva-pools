// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

contract TestCurveStableSwapNGPool {
  address public _coin0;
  address public _coin1;

  uint256 public last_price = 0;
  uint256 public ema_price = 0;
  uint256 public price_oracle = 0;

  constructor(address coin0, address coin1) {
    _coin0 = coin0;
    _coin1 = coin1;
  }

  function coins(uint256 coinId) external view returns (address) {
    require(coinId < 2, 'coinId must be 0 or 1');
    if (coinId == 0) {
      return _coin0;
    }
    return _coin1;
  }

  function setPrices(uint256 _last_price, uint256 _ema_price, uint256 _price_oracle) external {
    last_price = _last_price;
    ema_price = _ema_price;
    price_oracle = _price_oracle;
  }
}
