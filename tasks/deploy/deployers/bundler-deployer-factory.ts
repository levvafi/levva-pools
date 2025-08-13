import fs from 'fs';
import path from 'path';
import { Signer } from 'ethers';
import { ContractState, StorageFile } from '../base/deployment-states';

const BUNDLERS_DEPLOYERS_PATH = path.join(__dirname, './bundlers');

export class BundlerDeployerFactory {
  private readonly validBundlersDeployers = new Map<string, any>();

  constructor() {
    if (!fs.existsSync(BUNDLERS_DEPLOYERS_PATH)) {
      throw new Error(`Failed to get bundlers deployers: ${BUNDLERS_DEPLOYERS_PATH} doesn't exist`);
    }

    const bundlersModule = require(path.resolve(BUNDLERS_DEPLOYERS_PATH, 'index'));
    for (const [exportName, object] of Object.entries(bundlersModule)) {
      this.validBundlersDeployers.set(exportName.replace('Deployer', ''), object);
    }
  }

  public getDeployer(
    key: string,
    signer: Signer,
    storage: StorageFile<ContractState>,
    blockToConfirm: number = 1
  ): any {
    const object = this.validBundlersDeployers.get(key);
    if (object === undefined) {
      throw new Error(`Unknown bundler type '${key}'`);
    }

    return new object(signer, storage, blockToConfirm);
  }
}
