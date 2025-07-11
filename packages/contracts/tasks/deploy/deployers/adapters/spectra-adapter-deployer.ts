import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Signer } from 'ethers';
import { SpectraAdapter__factory } from '../../../../typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { ISpectraAdapterDeployConfig, ISpectraAdapterPairSettings } from '../../configs/adapters';

export class SpectraAdapterDeployer extends Deployer<SpectraAdapter__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      SpectraAdapter__factory.name.replace('__factory', ''),
      new SpectraAdapter__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(hre: HardhatRuntimeEnvironment, config: ISpectraAdapterDeployConfig): Promise<string> {
    const address = await super.performDeploymentRaw(hre, [this.getRouteInput(config.settings)]);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: ISpectraAdapterDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Adapter setup settings are not provided');
    }

    const adapter = SpectraAdapter__factory.connect(address ?? this.getDeployedAddressSafe(), this.factory.runner);
    const tx = await adapter.addPools(this.getRouteInput(config.settings));
    await tx.wait(this.blocksToConfirm);

    console.log(`Updated ${this.name} adapter settings. Tx hash: ${tx.hash}`);
  }

  private getRouteInput(settings?: ISpectraAdapterPairSettings[]) {
    return (settings ?? []).map((x) => {
      return {
        pt: x.ptToken.address,
        quoteToken: x.quoteToken.address,
        pool: x.spectraPool,
      };
    });
  }
}
