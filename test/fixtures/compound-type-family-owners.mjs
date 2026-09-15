export const compoundTypeFamilyOwnerFiles = {
  "storage.ts": `
import type { Pointer } from "@tsonic/core/types.js";
import { loadPointer, storePointer } from "@tsonic/core/lang.js";
declare const storage: unique symbol;
interface Stored<Value> { readonly [storage]: Value; }
type Storage<Value> = Value extends Stored<infer Inner> ? Inner : Value;
export type Entry<Key, Value> = { key: Storage<Key>; value: Storage<Value>; };
export class Job<Value> {
  payload: Value;
  constructor(payload: Value) { this.payload = payload; }
}
export function read<Value>(value: Storage<Pointer<Job<Value>> | undefined>): Value | undefined {
  if (value === undefined) return undefined;
  return loadPointer(value).payload;
}
export function write<Value>(value: Storage<Pointer<Job<Value>> | undefined>, payload: Value): void {
  if (value === undefined) return;
  storePointer(value, new Job(payload));
}
export function countEntries<Key, Value>(values: Entry<Key, Pointer<Job<Value>> | undefined>[],
  count: (entries: Entry<Key, Pointer<Job<Value>> | undefined>[]) => number): number {
  return count(values);
}
`,
  "index.ts": `
import { check } from "@acme/testing";
import { addressOf } from "@tsonic/core/lang.js";
import { Job, read, write, countEntries } from "./storage.js";
export function main(): void {
  let numericJob = new Job(7);
  let textJob = new Job("retained");
  const numeric = addressOf(numericJob);
  const text = addressOf(textJob);
  check(read(numeric) === 7);
  check(read(text) === "retained");
  check(read<number>(undefined) === undefined);
  write(numeric, 11);
  write(text, "changed");
  write<number>(undefined, 0);
  check(numericJob.payload === 11);
  check(textJob.payload === "changed");
  check(countEntries<number, number>([{ key: 1, value: numeric }], entries => 1) === 1);
}
`,
};
