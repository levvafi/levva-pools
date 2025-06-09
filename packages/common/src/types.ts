import { ethers } from 'ethers';

export class EthAddress {
  private static zeroRegex = /^0x0{40}$/;

  private readonly address: `0x${string}`;

  private constructor(address: `0x${string}`) {
    this.address = address;
  }

  public static parse(str: string): EthAddress {
    return new EthAddress(ethers.getAddress(str) as `0x${string}`);
  }

  public static isValidAddress(str: string): boolean {
    return ethers.isAddress(str);
  }

  public toString(): `0x${string}` {
    return this.address;
  }

  public isZero(): boolean {
    return this.address.match(EthAddress.zeroRegex) !== null;
  }

  public compare(other: EthAddress): number {
    const a = this.address.toLowerCase();
    const b = other.address.toLowerCase();

    if (a < b) {
      return -1;
    } else if (a == b) {
      return 0;
    } else {
      return 1;
    }
  }
}

export interface Fp96 {
  inner: bigint;
}

export const Fp96One = 2n ** 96n;
export const WHOLE_ONE = 10n ** 6n;
export const SECONDS_IN_YEAR_X96 = BigInt(365.25 * 24 * 60 * 60) * Fp96One;

export class RationalNumber {
  private static readonly regex: RegExp = /^(-)?(\d[0-9_]*)(\.\d+)?$/;
  public readonly nom: bigint;
  public readonly denom: bigint;

  private constructor(nom: bigint, denom: bigint) {
    this.nom = nom;
    this.denom = denom;
  }

  private static trimLeftZeros(str: string): string {
    for (let i = 0; i < str.length; i++) {
      if (str[i] !== '0') {
        return str.substring(i);
      }
    }
    return str;
  }

  private static trimRightZeros(str: string): string {
    for (let i = str.length - 1; i >= 0; i--) {
      if (str[i] !== '0') {
        return str.substring(0, i + 1);
      }
    }
    return str;
  }

  public static parse(str: string): RationalNumber {
    const match = str.match(this.regex);
    if (match === null) {
      throw new Error(`Can not parse rational number '${str}'`);
    }

    const sign = match[1] === '-' ? -1n : 1n;
    const integerStr = this.trimLeftZeros(match[2]).replace(/_/g, '');

    let fractionalStr = match[3];
    if (fractionalStr === undefined) {
      fractionalStr = '';
    } else {
      // remove dot
      fractionalStr = fractionalStr.substring(1);
      fractionalStr = this.trimRightZeros(fractionalStr);
    }

    const denomStr = '1' + '0'.repeat(fractionalStr.length);

    let nomStr = integerStr + fractionalStr;
    if (nomStr === '') {
      nomStr = '0';
    }

    return new RationalNumber(BigInt(nomStr) * sign, BigInt(denomStr));
  }

  public static parsePercent(str: string): RationalNumber {
    if (str.length < 1 || str[str.length - 1] !== '%') {
      throw new Error(`Invalid percent string '${str}'`);
    }
    // remove trailing %
    const numberStr = str.substring(0, str.length - 1);
    const rational = this.parse(numberStr);

    return new RationalNumber(rational.nom, rational.denom * 100n);
  }

  public mul(num: bigint): RationalNumber {
    return new RationalNumber(this.nom * num, this.denom);
  }

  public toFp96(): Fp96 {
    return { inner: (this.nom * Fp96One) / this.denom };
  }

  public toInteger(): bigint {
    return this.nom / this.denom;
  }
}
