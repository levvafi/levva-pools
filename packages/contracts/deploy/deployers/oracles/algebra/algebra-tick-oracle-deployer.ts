import { Signer } from 'ethers';
import { AlgebraTickOracle__factory } from '../../../../typechain-types';
import { ContractState, StorageFile } from '../../../base/deployment-states';
import { Deployer } from '../../../base/deployers/deployer';
import { IAlgebraTickOracleDeployConfig } from '../../../configs/oracles';

export class AlgebraTickOracleDeployer extends Deployer<AlgebraTickOracle__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      AlgebraTickOracle__factory.name.replace('__factory', ''),
      new AlgebraTickOracle__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IAlgebraTickOracleDeployConfig): Promise<string> {
    const address = await super.performDeploymentRaw([config.factoryAddress]);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IAlgebraTickOracleDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Oracle setup settings are not provided');
    }

    const oracle = AlgebraTickOracle__factory.connect(address ?? this.getDeployedAddressSafe(), this.factory.runner);

    for (const oracleSettings of config.settings) {
      const tx = await oracle.setOptions(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address,
        oracleSettings.secondsAgo,
        oracleSettings.secondsAgoLiquidation
      );
      await tx.wait(this.blocksToConfirm);
      console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
    }
  }
}
