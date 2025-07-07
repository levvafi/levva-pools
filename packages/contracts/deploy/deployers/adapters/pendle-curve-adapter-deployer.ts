import { Signer } from 'ethers';
import { PendleCurveNgAdapter__factory } from '../../../typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IPendleCurveAdapterDeployConfig, IPendleCurveAdapterPairSettings } from '../../configs/adapters';

export class PendleCurveRouterAdapterDeployer extends Deployer<PendleCurveNgAdapter__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      PendleCurveNgAdapter__factory.name.replace('__factory', ''),
      new PendleCurveNgAdapter__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IPendleCurveAdapterDeployConfig): Promise<string> {
    return super.performDeploymentRaw([this.getRouteInput(config.settings)]);
  }

  public async setup(config: IPendleCurveAdapterDeployConfig): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Adapter setup settings are not provided');
    }

    const address = this.getDeployedAddressSafe();
    const adapter = PendleCurveNgAdapter__factory.connect(address, this.factory.runner);

    await adapter.addPairs(this.getRouteInput(config.settings));
  }

  private getRouteInput(settings?: IPendleCurveAdapterPairSettings[]) {
    return (settings ?? []).map((x) => {
      return {
        pendleMarket: x.pendleMarket,
        slippage: x.slippage,
        curveSlippage: x.curveSlippage,
        curvePool: x.curvePool,
        ibToken: x.ibToken.address,
        quoteToken: x.quoteToken.address,
      };
    });
  }
}
