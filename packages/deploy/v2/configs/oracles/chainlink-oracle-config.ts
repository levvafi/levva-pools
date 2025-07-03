export interface SinglePairChainlinkOracleDeployConfig {
  type: 'single';
  quoteTokenId: string;
  baseTokenId: string;
  aggregatorV3: string;
  maxPriceAge: string;
}

export interface DoublePairChainlinkOracleDeployConfig {
  type: 'double';
  quoteTokenId: string;
  baseTokenId: string;
  intermediateTokenId: string;
  quoteAggregatorV3: string;
  baseAggregatorV3: string;
  maxPriceAge: string;
}

export type PairChainlinkOracleDeployConfig =
  | SinglePairChainlinkOracleDeployConfig
  | DoublePairChainlinkOracleDeployConfig;

function isSinglePairChainlinkOracleDeployConfig(
  config: PairChainlinkOracleDeployConfig
): config is SinglePairChainlinkOracleDeployConfig {
  return config.type === 'single';
}

function isDoublePairChainlinkOracleDeployConfig(
  config: PairChainlinkOracleDeployConfig
): config is DoublePairChainlinkOracleDeployConfig {
  return config.type === 'double';
}
