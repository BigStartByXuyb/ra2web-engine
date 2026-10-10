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
