import { Signer } from 'ethers';
import { AavePriceOracle__factory } from '../../../typechain-types';
import { ContractState, StorageFile } from '../../base/deployment-states';
import { Deployer } from '../../base/deployers/deployer';
import { IAavePriceOracleDeployConfig } from '../../configs/oracles';

export class AavePriceOracleDeployer extends Deployer<AavePriceOracle__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      AavePriceOracle__factory.name.replace('__factory', ''),
      new AavePriceOracle__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IAavePriceOracleDeployConfig): Promise<string> {
    const address = await super.performDeploymentRaw([config.aavePoolProviderAddress]);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IAavePriceOracleDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Oracle setup settings are not provided');
    }

    const oracle = AavePriceOracle__factory.connect(address ?? this.getDeployedAddressSafe(), this.factory.runner);

    for (const oracleSettings of config.settings) {
      const tx = await oracle.setPair(oracleSettings.quoteToken.address, oracleSettings.aToken.address);
      await tx.wait(this.blocksToConfirm);
      console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
    }
  }
}
