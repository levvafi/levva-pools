import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Signer } from 'ethers';
import { PendleCurveRouterNgAdapter__factory } from '../../../../typechain-types';
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

  public async performDeployment(
    hre: HardhatRuntimeEnvironment,
    config: IPendleCurveRouterAdapterDeployConfig
  ): Promise<string> {
    const address = await super.performDeploymentRaw(hre, [config.router, this.getRouteInput(config.settings)]);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IPendleCurveRouterAdapterDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Adapter setup settings are not provided');
    }

    const adapter = PendleCurveRouterNgAdapter__factory.connect(
      address ?? this.getDeployedAddressSafe(),
      this.factory.runner
    );

    // TODO: fix
    // const tx = await adapter.addPairs(this.getRouteInput(config.settings));
    // await tx.wait(this.blocksToConfirm);

    // console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
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
