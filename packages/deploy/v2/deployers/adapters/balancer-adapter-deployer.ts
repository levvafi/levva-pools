import { Signer } from 'ethers';
import { BalancerAdapter__factory } from '../../../../contracts/typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IBalancerAdapterDeployConfig, IGeneralAdapterPairSettings } from '../../configs/adapters';

export class BalancerAdapterDeployer extends Deployer<BalancerAdapter__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      BalancerAdapter__factory.name.replace('__factory', ''),
      new BalancerAdapter__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IBalancerAdapterDeployConfig): Promise<string> {
    return super.performDeploymentRaw([this.getPoolInput(config.settings), config.vault]);
  }

  public async setup(config: IBalancerAdapterDeployConfig): Promise<void> {
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
