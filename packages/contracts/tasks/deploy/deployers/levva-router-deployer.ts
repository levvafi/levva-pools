import { Signer } from 'ethers';
import { MarginlyRouter__factory } from '../../../typechain-types';
import { AdapterInputStruct } from '../../../typechain-types/contracts/MarginlyRouter';
import { ContractState, StorageFile } from '../base/deployment-states';
import { Deployer } from '../base/deployers/deployer';
import { PoolType } from '../configs/levva-factory-config';
import { isSameAddress } from '../base/utils';

export class LevvaRouterDeployer extends Deployer<MarginlyRouter__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, type: PoolType, blockToConfirm: number = 1) {
    super(
      MarginlyRouter__factory.name.replace('__factory', ''),
      new MarginlyRouter__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(input?: AdapterInputStruct[]): Promise<string> {
    const address = await this.performDeploymentRaw([[]]);
    if (input !== undefined && input?.length != 0) {
      await this.setup(input, address);
    }

    return address;
  }

  public async setup(input: AdapterInputStruct[], address?: string): Promise<void> {
    const router = MarginlyRouter__factory.connect(address ?? this.getDeployedAddressSafe(), this.factory.runner);

    const notSet = await Promise.all(
      input.map(async (adapterData) => {
        const currentAddress = await router.adapters(adapterData.dexIndex);
        return !isSameAddress(currentAddress, adapterData.adapter.toString());
      })
    );
    const filteredInput = input.filter((_, index) => notSet[index]);
    if (filteredInput.length == 0) {
      console.log('All adapters are set. Skipping');
      return;
    }

    const tx = await router.addDexAdapters(filteredInput);
    await tx.wait(this.blocksToConfirm);
    console.log(`Added ${this.name} adapters to router. Tx hash: ${tx.hash}`);
  }
}
