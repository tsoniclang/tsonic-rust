import {
  targetSourceProfileDeclaration,
} from "@tsonic/target-api";
import type {
  TargetProviderSourceProfileContext,
  TargetSourceProfileContributions,
} from "@tsonic/target-api";
import { readRustTypescriptCompatibilityMode } from "../../options/rust-target-options.js";

export const rustSourceProfileOwnerId = "rust-provider";
export const rustJsSourceProfileOwnerId = "js";

const sharedNoLibDeclarations = `
type PropertyKey = string | number | symbol;

interface Object {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {
  readonly length: number;
  [index: number]: unknown;
}
interface Boolean {}
interface Number {}
interface String {}
interface RegExp {}

interface Error {
  name: string;
  message: string;
  stack?: string;
}
interface ErrorConstructor {
  new (message?: string): Error;
  (message?: string): Error;
}
declare var Error: ErrorConstructor;

interface PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1) | null,
    onrejected?: ((reason: unknown) => TResult2) | null
  ): PromiseLike<TResult1 | TResult2>;
}

interface Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1) | null,
    onrejected?: ((reason: unknown) => TResult2) | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(onrejected?: ((reason: unknown) => TResult) | null): Promise<T | TResult>;
}

interface PromiseConstructor {
  new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void): Promise<T>;
  resolve<T>(value: T | PromiseLike<T>): Promise<T>;
  reject<T = never>(reason?: unknown): Promise<T>;
  all<T extends readonly unknown[]>(values: T): Promise<{ [K in keyof T]: Awaited<T[K]> }>;
}
declare var Promise: PromiseConstructor;

interface SymbolConstructor {
  readonly iterator: unique symbol;
  readonly asyncIterator: unique symbol;
}
declare var Symbol: SymbolConstructor;

interface IteratorResult<T, TReturn = unknown> {
  done?: boolean;
  value: T | TReturn;
}
interface Iterator<T, TReturn = unknown, TNext = unknown> {
  next(...args: [] | [TNext]): IteratorResult<T, TReturn>;
}
interface Iterable<T> {
  [Symbol.iterator](): Iterator<T>;
}
interface IterableIterator<T> extends Iterator<T>, Iterable<T> {}
interface AsyncIterator<T, TReturn = unknown, TNext = unknown> {
  next(...args: [] | [TNext]): Promise<IteratorResult<T, TReturn>>;
}
interface AsyncIterable<T> {
  [Symbol.asyncIterator](): AsyncIterator<T>;
}
interface AsyncIterableIterator<T> extends AsyncIterator<T>, AsyncIterable<T> {}

type Partial<T> = { [P in keyof T]?: T[P] };
type Required<T> = { [P in keyof T]-?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type Record<K extends keyof any, T> = { [P in K]: T };
type NonNullable<T> = T & {};
type Uppercase<S extends string> = intrinsic;
type Lowercase<S extends string> = intrinsic;
type Capitalize<S extends string> = intrinsic;
type Uncapitalize<S extends string> = intrinsic;
type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;
type ConstructorParameters<T extends abstract new (...args: any) => any> = T extends abstract new (...args: infer P) => any ? P : never;
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;
type InstanceType<T extends abstract new (...args: any) => any> = T extends abstract new (...args: any) => infer R ? R : any;
type Awaited<T> = T extends null | undefined ? T : T extends Promise<infer V> ? Awaited<V> : T;
`.trim();

const rustNativeProfileDeclarations = `
${sharedNoLibDeclarations}

interface Array<T> extends Iterable<T> {
  [index: number]: T;
}

interface ReadonlyArray<T> extends Iterable<T> {
  readonly [index: number]: T;
}
`.trim();

