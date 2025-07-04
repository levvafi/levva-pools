import { Signer } from 'ethers';
import { SpectraAdapter__factory } from '../../../../contracts/typechain-types';
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

  public async performDeployment(config: ISpectraAdapterDeployConfig): Promise<string> {
    return super.performDeploymentRaw([this.getRouteInput(config.settings)]);
  }

  public async setup(config: ISpectraAdapterDeployConfig): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Adapter setup settings are not provided');
    }

    const address = this.getDeployedAddressSafe();
    const adapter = SpectraAdapter__factory.connect(address, this.factory.runner);

    await adapter.addPools(this.getRouteInput(config.settings));
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
