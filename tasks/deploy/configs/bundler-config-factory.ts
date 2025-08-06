import fs from 'fs';
import path from 'path';

const BUNDLERS_CONFIGS_PATH = path.join(__dirname, './bundlers');

export class BundlerConfigFactory {
  private readonly validOracles = new Map<string, any>();

  constructor() {
    if (!fs.existsSync(BUNDLERS_CONFIGS_PATH)) {
      throw new Error(`Failed to get oracle configs: ${BUNDLERS_CONFIGS_PATH} doesn't exist`);
    }

    const oraclesModule = require(path.resolve(BUNDLERS_CONFIGS_PATH, 'index'));
    for (const [exportName, object] of Object.entries(oraclesModule)) {
      this.validOracles.set(exportName.replace('DeployConfig', ''), object);
    }
  }

  public getConfig(key: string, json: JSON): any {
    const object = this.validOracles.get(key);
    if (object === undefined) {
      throw new Error(`Unknown oracle type '${key}'`);
    }

    return new object(json);
  }
}
