import assert from "node:assert/strict";
import test from "node:test";

import {
  createRustSession,
  rustSourceDiagnostics,
} from "./helpers/rust-session.mjs";

test("every pinned TypeScript utility preserves its negative source contract before Rust lowering", () => {
  const harness = createRustSession({ files: { "index.ts": invalidUtilitySource } });
  const diagnostics = rustSourceDiagnostics(harness);

  assert.equal(harness.checkedSource.diagnostics.length, 39, diagnostics);
  for (const expected of expectedDiagnostics) {
    assert.match(diagnostics, expected);
  }
});

const expectedDiagnostics = [
  /TS2741: Property 'value' is missing in type '\{\}' but required in type '\{ value: number; \}'/u,
  /TS2741: Property 'value' is missing[^\n]*Required<\{ value\?: number \| undefined; \}>/u,
  /TS2540: Cannot assign to 'value' because it is a read-only property/u,
  /TS2540: Cannot assign to 'partialReadonly' because it is a read-only property/u,
  /TS2540: Cannot assign to 'requiredReadonly' because it is a read-only property/u,
  /TS2540: Cannot assign to 'pickedReadonly' because it is a read-only property/u,
  /TS2540: Cannot assign to 'omittedReadonly' because it is a read-only property/u,
  /TS2353: Object literal may only specify known properties, and 'right' does not exist[^\n]*PickedLeft/u,
  /TS2353: Object literal may only specify known properties, and 'removed' does not exist[^\n]*WithoutRemoved/u,
  /TS2741: Property 'right' is missing[^\n]*Totals/u,
  /TS2322: Type '"left"' is not assignable to type '"right"'/u,
  /TS2322: Type '"right"' is not assignable to type '"left"'/u,
  /TS2322: Type 'null' is not assignable to type 'number'/u,
  /TS2322: Type '\[number\]' is not assignable to type '\[value: number, label: string\]'/u,
  /TS2322: Type '\[number\]' is not assignable to type '\[value: number, label: string\]'/u,
  /TS2322: Type 'number' is not assignable to type 'string'/u,
  /TS2322: Type 'string' is not assignable to type 'UtilityBox'/u,
  /TS2322: Type 'string' is not assignable to type 'number'/u,
  /TS2741: Property 'value' is missing[^\n]*Receiver/u,
  /TS2322: Type '\(value: int32\) => int32' is not assignable to type '\(value: number\) => string'/u,
  /TS2322: Type '"ready"' is not assignable to type '"READY"'/u,
  /TS2322: Type '"QUIET"' is not assignable to type '"quiet"'/u,
  /TS2322: Type '"hello"' is not assignable to type '"Hello"'/u,
  /TS2322: Type '"World"' is not assignable to type '"world"'/u,
  /TS2345: Argument of type '"blue"' is not assignable to parameter of type '"red"'/u,
  /TS2339: Property 'missing' does not exist on type 'ContextReceiver'/u,
  /TS2344: Type 'string' does not satisfy the constraint '\(\.\.\.args: any\) => any'/u,
  /TS2344: Type 'string' does not satisfy the constraint 'abstract new \(\.\.\.args: any\) => any'/u,
  /TS2344: Type 'number' does not satisfy the constraint 'string'/u,
  /TS2322: Type 'number' is not assignable to type 'string'/u,
  /TS2353: Object literal may only specify known properties, and 'numeric' does not exist in type 'ConstructedText'/u,
  /TS2353: Object literal may only specify known properties, and 'first' does not exist in type 'LastReceiver'/u,
  /TS2322: Type '\(value: int32\) => int32' is not assignable to type '\(value: string\) => string'/u,
  /TS2322: Type 'unknown' is not assignable to type 'string'/u,
  /TS2322: Type '\[number, string, true, string\]' is not assignable to type '\[first: number, label\?: string \| undefined, \.\.\.flags: boolean\[\]\]'[\s\S]*Type 'string' is not assignable to type 'boolean'/u,
];

