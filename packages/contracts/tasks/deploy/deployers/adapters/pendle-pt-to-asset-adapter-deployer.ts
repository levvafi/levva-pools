import { Signer } from 'ethers';
import { PendlePtToAssetAdapter__factory } from '../../../../typechain-types';
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
    const address = await super.performDeploymentRaw([this.getRouteInput(config.settings)]);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IPendlePtToAssetAdapterDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Adapter setup settings are not provided');
    }

    const adapter = PendlePtToAssetAdapter__factory.connect(
      address ?? this.getDeployedAddressSafe(),
      this.factory.runner
    );
    const tx = await adapter.addPools(this.getRouteInput(config.settings));
    await tx.wait(this.blocksToConfirm);

    console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
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
