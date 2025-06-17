// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.28;

enum CallType {
  DepositBase,
  DepositQuote,
  WithdrawBase,
  WithdrawQuote,
  Short,
  Long,
  ClosePosition,
  SellCollateral,
  Reinit,
  ReceivePosition,
  EmergencyWithdraw
}
