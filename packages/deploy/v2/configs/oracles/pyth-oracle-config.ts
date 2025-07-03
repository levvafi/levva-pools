export interface SinglePairPythOracleDeployConfig {
  type: 'single';
  quoteTokenId: string;
  baseTokenId: string;
  pythPriceId: string;
  maxPriceAge: string;
}

export interface DoublePairPythOracleDeployConfig {
  type: 'double';
  quoteTokenId: string;
  baseTokenId: string;
  intermediateTokenId: string;
  basePythPriceId: string;
  quotePythPriceId: string;
}

export type PairPythOracleDeployConfig = SinglePairPythOracleDeployConfig | DoublePairPythOracleDeployConfig;

function isSinglePairPythOracleDeployConfig(
  config: PairPythOracleDeployConfig
): config is SinglePairPythOracleDeployConfig {
  return config.type === 'single';
}

function isDoublePairPythOracleDeployConfig(
  config: PairPythOracleDeployConfig
): config is DoublePairPythOracleDeployConfig {
  return config.type === 'double';
}

export interface PythOracleDeployConfig {
  type: 'pyth';
  id: string;
  pyth: string;
  settings?: PairPythOracleDeployConfig[];
}
