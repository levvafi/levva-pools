import { ContractFactory, Signer } from 'ethers';
import { BalancerAdapter__factory } from '../../../typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IGeneralAdapterDeployConfig, IGeneralAdapterPairSettings } from '../../configs/adapters';

export class GeneralAdapterDeployer extends Deployer<ContractFactory> {
  constructor(
    key: string,
    factory: ContractFactory,
    signer: Signer,
    storage: StorageFile<ContractState>,
    blockToConfirm: number = 1
  ) {
    super(key, factory.connect(signer), storage, blockToConfirm);
  }

  public async performDeployment(config: IGeneralAdapterDeployConfig): Promise<string> {
    return super.performDeploymentRaw([this.getPoolInput(config.settings)]);
  }

  public async setup(config: IGeneralAdapterDeployConfig): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Adapter setup settings are not provided');
    }

    const address = this.getDeployedAddressSafe();
    const adapter = BalancerAdapter__factory.connect(address, this.factory.runner);

    await adapter.addPools(this.getPoolInput(config.settings));
  }

  private getPoolInput(settings?: IGeneralAdapterPairSettings[]) {
    return (settings ?? []).map((x) => {
      return {
        token0: x.token0.address,
        token1: x.token1.address,
        pool: x.poolAddress,
      };
    });
  }
}
