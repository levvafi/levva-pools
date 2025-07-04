import { ethers } from 'hardhat';
import { Wallet } from 'ethers';
import { getConfigParsed } from './base/base-config';
import { ILevvaEcosystemConfig, LevvaEcosystemConfig } from './levva-ecosystem-config';
import { LevvaPoolImplementationDeployer } from './deployers/levva-pool-implementation-deployer';
import { LevvaRouterDeployer } from './deployers/levva-router-deployer';
import { ContractState, StorageFile } from './base/deployment-states';
import { LevvaFactoryDeployer } from './deployers/levva-factory-deployer';
import { OracleDeployerFactory } from './deployers/oracle-deployer-factory';
import { AdapterDeployerFactory } from './deployers/adapter-deployer-factory';

export async function runLevvaDeployment() {
  const jsonParsed = getConfigParsed<ILevvaEcosystemConfig>('./v2', 'test-config');
  const config = new LevvaEcosystemConfig(jsonParsed);
  const provider = new ethers.JsonRpcProvider('https://ethereum-rpc.publicnode.com');
  await config.validate(provider);

  const storage = new StorageFile<ContractState>('../..', true, 'test-storage');
  const signer = Wallet.createRandom();

  const levvaPoolImplementationDeployer = new LevvaPoolImplementationDeployer(signer, storage, config.factory.poolType);
  await levvaPoolImplementationDeployer.performDeployment();

  const levvaRouterDeployer = new LevvaRouterDeployer(signer, storage, config.factory.poolType);
  await levvaRouterDeployer.performDeployment();

  const levvaFactoryDeployer = new LevvaFactoryDeployer(signer, storage);
  await levvaFactoryDeployer.performDeployment(config.factory);

  const oracleDeployerFactory = new OracleDeployerFactory();
  for (const [oracleName, oracleConfig] of config.oracles) {
    const deployer = oracleDeployerFactory.getDeployer(oracleName, signer, storage);
    await deployer.performDeployment(oracleConfig);
    // await deployer.setup(oracleConfig);
  }

  const adapterDeployerFactory = new AdapterDeployerFactory();
  for (const [adapterName, adapterConfig] of config.adapters) {
    const deployer = await adapterDeployerFactory.getDeployer(adapterName, signer, storage);
    await deployer.performDeployment(adapterConfig);
    // await deployer.setup(oracleConfig);
  }
}
