export const genericCallableValueFiles = {
  "callbacks.ts": `
export interface Box<Value> { value: Value; label: string; }
export interface Mapper {
  readonly wrap: <Value>(value: Value) => Box<Value>;
}
export function createMapper(label: string): Mapper {
  const wrap = <Value>(value: Value): Box<Value> => ({ value, label });
  return { wrap };
}
`,
  "index.ts": `
import { check } from "@acme/testing";
import { createMapper } from "./callbacks.js";
export function main(): void {
  const first = createMapper("first");
  const second = createMapper("second");
  const alias = first.wrap;
  const numeric = alias(7);
  const text = first.wrap("retained");
  const independent = second.wrap(11);
  check(numeric.value === 7 && numeric.label === "first");
  check(text.value === "retained" && text.label === "first");
  check(independent.value === 11 && independent.label === "second");
}
`,
};

export const dependentCallableValueFiles = {
  "callbacks.ts": `
export interface Counter { calls: number; }
export interface FieldBuilder<Source> {
  readonly change: <Key extends keyof Source>(
    key: Key,
    copy: (value: Source[Key]) => Source[Key],
  ) => () => Source[Key];
}
export function createFields<Source>(owner: Source, counter: Counter): FieldBuilder<Source> {
  const change = <Key extends keyof Source>(
    key: Key,
    copy: (value: Source[Key]) => Source[Key],
  ): (() => Source[Key]) => {
    return (): Source[Key] => {
      counter.calls += 1;
      const next = copy(owner[key]);
      owner[key] = next;
      return next;
    };
  };
  return { change };
}
`,
  "index.ts": `
import { check } from "@acme/testing";
import { createFields } from "./callbacks.js";
interface Base<Value> { count: Value; }
interface Model extends Base<number> { label: string; }
export function main(): void {
  const owner: Model = { count: 3, label: "old" };
  const other: Model = { count: 20, label: "other" };
  const counter = { calls: 0 };
  const independentCounter = { calls: 0 };
  const fields = createFields(owner, counter);
  const independent = createFields(other, independentCounter);
  const alias = fields.change;
  const increment = alias("count", value => value + 1);
  const suffix = fields.change("label", value => value + "!");
  const independentIncrement = independent.change("count", value => value + 2);
  check(increment() === 4);
  check(suffix() === "old!");
  check(increment() === 5);
  check(independentIncrement() === 22);
  check(owner.count === 5 && owner.label === "old!");
  check(other.count === 22 && other.label === "other");
  check(counter.calls === 3 && independentCounter.calls === 1);
}
`,
};