const invalidUtilitySource = `
import type { int32 } from "@tsonic/core/types.js";

type PartialNested = Partial<{ nested: { value: int32 } }>;
const badPartial: PartialNested = { nested: {} };

type RequiredValue = Required<{ value?: int32 }>;
const badRequired: RequiredValue = {};

type ReadonlyValue = Readonly<{ value: int32 }>;
const badReadonly: ReadonlyValue = { value: 1 as int32 };
badReadonly.value = 2 as int32;

const partialModifiers: Partial<{ readonly partialReadonly: int32 }> = {
  partialReadonly: 1 as int32,
};
partialModifiers.partialReadonly = 2 as int32;

const requiredModifiers: Required<{ readonly requiredReadonly?: int32 }> = {
  requiredReadonly: 1 as int32,
};
requiredModifiers.requiredReadonly = 2 as int32;

const pickedModifiers: Pick<{
  readonly pickedReadonly?: int32;
  ignored: string;
}, "pickedReadonly"> = { pickedReadonly: 1 as int32 };
pickedModifiers.pickedReadonly = 2 as int32;

const omittedModifiers: Omit<{
  readonly omittedReadonly?: int32;
  removed: string;
}, "removed"> = { omittedReadonly: 1 as int32 };
omittedModifiers.omittedReadonly = 2 as int32;

const readonlyOptional: Readonly<{ optional?: int32 }> = {};

type PickedLeft = Pick<{ left: int32; right: string }, "left">;
const badPick: PickedLeft = { left: 1 as int32, right: "extra" };

type WithoutRemoved = Omit<{ kept: int32; removed: string }, "removed">;
const badOmit: WithoutRemoved = { kept: 1 as int32, removed: "extra" };

type Totals = Record<"left" | "right", int32>;
const badRecord: Totals = { left: 1 as int32 };

type Excluded = Exclude<"left" | "right", "left">;
const badExclude: Excluded = "left";

type Extracted = Extract<"left" | "right", "left">;
const badExtract: Extracted = "right";

type Present = NonNullable<int32 | null | undefined>;
const badNonNullable: Present = null;

type Formatter = (value: int32, label: string) => string;
type FormatterParameters = Parameters<Formatter>;
const badParameters: FormatterParameters = [1 as int32];

class UtilityBox {
  value: int32;
  constructor(value: int32, label: string) {
    this.value = value;
    void label;
  }
}
type UtilityBoxParameters = ConstructorParameters<typeof UtilityBox>;
const badConstructorParameters: UtilityBoxParameters = [1 as int32];

type FormatterResult = ReturnType<Formatter>;
const badReturnType: FormatterResult = 1 as int32;

type UtilityBoxInstance = InstanceType<typeof UtilityBox>;
const badInstanceType: UtilityBoxInstance = "box";

interface Thenable<T> {
  then(onfulfilled: (value: T) => void): void;
}
type AwaitedNumber = Awaited<Thenable<Thenable<int32>>>;
const badAwaited: AwaitedNumber = "not-number";

interface Receiver { value: int32; }
type Bound = (this: Receiver, value: int32) => string;
type SelectedReceiver = ThisParameterType<Bound>;
const badReceiver: SelectedReceiver = {};

type Detached = OmitThisParameter<Bound>;
const badDetached: Detached = (value: int32): int32 => value;

type Loud = Uppercase<"ready">;
const badUppercase: Loud = "ready";
type Quiet = Lowercase<"QUIET">;
const badLowercase: Quiet = "QUIET";
type Greeting = Capitalize<"hello">;
const badCapitalize: Greeting = "hello";
type Subject = Uncapitalize<"World">;
const badUncapitalize: Subject = "World";

function choose<C extends string>(value: C, fallback: NoInfer<C>): C {
  void fallback;
  return value;
}
const badNoInfer = choose("red", "blue");

interface ContextReceiver { value: int32; }
interface ContextMethods { read(): int32; }
type Context = ContextMethods & ThisType<ContextReceiver>;
const badThisType: Context = {
  read(): int32 { return this.missing; },
};

interface CallableOverload {
  (value: int32): int32;
  (value: string, suffix?: string): string;
}
type OverloadedArguments = Parameters<CallableOverload>;
const badOverloadedArguments: OverloadedArguments = [1 as int32];
type OverloadedResult = ReturnType<CallableOverload>;
const badOverloadedResult: OverloadedResult = 1 as int32;

interface ConstructedNumber { numeric: int32; }
interface ConstructedText { text: string; }
interface ConstructorOverload {
  new(value: int32): ConstructedNumber;
  new(value: string, suffix?: string): ConstructedText;
}
type OverloadedConstructorArguments = ConstructorParameters<ConstructorOverload>;
const badOverloadedConstructorArguments: OverloadedConstructorArguments = [1 as int32];
type OverloadedInstance = InstanceType<ConstructorOverload>;
const badOverloadedInstance: OverloadedInstance = { numeric: 1 as int32 };

interface FirstReceiver { first: int32; }
interface LastReceiver { last: string; }
interface ThisOverload {
  (this: FirstReceiver, value: int32): int32;
  (this: LastReceiver, value: string): string;
}
type OverloadedReceiver = ThisParameterType<ThisOverload>;
const badOverloadedReceiver: OverloadedReceiver = { first: 1 as int32 };
type OverloadedDetached = OmitThisParameter<ThisOverload>;
const badOverloadedDetached: OverloadedDetached = (value: int32): int32 => value;

type Plain = (value: int32) => int32;
const implicitReceiver: ThisParameterType<Plain> = "unknown";
const badImplicitReceiverUse: string = implicitReceiver;

type HeterogeneousRest = (first: int32, label?: string, ...flags: boolean[]) => string;
type HeterogeneousArguments = Parameters<HeterogeneousRest>;
const badHeterogeneousArguments: HeterogeneousArguments = [
  1 as int32,
  "label",
  true,
  "not-boolean",
];

type InvalidParametersInput = Parameters<string>;
type InvalidReturnTypeInput = ReturnType<string>;
type InvalidConstructorParametersInput = ConstructorParameters<string>;
type InvalidInstanceTypeInput = InstanceType<string>;
type InvalidUppercaseInput = Uppercase<int32>;

export function keepModule(): void {
  void badPartial;
  void badRequired;
  void badPick;
  void badOmit;
  void badRecord;
  void badExclude;
  void badExtract;
  void badNonNullable;
  void badParameters;
  void badConstructorParameters;
  void badReturnType;
  void badInstanceType;
  void badAwaited;
  void badReceiver;
  void badDetached;
  void badUppercase;
  void badLowercase;
  void badCapitalize;
  void badUncapitalize;
  void badNoInfer;
  void badThisType;
  void badOverloadedArguments;
  void badOverloadedResult;
  void badOverloadedConstructorArguments;
  void badOverloadedInstance;
  void badOverloadedReceiver;
  void badOverloadedDetached;
  void badImplicitReceiverUse;
  void badHeterogeneousArguments;
  void readonlyOptional;
}
`;
