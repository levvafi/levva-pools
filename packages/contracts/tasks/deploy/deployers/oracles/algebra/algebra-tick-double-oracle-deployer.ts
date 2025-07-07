import { Signer, ZeroAddress } from 'ethers';
import { AlgebraTickOracleDouble__factory } from '../../../../../typechain-types';
import { ContractState, StorageFile } from '../../../base/deployment-states';
import { Deployer } from '../../../base/deployers/deployer';
import { IAlgebraTickDoubleOracleDeployConfig } from '../../../configs/oracles';

export class AlgebraTickDoubleOracleDeployer extends Deployer<AlgebraTickOracleDouble__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      AlgebraTickOracleDouble__factory.name.replace('__factory', ''),
      new AlgebraTickOracleDouble__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IAlgebraTickDoubleOracleDeployConfig): Promise<string> {
    const address = await super.performDeploymentRaw([config.factoryAddress]);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IAlgebraTickDoubleOracleDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Oracle setup settings are not provided');
    }

    const oracle = AlgebraTickOracleDouble__factory.connect(
      address ?? this.getDeployedAddressSafe(),
      this.factory.runner
    );

    for (const oracleSettings of config.settings) {
      const currentOptions = await oracle.getParams(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address
      );

      const isSet =
        currentOptions.secondsAgo == BigInt(oracleSettings.secondsAgo) &&
        currentOptions.secondsAgoLiquidation == BigInt(oracleSettings.secondsAgoLiquidation);

      if (
        currentOptions.intermediateToken != ZeroAddress &&
        currentOptions.intermediateToken != oracleSettings.intermediateToken.address
      ) {
        throw new Error(`Can't change underlying pool for ${this.name} oracle`);
      }

      if (isSet) {
        console.log(
          `${this.name} oracle ${oracleSettings.quoteToken.address}/${oracleSettings.baseToken.address} pair is set. Skipping`
        );
        continue;
      }

      const tx = await oracle.setOptions(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address,
        oracleSettings.secondsAgo,
        oracleSettings.secondsAgoLiquidation,
        oracleSettings.intermediateToken.address
      );
      await tx.wait(this.blocksToConfirm);
      console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
    }
  }
}
