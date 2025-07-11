import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Signer } from 'ethers';
import { BalancerAdapter__factory } from '../../../../typechain-types';
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

  public async performDeployment(
    hre: HardhatRuntimeEnvironment,
    config: IBalancerAdapterDeployConfig
  ): Promise<string> {
    const address = await super.performDeploymentRaw(hre, [this.getPoolInput(config.settings), config.vault]);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IBalancerAdapterDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Adapter setup settings are not provided');
    }

    const adapter = BalancerAdapter__factory.connect(address ?? this.getDeployedAddressSafe(), this.factory.runner);
    const tx = await adapter.addPools(this.getPoolInput(config.settings));
    await tx.wait(this.blocksToConfirm);

    console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
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
