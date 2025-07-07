import { Signer, ZeroAddress } from 'ethers';
import { PendleMarketOracle__factory } from '../../../../../typechain-types';
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
    const address = await super.performDeploymentRaw([config.pendlePtLpOracleAddress]);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IPendleMarketOracleDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Oracle setup settings are not provided');
    }

    const oracle = PendleMarketOracle__factory.connect(address ?? this.getDeployedAddressSafe(), this.factory.runner);

    for (const oracleSettings of config.settings) {
      const currentOptions = await oracle.getParams(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address
      );

      if (currentOptions.pendleMarket != ZeroAddress) {
        console.log(
          `${this.name} oracle ${oracleSettings.quoteToken.address}/${oracleSettings.baseToken.address} pair is set. Skipping`
        );
        continue;
      }

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
