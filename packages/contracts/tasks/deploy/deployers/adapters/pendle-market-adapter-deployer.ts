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
    const address = await super.performDeploymentRaw([this.getRouteInput(config.settings)]);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IPendleMarketAdapterDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Adapter setup settings are not provided');
    }

    const adapter = PendleMarketAdapter__factory.connect(address ?? this.getDeployedAddressSafe(), this.factory.runner);
    const tx = await adapter.addPools(this.getRouteInput(config.settings));
    await tx.wait(this.blocksToConfirm);

    console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
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
