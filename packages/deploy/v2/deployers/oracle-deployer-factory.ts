import { Signer } from 'ethers';
import fs from 'fs';
import path from 'path';
import { ContractState, StorageFile } from '../base/deployment-states';

const ORACLES_DEPLOYERS_PATH = path.join(__dirname, './oracles');

export class OracleDeployerFactory {
  private readonly validOracleDeployers = new Map<string, any>();

  constructor() {
    if (!fs.existsSync(ORACLES_DEPLOYERS_PATH)) {
      throw new Error(`Failed to get oracle configs: ${ORACLES_DEPLOYERS_PATH} doesn't exist`);
    }

    const oraclesModule = require(path.resolve(ORACLES_DEPLOYERS_PATH, 'index'));
    for (const [exportName, object] of Object.entries(oraclesModule)) {
      this.validOracleDeployers.set(exportName.replace('Deployer', ''), object);
    }
  }

  public getDeployer(
    key: string,
    signer: Signer,
    storage: StorageFile<ContractState>,
    blockToConfirm: number = 1
  ): any {
    const object = this.validOracleDeployers.get(key);
    if (object === undefined) {
      throw new Error(`Unknown oracle type '${key}'`);
    }

    return new object(signer, storage, blockToConfirm);
  }
}
