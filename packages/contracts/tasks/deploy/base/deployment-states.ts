import fs from 'fs';
import path from 'path';

export interface ContractState {
  address: string;
  txHash?: string;
}

export interface Storage<T> {
  getById: (id: string) => T | undefined;
  setById: (id: string, arg: T) => void;

  load: () => boolean;
  save: () => void;
}

export class StorageFile<T> implements Storage<T> {
  public readonly tag: string;
  private readonly fileName: string;
  private readonly saveFlag: boolean;
  private deployments: Map<string, T>;

  constructor(network: string, dryRun: boolean, tag?: string) {
    this.tag = tag ?? this.getDefaultStorageTag();
    this.fileName = this.getDeploymentFilePath(network);
    this.saveFlag = dryRun;
    this.deployments = new Map();
    this.load();
  }

  public load(): boolean {
    const fileExists = fs.existsSync(this.fileName);
    if (fileExists) {
      const parsed = JSON.parse(fs.readFileSync(this.fileName, 'utf-8'));
      Object.entries(parsed).forEach(([name, deployment]) => this.deployments.set(name, deployment as T));
    }
    return fileExists;
  }

  public save(): void {
    if (!this.saveFlag) {
      return;
    }
    const s = JSON.stringify(Object.fromEntries(this.deployments), null, 4);
    fs.writeFileSync(this.fileName, s, { encoding: 'utf8', flag: 'w' });
  }

  public getById(id: string): T | undefined {
    return this.deployments.get(id);
  }

  public setById(id: string, deployment: T): void {
    this.deployments.set(id, deployment);
  }

  private getDefaultStorageTag(): string {
    const now = new Date();

    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private getDeploymentFilePath(network: string): string {
    const dirName = path.join(__dirname, `../data`, `${network}`);
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName);
    }

    if (!fs.statSync(dirName).isDirectory()) {
      throw new Error(`Not a directory: ${dirName}`);
    }

    return path.join(dirName, `${this.tag}.json`);
  }
}
