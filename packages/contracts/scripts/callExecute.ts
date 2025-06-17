import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

const hre: HardhatRuntimeEnvironment = require('hardhat');

enum CallType {
  DepositBase = 0,
  DepositQuote = 1,
  WithdrawBase = 2,
  WithdrawQuote = 3,
  Short = 4,
  Long = 5,
  ClosePosition = 6,
  SellCollateral = 7,
  Reinit = 8,
  ReceivePosition = 9,
  EmergencyWithdraw = 10,
}

// Example: npx hardhat --network arbitrumSepolia run ./scripts/callExecute.ts

async function main() {
  const signerPrivateKey = '';
  const marginlyPoolAddress = '';

  if (signerPrivateKey === '') {
    throw new Error('Signer privateKey not provided');
  }

  if (marginlyPoolAddress === '') {
    throw new Error('MarginlyPool address not provided');
  }

  const provider = new hre.ethers.providers.JsonRpcProvider((hre.network.config as any).url);
  const signer = new hre.ethers.Wallet(signerPrivateKey, provider);

  const marginlyPool = await hre.ethers.getContractAt('MarginlyPool', marginlyPoolAddress, signer);

  const call = CallType.Reinit;
  const amount1 = 0n;
  const amount2 = 0n;
  const limitPriceX96: BigNumber = 0n;
  const flag: boolean = false;
  const receivePositionAddress: string = ethers.constants.AddressZero;
  const swapCalldata: BigNumber = 0n;

  const tx = await marginlyPool.execute(
    call,
    amount1,
    amount2,
    limitPriceX96,
    flag,
    receivePositionAddress,
    swapCalldata
  );
  const txReceipt = await tx.wait();

  console.log(`Execute tx completed txHash: ${txReceipt.transactionHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
