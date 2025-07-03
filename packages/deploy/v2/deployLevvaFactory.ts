import { Signer } from 'ethers';
import {
  LevvaFarmingPool__factory,
  LevvaTradingPool__factory,
  MarginlyFactory__factory,
} from '../../contracts/typechain-types';
import { MarginlyRouter__factory } from '../../contracts/typechain-types';
import { ContractState, StorageFile } from './base/deployment-states';
import { Deployer } from './base/deployers/deployer';
import { ILevvaFactoryConfig, PoolType } from './configs/levva-factory-config';

export async function deployLevvaFactory(
  signer: Signer,
  config: ILevvaFactoryConfig,
  storage: StorageFile<ContractState>
) {
  const tokenImplementation = storage.getById('token-implementation');
  if (tokenImplementation == undefined) {
    throw new Error('Failed to get token implementation address');
  }

  let implementation = config.marginlyPoolImplementationAddress;
  if (implementation === undefined) {
    implementation = await deployPoolImplementation(config.poolType, signer, storage);
  }

  let router = config.swapRouterAddress;
  if (router === undefined) {
    router = await deployRouter(signer, storage);
  }

  const factory = new MarginlyFactory__factory().connect(signer);
  const deployer = new Deployer('levva-factory', factory, storage);
  await deployer.performDeployment([
    implementation,
    router,
    config.feeHolderAddress,
    config.WETH9,
    config.techPositionOwnerAddress,
  ]);
}

async function deployPoolImplementation(
  poolType: PoolType | string,
  signer: Signer,
  storage: StorageFile<ContractState>
): Promise<string> {
  if (poolType === PoolType.Trading) {
    return deployTradingPoolImplementation(signer, storage);
  } else if (poolType === PoolType.Farming) {
    return deployFarmingPoolImplementation(signer, storage);
  } else {
    throw new Error('Unknown pool type');
  }
}

async function deployRouter(signer: Signer, storage: StorageFile<ContractState>): Promise<string> {
  const factory = new MarginlyRouter__factory().connect(signer);
  const deployer = new Deployer('router', factory, storage);
  const address = await deployer.performDeployment();
  storage.save();
  return address;
}

async function deployTradingPoolImplementation(signer: Signer, storage: StorageFile<ContractState>): Promise<string> {
  const factory = new LevvaTradingPool__factory().connect(signer);
  const deployer = new Deployer('levva-pool-implementation', factory, storage);
  const address = await deployer.performDeployment();
  storage.save();
  return address;
}

async function deployFarmingPoolImplementation(signer: Signer, storage: StorageFile<ContractState>): Promise<string> {
  const factory = new LevvaFarmingPool__factory().connect(signer);
  const deployer = new Deployer('levva-pool-implementation', factory, storage);
  const address = await deployer.performDeployment();
  storage.save();
  return address;
}
