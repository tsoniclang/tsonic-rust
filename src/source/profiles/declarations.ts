import { targetSourceProfileDeclaration, typescriptNoLibUtilityDeclarations } from "@tsonic/target-api/provider";
import { jsSurfaceSourceProfileDeclarations, sourceErrorDeclarations } from "@tsonic/js-source-profile";
import type { TargetSourceProfileContributions } from "@tsonic/target-api/provider";
import { rustTargetId } from "../../target-model/identities/target.js";

export const rustSourceProfileOwnerId = rustTargetId;
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

${sourceErrorDeclarations}

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

interface Symbol {
  readonly description: string | undefined;
  toString(): string;
  valueOf(): symbol;
}

interface SymbolConstructor {
  readonly iterator: unique symbol;
  readonly asyncIterator: unique symbol;
  readonly dispose: unique symbol;
  readonly asyncDispose: unique symbol;
}
declare var Symbol: SymbolConstructor;

interface IteratorYieldResult<TYield> {
  done?: false;
  value: TYield;
}
interface IteratorReturnResult<TReturn> {
  done: true;
  value: TReturn;
}
type IteratorResult<T, TReturn = unknown> = IteratorYieldResult<T> | IteratorReturnResult<TReturn>;
interface Iterator<T, TReturn = unknown, TNext = unknown> {
  next(): IteratorResult<T, TReturn>;
  next(value: TNext): IteratorResult<T, TReturn>;
}
interface Iterable<T, TReturn = unknown, TNext = unknown> {
  [Symbol.iterator](): Iterator<T, TReturn, TNext>;
}
interface IterableIterator<T, TReturn = unknown, TNext = unknown> extends Iterator<T, TReturn, TNext>, Iterable<T, TReturn, TNext> {}
interface AsyncIterator<T, TReturn = unknown, TNext = unknown> {
  next(): Promise<IteratorResult<T, TReturn>>;
  next(value: TNext): Promise<IteratorResult<T, TReturn>>;
}
interface AsyncIterable<T, TReturn = unknown, TNext = unknown> {
  [Symbol.asyncIterator](): AsyncIterator<T, TReturn, TNext>;
}
interface AsyncIterableIterator<T, TReturn = unknown, TNext = unknown> extends AsyncIterator<T, TReturn, TNext>, AsyncIterable<T, TReturn, TNext> {}
interface Generator<T = unknown, TReturn = unknown, TNext = unknown> extends Iterator<T, TReturn, TNext> {
  next(): IteratorResult<T, TReturn>;
  next(value: TNext): IteratorResult<T, TReturn>;
  return(value: TReturn): IteratorResult<T, TReturn>;
  throw(error: unknown): IteratorResult<T, TReturn>;
  [Symbol.iterator](): Generator<T, TReturn, TNext>;
}
interface AsyncGenerator<T = unknown, TReturn = unknown, TNext = unknown> extends AsyncIterator<T, TReturn, TNext> {
  next(): Promise<IteratorResult<T, TReturn>>;
  next(value: TNext): Promise<IteratorResult<T, TReturn>>;
  return(value: TReturn): Promise<IteratorResult<T, TReturn>>;
  throw(error: unknown): Promise<IteratorResult<T, TReturn>>;
  [Symbol.asyncIterator](): AsyncGenerator<T, TReturn, TNext>;
}
interface Disposable {
  [Symbol.dispose](): void;
}
interface AsyncDisposable {
  [Symbol.asyncDispose](): void | PromiseLike<void>;
}

`.trim();

const rustNativeProfileDeclarations = `
${sharedNoLibDeclarations}

interface String {
  len(): import("@tsonic/rust/types.js").usize;
  is_empty(): boolean;
  contains(pattern: string): boolean;
  starts_with(pattern: string): boolean;
  ends_with(pattern: string): boolean;
  find(pattern: string): import("@tsonic/rust/types.js").usize | undefined;
  rfind(pattern: string): import("@tsonic/rust/types.js").usize | undefined;
}

interface Array<T> extends Iterable<T> {
  [index: number]: T;
}

interface ReadonlyArray<T> extends Iterable<T> {
  readonly [index: number]: T;
}
`.trim();



export function rustNativeSourceProfileContributions(): TargetSourceProfileContributions {
  return {
    declarations: [
      targetSourceProfileDeclaration(
        "typescript-utilities.d.ts",
        typescriptNoLibUtilityDeclarations,
      ),
      targetSourceProfileDeclaration("rust-globals.d.ts", rustNativeProfileDeclarations),
    ],
  };
}

export function rustJsSurfaceSourceProfileContributions(): TargetSourceProfileContributions {
  return {
    declarations: [
      targetSourceProfileDeclaration(
        "typescript-utilities.d.ts",
        typescriptNoLibUtilityDeclarations,
      ),
      targetSourceProfileDeclaration("js-globals.d.ts", jsSurfaceSourceProfileDeclarations),
    ],
  };
}
