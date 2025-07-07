import { Provider } from 'ethers';
import fs from 'fs';
import path from 'path';

export interface IConfigBase {
  validate: (provider: Provider) => Promise<void>;
}

export function getConfigParsed<T>(configDir: string, filename: string): T {
  if (!fs.existsSync(configDir)) {
    throw new Error(`Directory '${configDir}' does not exists`);
  }
  if (!fs.statSync(configDir).isDirectory()) {
    throw new Error(`Specified '${configDir}' is not a directory`);
  }
  const configFilename = path.join(configDir, `${filename}.json`);
  if (!fs.existsSync(configFilename)) {
    throw new Error(`Deploy config is not exist! Filename: ${configFilename}`);
  }

  return JSON.parse(fs.readFileSync(configFilename, 'utf-8'), (_, value) => {
    if (typeof value === 'number' && value > Number.MAX_SAFE_INTEGER) {
      return BigInt(value);
    }
    return value;
  });
}
