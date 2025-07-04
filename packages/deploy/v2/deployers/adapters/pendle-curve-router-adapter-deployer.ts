import { Signer } from 'ethers';
import { PendleCurveRouterNgAdapter__factory } from '../../../../contracts/typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IPendleCurveRouterAdapterDeployConfig, IPendleCurveRouterAdapterPairSettings } from '../../configs/adapters';

export class PendleCurveAdapterDeployer extends Deployer<PendleCurveRouterNgAdapter__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      PendleCurveRouterNgAdapter__factory.name.replace('__factory', ''),
      new PendleCurveRouterNgAdapter__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IPendleCurveRouterAdapterDeployConfig): Promise<string> {
    return super.performDeploymentRaw([config.router, this.getRouteInput(config.settings)]);
  }

  public async setup(config: IPendleCurveRouterAdapterDeployConfig): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Adapter setup settings are not provided');
    }

    const address = this.getDeployedAddressSafe();
    const adapter = PendleCurveRouterNgAdapter__factory.connect(address, this.factory.runner);

    // TODO: fix
    // await adapter.addPairs(this.getRouteInput(config.settings));
  }

  private getRouteInput(settings?: IPendleCurveRouterAdapterPairSettings[]) {
    return (settings ?? []).map((x) => {
      return {
        pendleMarket: x.pendleMarket,
        slippage: x.slippage,
        curveDxAdjustPtToToken: x.curveDxAdjustPtToToken,
        curveDxAdjustTokenToPt: x.curveDxAdjustTokenToPt,
        curveRoute: x.curveRoute,
        curveSwapParams: x.curveSwapParams,
        curvePools: x.curvePools,
      };
    });
  }
}
