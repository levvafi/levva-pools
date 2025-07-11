import { Provider } from 'ethers';
import { IConfigBase } from './base/base-config';
import { ILevvaFactoryConfig, LevvaFactoryConfig } from './configs/levva-factory-config';
import { ILevvaPoolConfig, LevvaPoolConfig } from './configs/levva-pool-config';
import { OracleConfigFactory } from './configs/oracle-config-factory';
import { AdapterConfigFactory } from './configs/adapter-config-factory';
import { BundlerConfigFactory } from './configs/bundler-config-factory';

export interface ILevvaEcosystemConfig extends IConfigBase {
  factory: ILevvaFactoryConfig;
  pools: ILevvaPoolConfig[];
  oracles: Map<string, any>;
  adapters: Map<string, any>;
  bundlers: Map<string, any>;
  // TODO: add keepers and timelock
}

export class LevvaEcosystemConfig implements ILevvaEcosystemConfig {
  public readonly factory: LevvaFactoryConfig;
  public readonly pools: LevvaPoolConfig[] = [];
  public readonly oracles = new Map<string, any>();
  public readonly adapters = new Map<string, any>();
  public readonly bundlers = new Map<string, any>();

  private readonly oracleConfigFactory = new OracleConfigFactory();
  private readonly adapterConfigFactory = new AdapterConfigFactory();
  private readonly bundlerConfigFactory = new BundlerConfigFactory();

  constructor(jsonParsed: ILevvaEcosystemConfig) {
    this.factory = new LevvaFactoryConfig(jsonParsed.factory);
    (jsonParsed.pools ?? []).forEach((pool) => {
      this.pools.push(new LevvaPoolConfig(pool));
    });

    this.getEntries(jsonParsed.oracles).forEach(([oracleKey, oracleJsonConfig]) => {
      const oracleConfig = this.oracleConfigFactory.getConfig(oracleKey, oracleJsonConfig);
      if (this.oracles.has(oracleKey)) {
        throw new Error(`Duplicate ${oracleKey} oracle key`);
      }
      this.oracles.set(oracleKey, oracleConfig);
    });

    this.getEntries(jsonParsed.adapters).forEach(([adapterKey, adapterJsonConfig]) => {
      const adapterConfig = this.adapterConfigFactory.getConfig(adapterKey, adapterJsonConfig);
      if (this.adapters.has(adapterKey)) {
        throw new Error(`Duplicate ${adapterKey} adapter key`);
      }
      this.adapters.set(adapterKey, adapterConfig);
    });

    this.getEntries(jsonParsed.bundlers).forEach(([bundlerKey, bundlerJsonConfig]) => {
      const bundlerConfig = this.bundlerConfigFactory.getConfig(bundlerKey, bundlerJsonConfig);
      if (this.bundlers.has(bundlerKey)) {
        throw new Error(`Duplicate ${bundlerKey} bundler key`);
      }
      this.bundlers.set(bundlerKey, bundlerConfig);
    });
  }

  async validate(provider: Provider): Promise<void> {
    await this.factory.validate(provider);
    await Promise.all(this.pools.map(async (pool) => await pool.validate(provider)));
    await Promise.all(Array.from(this.oracles.values()).map(async (oracle) => await oracle.validate(provider)));
    await Promise.all(Array.from(this.adapters.values()).map(async (adapter) => await adapter.validate(provider)));
    await Promise.all(Array.from(this.bundlers.values()).map(async (bundler) => await bundler.validate(provider)));
  }

  private getEntries(map?: Map<any, any>): any[] {
    return map ? Object.entries(map) : [];
  }
}
