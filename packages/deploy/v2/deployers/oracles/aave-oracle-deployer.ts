import { Signer } from 'ethers';
import { AavePriceOracle__factory } from '../../../../contracts/typechain-types';
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
    return super.performDeploymentRaw([config.aavePoolProviderAddress]);
  }

  public async setup(config: IAavePriceOracleDeployConfig): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Oracle setup settings are not provided');
    }

    const address = this.getDeployedAddressSafe();
    const oracle = AavePriceOracle__factory.connect(address, this.factory.runner);

    for (const oracleSettings of config.settings) {
      const tx = await oracle.setPair(oracleSettings.quoteToken.address, oracleSettings.aToken.address);
      await tx.wait(this.blocksToConfirm);
      console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
    }
  }
}
