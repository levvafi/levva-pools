import { Provider, Signer } from 'ethers';
import { IUniswapV3Factory__factory } from '../../../contracts/typechain-types';
import { IUniswapV3Pool__factory } from '../../../contracts/typechain-types';
import { IWETH9__factory, IUSDC__factory } from '../../../contracts/typechain-types';

export const wethContract = (signerOrProvider?: Signer | Provider) =>
  IWETH9__factory.connect(`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`, signerOrProvider);

export const usdcContract = (signerOrProvider?: Signer | Provider) =>
  IUSDC__factory.connect(`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, signerOrProvider);

export const uniswapFactoryContract = (signerOrProvider?: Signer | Provider) =>
  IUniswapV3Factory__factory.connect(`0x1F98431c8aD98523631AE4a59f267346ea31F984`, signerOrProvider);

export const uniswapPoolContract = IUniswapV3Pool__factory.connect;
