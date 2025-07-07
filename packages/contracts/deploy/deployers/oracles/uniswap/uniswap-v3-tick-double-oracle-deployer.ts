import { Signer } from 'ethers';
import { UniswapV3TickOracleDouble__factory } from '../../../../typechain-types';
import { ContractState, StorageFile } from '../../../base/deployment-states';
import { Deployer } from '../../../base/deployers/deployer';
import { IUniswapV3TickDoubleOracleDeployConfig } from '../../../configs/oracles';

export class UniswapV3TickDoubleOracleDeployer extends Deployer<UniswapV3TickOracleDouble__factory> {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    super(
      UniswapV3TickOracleDouble__factory.name.replace('__factory', ''),
      new UniswapV3TickOracleDouble__factory().connect(signer),
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: IUniswapV3TickDoubleOracleDeployConfig): Promise<string> {
    const address = await super.performDeploymentRaw([config.factoryAddress]);
    if (config.settings !== undefined) {
      await this.setup(config, address);
    }
    return address;
  }

  public async setup(config: IUniswapV3TickDoubleOracleDeployConfig, address?: string): Promise<void> {
    if (config.settings === undefined) {
      throw new Error('Oracle setup settings are not provided');
    }

    const oracle = UniswapV3TickOracleDouble__factory.connect(
      address ?? this.getDeployedAddressSafe(),
      this.factory.runner
    );

    for (const oracleSettings of config.settings) {
      const tx = await oracle.setOptions(
        oracleSettings.quoteToken.address,
        oracleSettings.baseToken.address,
        oracleSettings.secondsAgo,
        oracleSettings.secondsAgoLiquidation,
        oracleSettings.baseTokenPairFee,
        oracleSettings.quoteTokenPairFee,
        oracleSettings.intermediateToken.address
      );
      await tx.wait(this.blocksToConfirm);
      console.log(`Updated ${this.name} oracle settings. Tx hash: ${tx.hash}`);
    }
  }
}
