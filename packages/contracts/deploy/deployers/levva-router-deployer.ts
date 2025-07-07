import { Signer } from 'ethers';
import { MarginlyRouter__factory } from '../../typechain-types';
import { ContractState, StorageFile } from '../base/deployment-states';
import { Deployer } from '../base/deployers/deployer';
import { PoolType } from '../configs/levva-factory-config';

export class LevvaRouterDeployer extends Deployer<MarginlyRouter__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, type: PoolType, blockToConfirm: number = 1) {
    super(
      MarginlyRouter__factory.name.replace('__factory', ''),
      new MarginlyRouter__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  async performDeployment(): Promise<string> {
    return this.performDeploymentRaw();
  }
}
