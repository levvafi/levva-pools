import { Signer } from 'ethers';
import { PendleMarketAdapter__factory } from '../../../../typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IPendleMarketAdapterDeployConfig, IPendleMarketAdapterPairSettings } from '../../configs/adapters';

export class PendleMarketAdapterDeployer extends Deployer<PendleMarketAdapter__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      PendleMarketAdapter__factory.name.replace('__factory', ''),
      new PendleMarketAdapter__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IPendleMarketAdapterDeployConfig): Promise<string> {
    return super.performDeploymentRaw([this.getRouteInput(config.settings)]);
  }

  public async setup(config: IPendleMarketAdapterDeployConfig): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Adapter setup settings are not provided');
    }

    const address = this.getDeployedAddressSafe();
    const adapter = PendleMarketAdapter__factory.connect(address, this.factory.runner);

    await adapter.addPools(this.getRouteInput(config.settings));
  }

  private getRouteInput(settings?: IPendleMarketAdapterPairSettings[]) {
    return (settings ?? []).map((x) => {
      return {
        pendleMarket: x.market,
        slippage: x.slippage,
        ptToken: x.ptToken.address,
        ibToken: x.ibToken.address,
      };
    });
  }
}
