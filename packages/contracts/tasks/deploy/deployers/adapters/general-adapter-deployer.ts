import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ContractFactory, Signer } from 'ethers';
import { BalancerAdapter__factory } from '../../../../typechain-types';
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

  public async performDeployment(hre: HardhatRuntimeEnvironment, config: IGeneralAdapterDeployConfig): Promise<string> {
    const address = await super.performDeploymentRaw(hre, [this.getPoolInput(config.settings)]);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IGeneralAdapterDeployConfig, address?: string): Promise<void> {
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
