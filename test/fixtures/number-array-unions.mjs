export const numberArrayUnionFiles = {
  "arrays.ts": `
export function copy(values: Uint8Array | readonly number[]): number[] {
  return Array.from(values);
}
export function read(values: Uint8Array | readonly number[], index: number): number {
  return values[index] ?? 0;
}
export function length(values: Uint8Array | readonly number[]): number {
  return values.length;
}
export function wide(values: Int16Array | readonly number[]): number[] {
  return Array.from(values);
}
`,
  "index.ts": `
import { check } from "@acme/testing";
import { copy, length, read, wide } from "./arrays.js";
export function main(): void {
  const bytes = new Uint8Array([1, 2, 255]);
  const values: number[] = [4, 5, 6];
  const first = copy(bytes);
  const second = copy(values);
  check(first.length === 3 && first[2] === 255);
  check(second.length === 3 && second[1] === 5);
  bytes[0] = 9;
  values[0] = 8;
  check(first[0] === 1 && second[0] === 4);
  check(read(bytes, 0) === 9 && read(values, 0) === 8);
  check(read(bytes, -1) === 0 && read(values, 10) === 0);
  check(read(bytes, 0.5) === 0);
  check(length(bytes) === 3 && length(values) === 3);
  const signed = wide(new Int16Array([-3, 32767]));
  check(signed[0] === -3 && signed[1] === 32767);
}
`,
};
