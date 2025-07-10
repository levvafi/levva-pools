import { Signer } from 'ethers';
import { LevvaPendleBundler__factory } from '../../../../typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { ILevvaPendleBundlerDeployConfig } from '../../configs/bundlers';

export class LevvaPendleBundlerDeployer extends Deployer<LevvaPendleBundler__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      LevvaPendleBundler__factory.name.replace('__factory', ''),
      new LevvaPendleBundler__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: ILevvaPendleBundlerDeployConfig): Promise<string> {
    const address = await super.performDeploymentRaw([config.pendleRouterAddress]);
    return address;
  }
}