const rustJsSurfaceProfileDeclarations = `
${sharedNoLibDeclarations}

interface Object {
  hasOwnProperty(key: PropertyKey): boolean;
  toString(): string;
}

interface ObjectConstructor {
  keys(value: object): string[];
  values<T>(value: { [key: string]: T } | ArrayLike<T>): T[];
  entries<T>(value: { [key: string]: T } | ArrayLike<T>): [string, T][];
  assign<T extends object, U extends object>(target: T, source: U): T & U;
  hasOwn(value: object, key: PropertyKey): boolean;
  is(value: unknown, other: unknown): boolean;
}
declare var Object: ObjectConstructor;

interface Number {
  toString(radix?: number): string;
  valueOf(): number;
  toFixed(fractionDigits?: number): string;
  toExponential(fractionDigits?: number): string;
  toPrecision(precision?: number): string;
}
interface NumberConstructor {
  readonly NaN: number;
  readonly NEGATIVE_INFINITY: number;
  readonly POSITIVE_INFINITY: number;
  new (value?: unknown): Number;
  (value?: unknown): number;
  isFinite(value: unknown): boolean;
  isInteger(value: unknown): boolean;
  isNaN(value: unknown): boolean;
  isSafeInteger(value: unknown): boolean;
  parseFloat(value: string): number;
  parseInt(value: string, radix?: number): number;
}
declare var Number: NumberConstructor;

interface String {
  readonly length: number;
  readonly [index: number]: string;
  split(separator: string | RegExp, limit?: number): string[];
  startsWith(value: string, position?: number): boolean;
  endsWith(value: string, endPosition?: number): boolean;
  includes(value: string, position?: number): boolean;
  trim(): string;
  trimStart(): string;
  trimEnd(): string;
  toString(): string;
  valueOf(): string;
  charAt(index: number): string;
  indexOf(searchString: string, position?: number): number;
  at(index: number): string | undefined;
  match(regexp: RegExp): RegExpMatchArray | null;
  matchAll(regexp: RegExp): IterableIterator<RegExpMatchArray>;
  replace(searchValue: string | RegExp, replaceValue: string): string;
  search(regexp: string | RegExp): number;
  padStart(maxLength: number, fillString?: string): string;
  padEnd(maxLength: number, fillString?: string): string;
  toLowerCase(): string;
  toUpperCase(): string;
}
interface StringConstructor {
  new (value?: unknown): String;
  (value?: unknown): string;
}
declare var String: StringConstructor;

interface Array<T> extends Iterable<T> {
  length: number;
  [index: number]: T;
  push(...items: T[]): number;
  at(index: number): T | undefined;
  includes(searchElement: T, fromIndex?: number): boolean;
  indexOf(searchElement: T, fromIndex?: number): number;
  filter(callbackfn: (value: T, index: number, array: T[]) => unknown): T[];
  find(callbackfn: (value: T, index: number, array: T[]) => unknown): T | undefined;
  findIndex(callbackfn: (value: T, index: number, array: T[]) => unknown): number;
  findLast(callbackfn: (value: T, index: number, array: T[]) => unknown): T | undefined;
  findLastIndex(callbackfn: (value: T, index: number, array: T[]) => unknown): number;
  some(callbackfn: (value: T, index: number, array: T[]) => unknown): boolean;
  every(callbackfn: (value: T, index: number, array: T[]) => unknown): boolean;
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[];
  reduce(callbackfn: (previousValue: T, currentValue: T) => T): T;
  reduce(callbackfn: (previousValue: T, currentValue: T) => T, initialValue: T): T;
  reduce<U>(callbackfn: (previousValue: U, currentValue: T) => U, initialValue: U): U;
}

interface ReadonlyArray<T> extends Iterable<T> {
  readonly length: number;
  readonly [index: number]: T;
  at(index: number): T | undefined;
  includes(searchElement: T, fromIndex?: number): boolean;
  indexOf(searchElement: T, fromIndex?: number): number;
  filter(callbackfn: (value: T, index: number, array: readonly T[]) => unknown): T[];
  find(callbackfn: (value: T, index: number, array: readonly T[]) => unknown): T | undefined;
  findIndex(callbackfn: (value: T, index: number, array: readonly T[]) => unknown): number;
  findLast(callbackfn: (value: T, index: number, array: readonly T[]) => unknown): T | undefined;
  findLastIndex(callbackfn: (value: T, index: number, array: readonly T[]) => unknown): number;
  some(callbackfn: (value: T, index: number, array: readonly T[]) => unknown): boolean;
  every(callbackfn: (value: T, index: number, array: readonly T[]) => unknown): boolean;
  map<U>(callbackfn: (value: T, index: number, array: readonly T[]) => U): U[];
}

interface ArrayConstructor {
  new <T>(...items: T[]): T[];
  <T>(...items: T[]): T[];
  isArray(value: unknown): value is unknown[];
}
declare var Array: ArrayConstructor;

interface ArrayLike<T> {
  readonly length: number;
  readonly [index: number]: T;
}

interface RegExp {
  readonly source: string;
  readonly flags: string;
  readonly global: boolean;
  readonly ignoreCase: boolean;
  readonly multiline: boolean;
  lastIndex: number;
  test(value: string): boolean;
  exec(value: string): RegExpExecArray | null;
}
interface RegExpExecArray extends Array<string> {
  index: number;
  input: string;
}
interface RegExpMatchArray extends Array<string> {
  index?: number;
  input?: string;
}
interface RegExpConstructor {
  new (pattern: string | RegExp, flags?: string): RegExp;
  (pattern: string | RegExp, flags?: string): RegExp;
}
declare var RegExp: RegExpConstructor;

interface Map<K, V> extends Iterable<[K, V]> {
  readonly size: number;
  get(key: K): V | undefined;
  set(key: K, value: V): this;
  has(key: K): boolean;
  delete(key: K): boolean;
}
interface MapConstructor {
  new <K, V>(entries?: readonly (readonly [K, V])[] | Iterable<readonly [K, V]>): Map<K, V>;
}
declare var Map: MapConstructor;

interface Set<T> extends Iterable<T> {
  readonly size: number;
  add(value: T): this;
  has(value: T): boolean;
  delete(value: T): boolean;
  union(other: Set<T>): Set<T>;
  intersection(other: Set<T>): Set<T>;
  difference(other: Set<T>): Set<T>;
  symmetricDifference(other: Set<T>): Set<T>;
  isSubsetOf(other: Set<T>): boolean;
  isSupersetOf(other: Set<T>): boolean;
  isDisjointFrom(other: Set<T>): boolean;
}
interface SetConstructor {
  new <T>(values?: readonly T[] | Iterable<T>): Set<T>;
}
declare var Set: SetConstructor;

interface Date {
  getTime(): number;
  valueOf(): number;
  toISOString(): string;
  toJSON(): string;
}
interface DateConstructor {
  new (): Date;
  new (value: number | string): Date;
  now(): number;
  parse(value: string): number;
  UTC(year: number, monthIndex: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): number;
}
declare var Date: DateConstructor;

interface JSON {
  parse(text: string): unknown;
  stringify(value: unknown, replacer?: null, space?: string | number): string | undefined;
}
declare var JSON: JSON;

interface Math {
  floor(x: number): number;
  ceil(x: number): number;
  trunc(x: number): number;
  abs(x: number): number;
  sqrt(x: number): number;
  pow(x: number, y: number): number;
  round(x: number): number;
  max(...values: number[]): number;
  min(...values: number[]): number;
  random(): number;
}
declare var Math: Math;
`.trim();

export function rustSourceProfileContributions(
  context: TargetProviderSourceProfileContext,
): TargetSourceProfileContributions {
  const jsSurfaceSelected = context.selectedSurfaces.some((surface) => surface.id === rustJsSourceProfileOwnerId);
  if (jsSurfaceSelected) {
    return { declarations: [] };
  }
  if (readRustTypescriptCompatibilityMode(context.target) === "compat") {
    return {
      declarations: [
        targetSourceProfileDeclaration("js-globals.d.ts", rustJsSurfaceProfileDeclarations),
      ],
    };
  }
  return {
    declarations: [
      targetSourceProfileDeclaration("rust-globals.d.ts", rustNativeProfileDeclarations),
    ],
  };
}

export function rustJsSurfaceSourceProfileContributions(): TargetSourceProfileContributions {
  return {
    declarations: [
      targetSourceProfileDeclaration("js-globals.d.ts", rustJsSurfaceProfileDeclarations),
    ],
  };
}
