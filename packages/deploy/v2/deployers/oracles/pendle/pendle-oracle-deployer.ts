import { Signer } from 'ethers';
import { PendleOracle__factory } from '../../../../../contracts/typechain-types';
import { ContractState, StorageFile } from '../../../base/deployment-states';
import { Deployer } from '../../../base/deployers/deployer';
import { IPendleOracleDeployConfig } from '../../../configs/oracles';

export class PendleOracleDeployer extends Deployer<PendleOracle__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      PendleOracle__factory.name.replace('__factory', ''),
      new PendleOracle__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IPendleOracleDeployConfig): Promise<string> {
    return super.performDeploymentRaw([config.pendlePtLpOracleAddress]);
  }

  public async setup(config: IPendleOracleDeployConfig): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Oracle setup settings are not provided');
    }

    const address = this.getDeployedAddressSafe();
    const oracle = PendleOracle__factory.connect(address, this.factory.runner);

    for (const oracleSettings of config.settings) {
      const tx = await oracle.setPair(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address,
        oracleSettings.pendleMarketAddress,
        oracleSettings.ibToken.address,
        oracleSettings.secondaryPoolOracleAddress,
        oracleSettings.secondsAgo,
        oracleSettings.secondsAgoLiquidation
      );
      await tx.wait(this.blocksToConfirm);
      console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
    }
  }
}
