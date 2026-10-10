/** 解析层错误基类：跨模块边界只允许返回这些错误，不抛原生 Error。 */
export class ParseError extends Error {
  public constructor(
    message: string,
    public readonly offset: number,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class TruncatedInputError extends ParseError {
  public constructor(needed: number, offset: number) {
    super(`input truncated: needs ${needed} byte(s)`, offset)
  }
}

export class UnsupportedMixHeaderError extends ParseError {
  public constructor(flags: number) {
    super(`unsupported MIX header flags 0x${flags.toString(16)} (encrypted headers not implemented)`, 0)
  }
}
