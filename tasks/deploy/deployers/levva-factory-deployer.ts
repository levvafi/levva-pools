import { Signer } from 'ethers';
import { MarginlyFactory__factory } from '../../../typechain-types';
import { ContractState, StorageFile } from '../base/deployment-states';
import { Deployer } from '../base/deployers/deployer';
import { ILevvaFactoryConfig, PoolType } from '../configs/levva-factory-config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

export class LevvaFactoryDeployer extends Deployer<MarginlyFactory__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      MarginlyFactory__factory.name.replace('__factory', ''),
      new MarginlyFactory__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(hre: HardhatRuntimeEnvironment, config: ILevvaFactoryConfig): Promise<string> {
    let implementationAddress = config.marginlyPoolImplementationAddress;
    if (implementationAddress === undefined) {
      const type = config.poolType;
      const id = `Levva${typeof type === 'string' ? type : PoolType[config.poolType as PoolType]}PoolImplementation`;
      const inStorage = this.storage.getById(id);
      if (inStorage === undefined) {
        throw new Error('Failed to obtain poolImplementation address');
      }
      implementationAddress = inStorage.address;
    }

    let routerAddress = config.swapRouterAddress;
    if (routerAddress === undefined) {
      const inStorage = this.storage.getById(`MarginlyRouter`);
      if (inStorage === undefined) {
        throw new Error('Failed to obtain router address');
      }
      routerAddress = inStorage.address;
    }

    return super.performDeploymentRaw(hre, [
      implementationAddress,
      routerAddress,
      config.feeHolderAddress,
      config.WETH9.address,
      config.techPositionOwnerAddress,
    ]);
  }
}
