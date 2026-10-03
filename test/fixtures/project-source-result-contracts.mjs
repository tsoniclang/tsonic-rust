export const projectSourceResultContracts = Object.freeze([
  Object.freeze({
    name: "exact-project-result-overloads",
    surfaces: Object.freeze(["js"]),
    crateName: "exact_project_result_overloads",
    source: `
import type { uint64 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
class Reader {
  count: uint64 = 0n;
  read(name: string): string;
  read(name: string, value: uint64): this;
  read(name: string, value?: uint64): string | this {
    if (value === undefined) return name;
    this.count = value;
    return this;
  }
  append(name: string): string;
  append(name: string, ...values: uint64[]): this;
  append(name: string, ...values: uint64[]): string | this {
    if (values.length === 0) return name;
    for (const value of values) this.count += value;
    return this;
  }
}
export function main(): void {
  const reader = new Reader();
  const exact: uint64 = 9007199254740993n;
  const chosen = reader.read("set", exact).append("add", 2n, 3n);
  check(chosen === reader);
  check(reader.count === exact + 5n);
  check(reader.read("selected text") === "selected text");
  check(reader.append("empty rest") === "empty rest");
}
`,
  }),
  Object.freeze({
    name: "exact-project-result-nominal",
    surfaces: Object.freeze([]),
    crateName: "exact_project_result_nominal",
    source: `
import type { uint64 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
class Base {
  count: uint64 = 1n;
  choose(other: Base): this { return other as this; }
  echo(value: uint64): uint64 { return value + this.count; }
}
class Derived extends Base {
  count: uint64 = 2n;
  choose(other: Base): this { return other as this; }
  echo(value: uint64): uint64 { return value + this.count; }
}
export function main(): void {
  const first = new Derived();
  const second = new Derived();
  const result = first.choose(second);
  check(result === second);
  check(result !== first);
  const base: Base = first;
  check(base.choose(second) === second);
  const echo = first.echo;
  check(echo(9007199254740993n) === 9007199254740995n);
  second.count = 7n;
  check(echo(1n) === 3n);
}
`,
  }),
  Object.freeze({
    name: "exact-project-result-optional-scalar",
    surfaces: Object.freeze([]),
    crateName: "exact_project_result_optional_scalar",
    source: `
import type { uint64 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
class Reader {
  read(): uint64 | undefined;
  read(set: boolean): uint64;
  read(set?: boolean): uint64 | undefined {
    return set === undefined ? undefined : 9007199254740993n;
  }
}
export function main(): void {
  const reader = new Reader();
  const value: uint64 = reader.read(true);
  check(value + 2n === 9007199254740995n);
  check(reader.read() === undefined);
  check(reader.read() === null);
}
`,
  }),
]);
