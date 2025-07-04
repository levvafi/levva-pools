import fs from 'fs';
import path from 'path';

const ADAPTERS_CONFIGS_PATH = path.join(__dirname, './adapters');
const DEFAULT_CONFIG = 'GeneralAdapter';

export class AdapterConfigFactory {
  public async getConfig(json: JSON) {
    const jsonKeys = Object.keys(json);
    if (jsonKeys.length != 1) {
      throw new Error(`Not an adapter config: ${json}`);
    }

    const validAdapters = await this.getAdapterConfigMap();
    const object = validAdapters.get(jsonKeys[0]) ?? validAdapters.get(DEFAULT_CONFIG);

    return new object(json);
  }

  private async getAdapterConfigMap(): Promise<Map<string, any>> {
    if (!fs.existsSync(ADAPTERS_CONFIGS_PATH)) {
      throw new Error(`Failed to get adapter configs: ${ADAPTERS_CONFIGS_PATH} doesn't exist`);
    }

    const adapterModule = await import(path.resolve(ADAPTERS_CONFIGS_PATH, 'index'));
    const adapters = new Map<string, any>();
    for (const [exportName, object] of Object.entries(adapterModule)) {
      adapters.set(exportName.replace('DeployConfig', ''), object);
    }

    return adapters;
  }
}
