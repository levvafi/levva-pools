import { Signer } from 'ethers';
import { PendleMarketOracle__factory } from '../../../../../contracts/typechain-types';
import { ContractState, StorageFile } from '../../../base/deployment-states';
import { Deployer } from '../../../base/deployers/deployer';
import { IPendleMarketOracleDeployConfig } from '../../../configs/oracles';

export class PendleMarketOracleDeployer extends Deployer<PendleMarketOracle__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      PendleMarketOracle__factory.name.replace('__factory', ''),
      new PendleMarketOracle__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IPendleMarketOracleDeployConfig): Promise<string> {
    return super.performDeploymentRaw([config.pendlePtLpOracleAddress]);
  }

  public async setup(config: IPendleMarketOracleDeployConfig): Promise<void> {
    const address = this.getDeployedAddressSafe();
    const oracle = PendleMarketOracle__factory.connect(address, this.factory.runner);

    for (const oracleSettings of config.settings) {
      const tx = await oracle.setPair(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address,
        oracleSettings.pendleMarketAddress,
        oracleSettings.secondsAgo,
        oracleSettings.secondsAgoLiquidation
      );
      await tx.wait(this.blocksToConfirm);
      console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
    }
  }
}
