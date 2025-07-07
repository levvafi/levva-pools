import { ContractTransactionReceipt, EventLog, Signer } from 'ethers';
import { MarginlyFactory__factory } from '../../typechain-types';
import { ILevvaPoolConfig } from './configs/levva-pool-config';
import { ContractState, StorageFile } from './base/deployment-states';

export async function deployPools(signer: Signer, config: ILevvaPoolConfig[], storage: StorageFile<ContractState>) {
  const factoryAddress = storage.getById('levva-factory');
  if (factoryAddress === undefined) {
    throw new Error('Failed to obtain factory address');
  }

  const factory = MarginlyFactory__factory.connect(factoryAddress.address, signer.provider!);
  const signerAddress = await signer.getAddress();
  if ((await factory.owner()) !== signerAddress) {
    throw new Error(`Signer ${signerAddress} is not factory owner`);
  }

  for (const pool of config) {
    const name = `levva-pool#${pool.baseToken}/${pool.quoteToken}`;

    const inStorage = storage.getById(name);
    if (inStorage !== undefined) {
      console.log(`${name} already deployed, address: ${inStorage.address}. Skipping`);
      continue;
    }

    console.log(`Adding ${name} pool`);
    const tx = await factory
      .connect(signer)
      .createPool(
        pool.quoteToken.address,
        pool.baseToken.address,
        pool.priceOracle,
        pool.defaultSwapCallData,
        pool.params
      );
    const receipt = await tx.wait();
    if (receipt == null) {
      throw new Error(`Failed to get tx receipt. Hash: ${tx.hash}`);
    }

    const address = getApartmentAddressFromReceipt(receipt);
    console.log(`${name} pool is successfully deployed. Address ${address}. Tx hash: ${tx.hash}`);

    const contractState: ContractState = { address, txHash: tx.hash };
    storage.setById(name, contractState);
    storage.save();
  }
}

function getApartmentAddressFromReceipt(receipt: ContractTransactionReceipt): string {
  const event = receipt.logs.find((x) => 'args' in x && x.fragment.name === 'PoolCreated');
  if (event == undefined) {
    throw new Error(`Failed to find 'PoolCreated' event in tx ${receipt.hash} logs`);
  }
  return (event as EventLog).args[4];
}
