export type MarginlyPoolParameters = {
  maxLeverage: bigint;
  priceSecondsAgo: bigint;
  priceSecondsAgoMC: bigint;
  interestRate: bigint;
  fee: bigint;
  swapFee: bigint;
  mcSlippage: bigint;
  positionMinAmount: bigint;
  quoteLimit: bigint;
};

export const PositionType = {
  Uninitialized: 0,
  Lend: 1,
  Short: 2,
  Long: 3,
};

export type Position = {
  _type: number;
  discountedQuoteAmount: bigint;
  discountedBaseAmount: bigint;
};

export const MarginlyMode = {
  Regular: 0,
  ShortEmergency: 1,
  LongEmergency: 2,
};

export type HeapNode = { account: string; key: bigint };
