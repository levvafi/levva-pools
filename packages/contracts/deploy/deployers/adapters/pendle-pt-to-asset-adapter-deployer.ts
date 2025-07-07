import { Signer } from 'ethers';
import { PendlePtToAssetAdapter__factory } from '../../../typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IPendlePtToAssetAdapterDeployConfig, IPendlePtToAssetAdapterPairSettings } from '../../configs/adapters';

export class PendlePtToAssetAdapterDeployer extends Deployer<PendlePtToAssetAdapter__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      PendlePtToAssetAdapter__factory.name.replace('__factory', ''),
      new PendlePtToAssetAdapter__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IPendlePtToAssetAdapterDeployConfig): Promise<string> {
    return super.performDeploymentRaw([this.getRouteInput(config.settings)]);
  }

  public async setup(config: IPendlePtToAssetAdapterDeployConfig): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Adapter setup settings are not provided');
    }

    const address = this.getDeployedAddressSafe();
    const adapter = PendlePtToAssetAdapter__factory.connect(address, this.factory.runner);

    await adapter.addPools(this.getRouteInput(config.settings));
  }

  private getRouteInput(settings?: IPendlePtToAssetAdapterPairSettings[]) {
    return (settings ?? []).map((x) => {
      return {
        pendleMarket: x.market,
        slippage: x.slippage,
        ptToken: x.ptToken.address,
        asset: x.asset.address,
      };
    });
  }
}
