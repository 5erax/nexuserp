export class OrderRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
