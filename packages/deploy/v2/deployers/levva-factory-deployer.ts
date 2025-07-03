import { Signer } from 'ethers';
import { MarginlyFactory__factory } from '../../../contracts/typechain-types';
import { ContractState, StorageFile } from '../base/deployment-states';
import { Deployer } from '../base/deployers/deployer';
import { ILevvaFactoryConfig } from '../configs/levva-factory-config';

export class LevvaFactoryDeployer extends Deployer<MarginlyFactory__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      MarginlyFactory__factory.name.replace('__factory', ''),
      new MarginlyFactory__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: ILevvaFactoryConfig): Promise<string> {
    if (config.marginlyPoolImplementationAddress === undefined) {
      throw new Error('Failed to obtain poolImplementation address');
    }

    if (config.swapRouterAddress === undefined) {
      throw new Error('Failed to obtain swapRouterAddress address');
    }

    return super.performDeploymentRaw([
      config.marginlyPoolImplementationAddress,
      config.swapRouterAddress,
      config.feeHolderAddress,
      config.WETH9,
      config.techPositionOwnerAddress,
    ]);
  }
}
