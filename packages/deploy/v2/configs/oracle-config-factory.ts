import fs from 'fs';
import path from 'path';

const ORACLES_CONFIGS_PATH = path.join(__dirname, './oracles');

export class OracleConfigFactory {
  public async getConfig(json: JSON) {
    const jsonKeys = Object.keys(json);
    if (jsonKeys.length != 1) {
      throw new Error(`Not an oracle config: ${json}`);
    }

    const validOracles = await this.getOraclesConfigMap();

    const object = validOracles.get(jsonKeys[0]);
    if (object === undefined) {
      throw new Error(`Unknown oracle type '${jsonKeys[0]}'`);
    }

    return new object(json);
  }

  private async getOraclesConfigMap(): Promise<Map<string, any>> {
    if (!fs.existsSync(ORACLES_CONFIGS_PATH)) {
      throw new Error(`Failed to get oracle configs: ${ORACLES_CONFIGS_PATH} doesn't exist`);
    }

    const oraclesModule = await import(path.resolve(ORACLES_CONFIGS_PATH, 'index'));
    const oracles = new Map<string, any>();
    for (const [exportName, object] of Object.entries(oraclesModule)) {
      oracles.set(exportName.replace('DeployConfig', ''), object);
    }

    return oracles;
  }
}
