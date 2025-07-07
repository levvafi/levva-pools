import { Signer } from 'ethers';
import fs from 'fs';
import path from 'path';
import { ContractState, StorageFile } from '../base/deployment-states';
import { ethers } from 'hardhat';
import { GeneralAdapterDeployer } from './adapters';

const ADAPTERS_DEPLOYERS_PATH = path.join(__dirname, './adapters');

export class AdapterDeployerFactory {
  private readonly validAdaptersDeployers = new Map<string, any>();

  constructor() {
    if (!fs.existsSync(ADAPTERS_DEPLOYERS_PATH)) {
      throw new Error(`Failed to get adapters deployers: ${ADAPTERS_DEPLOYERS_PATH} doesn't exist`);
    }

    const adaptersModule = require(path.resolve(ADAPTERS_DEPLOYERS_PATH, 'index'));
    for (const [exportName, object] of Object.entries(adaptersModule)) {
      this.validAdaptersDeployers.set(exportName.replace('Deployer', ''), object);
    }
  }

  public async getDeployer(
    key: string,
    signer: Signer,
    storage: StorageFile<ContractState>,
    blockToConfirm: number = 1
  ): Promise<any> {
    const object = this.validAdaptersDeployers.get(key);
    if (object === undefined) {
      const factory = await ethers.getContractFactory(key).catch((e) => {
        throw new Error(`Unknown adapter type '${key}'`);
      });
      return new GeneralAdapterDeployer(key, factory, signer, storage, blockToConfirm);
    }

    return new object(signer, storage, blockToConfirm);
  }
}
