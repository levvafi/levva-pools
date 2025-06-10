// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';

interface IUSDC is IERC20, IERC20Metadata {
  function owner() external view returns (address);

  function transferOwnership(address newOwner) external;

  function updateMasterMinter(address _newMasterMinter) external;

  function configureMinter(address minter, uint256 minterAllowedAmount) external returns (bool);

  function mint(address _to, uint256 _amount) external returns (bool);
}
