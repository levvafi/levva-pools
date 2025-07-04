import { Signer } from 'ethers';
import { LevvaTradingPool__factory, LevvaFarmingPool__factory } from '../../../contracts/typechain-types';
import { ContractState, StorageFile } from '../base/deployment-states';
import { Deployer } from '../base/deployers/deployer';
import { PoolType } from '../configs/levva-factory-config';

export class LevvaPoolImplementationDeployer extends Deployer<LevvaTradingPool__factory | LevvaFarmingPool__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, type: PoolType, blockToConfirm: number = 1) {
    const { name, factory } = LevvaPoolImplementationDeployer.getNameAndFactoryByType(type);
    super(name, factory.connect(signer), storage, blockToConfirm);
  }

  async performDeployment(): Promise<string> {
    return this.performDeploymentRaw();
  }

  private static getNameAndFactoryByType(type: PoolType): { name: string; factory: any } {
    let factory = undefined;
    if (type === PoolType.Farming) {
      factory = LevvaFarmingPool__factory;
    }

    if (type === PoolType.Trading) {
      factory = LevvaTradingPool__factory;
    }

    if (factory === undefined) {
      throw new Error('Unknown pool type');
    }

    return { name: factory.name.replace('__factory', '') + 'Implementation', factory: new factory() };
  }
}
