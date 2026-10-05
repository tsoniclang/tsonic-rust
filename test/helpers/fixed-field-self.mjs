export const fixedFieldSelfSource = `
class Value {
  readonly recurse = (count: number): number => count === 0 ? 1 : this.recurse(count - 1);
}
export function escaped(): (count: number) => number { return new Value().recurse; }
export function run(): boolean {
  const callback = escaped();
  const alias = callback;
  const other = escaped();
  return callback === alias && callback !== other && callback(8) === 1 && alias(3) === 1 && other(2) === 1;
}
export function main(): void { if (!run()) throw new Error("fixed field self lifetime and identity"); }
`;
