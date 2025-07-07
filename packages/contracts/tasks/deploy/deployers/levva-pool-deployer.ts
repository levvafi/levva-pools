import { ContractTransactionResponse, EventLog, Signer } from 'ethers';
import { IERC20Metadata__factory, MarginlyFactory__factory } from '../../../typechain-types';
import { ContractState, StorageFile } from '../base/deployment-states';
import { FactoryDeployer } from '../base/deployers/factory-deployer';
import { ILevvaPoolConfig } from '../configs/levva-pool-config';

export class LevvaPoolDeployer extends FactoryDeployer {
  constructor(signer: Signer, storage: StorageFile<ContractState>, blockToConfirm: number = 1) {
    const factoryData = storage.getById(`MarginlyFactory`);
    if (factoryData === undefined) {
      throw new Error('Failed to obtain MarginlyFactory address');
    }

    super(
      `LevvaPool`,
      MarginlyFactory__factory.connect(factoryData.address, signer).createPool,
      LevvaPoolDeployer.poolCreatedEventParser,
      storage,
      blockToConfirm
    );
  }

  public async performDeployment(config: ILevvaPoolConfig): Promise<string> {
    return super.performDeploymentRaw(
      [
        config.quoteToken.address,
        config.baseToken.address,
        config.priceOracle,
        config.defaultSwapCallData,
        config.params,
      ],
      await this.getNameFromConfig(config)
    );
  }

  private async getNameFromConfig(config: ILevvaPoolConfig): Promise<string> {
    const baseTokenSymbol =
      config.baseToken.symbol ?? (await IERC20Metadata__factory.connect(config.baseToken.address).symbol());
    const quoteTokenSymbol =
      config.quoteToken.symbol ?? (await IERC20Metadata__factory.connect(config.quoteToken.address).symbol());
    return `LevvaPool#${baseTokenSymbol}-${quoteTokenSymbol}`;
  }

  private static async poolCreatedEventParser(txResponse: ContractTransactionResponse): Promise<string> {
    const txReceipt = await txResponse.wait();
    const poolCreatedEvent = txReceipt?.logs
      ?.filter((log) => log instanceof EventLog)
      .find((x) => x.eventName === 'PoolCreated');

    if (poolCreatedEvent === undefined) {
      throw new Error(`Failed to obtain 'PoolCreated' event. Tx: ${txResponse.hash}`);
    }

    return poolCreatedEvent.args[4];
  }
}
