import fs from 'fs';
import path from 'path';

const ADAPTERS_CONFIGS_PATH = path.join(__dirname, './adapters');
const DEFAULT_CONFIG = 'GeneralAdapter';

export class AdapterConfigFactory {
  private readonly validAdapters = new Map<string, any>();

  constructor() {
    if (!fs.existsSync(ADAPTERS_CONFIGS_PATH)) {
      throw new Error(`Failed to get adapter configs: ${ADAPTERS_CONFIGS_PATH} doesn't exist`);
    }

    const adapterModule = require(path.resolve(ADAPTERS_CONFIGS_PATH, 'index'));
    for (const [exportName, object] of Object.entries(adapterModule)) {
      this.validAdapters.set(exportName.replace('DeployConfig', ''), object);
    }
  }

  public getConfig(key: string, json: JSON): any {
    const object = this.validAdapters.get(key) ?? this.validAdapters.get(DEFAULT_CONFIG);
    if (object === undefined) {
      throw new Error('Failed to obtain default adapter config class');
    }

    return new object(json);
  }
}
