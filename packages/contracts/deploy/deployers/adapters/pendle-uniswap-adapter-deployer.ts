import { Signer } from 'ethers';
import { PendleAdapter__factory } from '../../../typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IPendleUniswapAdapterDeployConfig, IPendleUniswapAdapterPairSettings } from '../../configs/adapters';

export class PendleUniswapAdapterDeployer extends Deployer<PendleAdapter__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      PendleAdapter__factory.name.replace('__factory', ''),
      new PendleAdapter__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IPendleUniswapAdapterDeployConfig): Promise<string> {
    return super.performDeploymentRaw([this.getRouteInput(config.settings)]);
  }

  public async setup(config: IPendleUniswapAdapterDeployConfig): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Adapter setup settings are not provided');
    }

    const address = this.getDeployedAddressSafe();
    const adapter = PendleAdapter__factory.connect(address, this.factory.runner);

    await adapter.addPools(this.getRouteInput(config.settings));
  }

  private getRouteInput(settings?: IPendleUniswapAdapterPairSettings[]) {
    return (settings ?? []).map((x) => {
      return {
        poolData: {
          pendleMarket: x.pendleMarket,
          uniswapV3LikePool: x.poolAddress,
          ib: x.ibToken.address,
          slippage: x.slippage,
        },
        tokenA: x.tokenA.address,
        tokenB: x.tokenB.address,
      };
    });
  }
}
