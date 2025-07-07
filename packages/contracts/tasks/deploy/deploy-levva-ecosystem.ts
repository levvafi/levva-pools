import path from 'path';
import { Signer } from 'ethers';
import { getConfigParsed } from './base/base-config';
import { ILevvaEcosystemConfig, LevvaEcosystemConfig } from './levva-ecosystem-config';
import { LevvaPoolImplementationDeployer } from './deployers/levva-pool-implementation-deployer';
import { LevvaRouterDeployer } from './deployers/levva-router-deployer';
import { ContractState, StorageFile } from './base/deployment-states';
import { LevvaFactoryDeployer } from './deployers/levva-factory-deployer';
import { OracleDeployerFactory } from './deployers/oracle-deployer-factory';
import { AdapterDeployerFactory } from './deployers/adapter-deployer-factory';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { LevvaPoolDeployer } from './deployers/levva-pool-deployer';

const DATA_PATH = path.join(__dirname, './data');

export async function runLevvaDeployment(
  hre: HardhatRuntimeEnvironment,
  signer: Signer,
  network: string,
  saveFlag: boolean,
  tag?: string
) {
  const config = new LevvaEcosystemConfig(getConfigParsed<ILevvaEcosystemConfig>(DATA_PATH, network));
  await config.validate(signer.provider!);

  const storage = new StorageFile<ContractState>(network, saveFlag, tag);

  const oracleDeployerFactory = new OracleDeployerFactory();
  for (const [oracleName, oracleConfig] of config.oracles) {
    const deployer = oracleDeployerFactory.getDeployer(oracleName, signer, storage);
    await deployer.performDeployment(oracleConfig);
    await deployer.setup(oracleConfig);
  }

  const adapters = [];
  const adapterDeployerFactory = new AdapterDeployerFactory();
  for (const [adapterName, adapterConfig] of config.adapters) {
    const deployer = await adapterDeployerFactory.getDeployer(hre, adapterName, signer, storage);
    const adapter = await deployer.performDeployment(adapterConfig);
    adapters.push({ dexIndex: adapterConfig.dexId, adapter });
  }

  const levvaRouterDeployer = new LevvaRouterDeployer(signer, storage, config.factory.poolType);
  await levvaRouterDeployer.performDeployment(adapters);

  const levvaPoolImplementationDeployer = new LevvaPoolImplementationDeployer(signer, storage, config.factory.poolType);
  await levvaPoolImplementationDeployer.performDeployment();

  const levvaFactoryDeployer = new LevvaFactoryDeployer(signer, storage);
  await levvaFactoryDeployer.performDeployment(config.factory);

  const poolDeployer = new LevvaPoolDeployer(signer, storage);
  for (const poolConfig of config.pools) {
    await poolDeployer.performDeployment(poolConfig);
  }
}
