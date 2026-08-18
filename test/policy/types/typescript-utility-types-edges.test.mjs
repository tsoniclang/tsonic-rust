import assert from "node:assert/strict";
import test from "node:test";

import {
  acmeTestingPackage,
  artifactText,
  compileRust,
  createRustSession,
  rustSourceDiagnostics,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("utility transformations preserve modifiers, overload selection, variadic parameters, recursion, and canonical identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "typescript_utility_type_edges" },
    },
    files: {
      "index.ts": edgeUtilitySource,
      "overloads.d.ts": overloadDeclarations,
      "shadows.d.ts": shadowUtilityDeclarations,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  for (const functionName of expectedFunctions) {
    assert.match(source, new RegExp(`\\b${functionName}\\b`, "u"));
  }
  assert.match(source, /fn optional_summary\(values: \(i32, Option<String>\)\)/u);
  assert.match(source, /fn rest_summary\(values: &mut \[bool\]\)/u);
  assert.match(source, /rest_summary\(&mut \[false\]\)/u);
  assert.match(source, /rest_summary\(&mut \[true, false\]\)/u);
  assert.doesNotMatch(source, /rest_summary\(&mut vec!/u);
  assert.match(source, /fn overload_summary\(values: \(String, Option<String>\)\)/u);
  assert.match(
    artifactText(result, "src/shapes.rs"),
    /pub\(crate\) struct IdLabelNestedShape/u,
  );
  assert.equal(
    validateGeneratedProject("typescript-utility-type-edges", result.artifacts, { run: true }).status,
    0,
  );
});

test("the source checker resolves utility shapes that intentionally have no native runtime carrier", () => {
  const harness = createRustSession({ files: { "index.ts": sourceOnlyUtilityEdges } });

  assert.equal(rustSourceDiagnostics(harness), "");
});

const expectedFunctions = [
  "modifier_summary",
  "optional_summary",
  "rest_summary",
  "overload_summary",
  "construct_optional",
  "nested_awaited",
  "call_bound",
  "choose_literal",
  "contextual_read",
  "loud_union",
  "local_identity_summary",
];

const edgeUtilitySource = `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
import type { Overloaded } from "./overloads.js";
import type {
  OmitThisParameter as LocalOmitThisParameter,
  Parameters as LocalParameters,
  Partial as LocalPartial,
  ReturnType as LocalReturnType,
} from "./shadows.js";

interface Nested { value: int32; }
interface ModifierModel {
  readonly id: int32;
  label?: string;
  nested: Nested;
}
type ModifierPatch = Partial<ModifierModel>;
type ModifierRequired = Required<ModifierModel>;
type ModifierReadonly = Readonly<ModifierRequired>;
type ModifierPick = Pick<ModifierModel, "id" | "label">;
type ModifierOmit = Omit<ModifierModel, "nested">;
type ModifierRecord = Record<"left" | "right", int32>;

function modifierSummary(
  patch: ModifierPatch,
  required: ModifierRequired,
  readonlyValue: ModifierReadonly,
  picked: ModifierPick,
  omitted: ModifierOmit,
  record: ModifierRecord,
): string {
  const patchValue = patch.nested?.value ?? (0 as int32);
  const pickedLabel = picked.label ?? "none";
  const omittedLabel = omitted.label ?? "none";
  return \`${"${patchValue}:${required.label}:${readonlyValue.id}:${pickedLabel}:${omittedLabel}:${record.left + record.right}"}\`;
}

type Optional = (first: int32, label?: string) => string;
type OptionalParameters = Parameters<Optional>;
type OptionalResult = ReturnType<Optional>;
function optionalSummary(values: OptionalParameters): OptionalResult {
  return \`${"${values[0]}:${values[1] ?? \"none\"}"}\`;
}

type Rest = (...flags: boolean[]) => boolean;
type RestParameters = Parameters<Rest>;
type RestResult = ReturnType<Rest>;
function restSummary(values: RestParameters): RestResult {
  return values[0];
}

type OverloadedParameters = Parameters<Overloaded>;
type OverloadedResult = ReturnType<Overloaded>;
function overloadSummary(values: OverloadedParameters): OverloadedResult {
  return \`${"${values[0]}${values[1] ?? \"\"}"}\`;
}

class OptionalBox {
  value: int32;
  label: string;
  constructor(value: int32, label?: string) {
    this.value = value;
    this.label = label ?? "none";
  }
}
type OptionalBoxParameters = ConstructorParameters<typeof OptionalBox>;
type OptionalBoxInstance = InstanceType<typeof OptionalBox>;
function constructOptional(values: OptionalBoxParameters): OptionalBoxInstance {
  return new OptionalBox(values[0], values[1]);
}

interface Thenable<T> {
  then(onfulfilled: (value: T) => void): void;
}
type NestedAwaited = Awaited<Thenable<Thenable<int32>>>;
function nestedAwaited(value: NestedAwaited): int32 { return value; }

interface Receiver { value: int32; }
type Bound = (this: Receiver, value: int32, label?: string) => string;
type BoundReceiver = ThisParameterType<Bound>;
type DetachedBound = OmitThisParameter<Bound>;
function callBound(receiver: BoundReceiver, callable: DetachedBound): string {
  return \`${"${receiver.value}:${callable(3 as int32, \"bound\")}"}\`;
}

function choose<C>(value: C, fallback: NoInfer<C>): C {
  void fallback;
  return value;
}
function chooseLiteral(): string { return choose("red", "red"); }

interface ContextReceiver { value: int32; }
interface ContextMethods { read(): int32; }
type Context = ContextReceiver & ContextMethods & ThisType<ContextReceiver & ContextMethods>;
function contextualRead(): int32 {
  const value: Context = {
    value: 9 as int32,
    read(): int32 { return this.value; },
  };
  return value.read();
}

type LoudUnion = Uppercase<"ready" | "set">;
type QuietUnion = Lowercase<"LOUD" | "QUIET">;
type GreetingUnion = Capitalize<"hello" | "world">;
type SubjectUnion = Uncapitalize<"Alpha" | "Beta">;
function loudUnion(selected: boolean): string {
  const loud: LoudUnion = selected ? "READY" : "SET";
  const quiet: QuietUnion = selected ? "loud" : "quiet";
  const greeting: GreetingUnion = selected ? "Hello" : "World";
  const subject: SubjectUnion = selected ? "alpha" : "beta";
  return \`${"${loud}:${quiet}:${greeting}:${subject}"}\`;
}

function localPartial(value: LocalPartial<{ value: int32 }>): string { return value; }
function localParameters(value: LocalParameters<(value: int32) => int32>): [string] { return value; }
function localReturn(value: LocalReturnType<() => string>): boolean { return value; }
function localDetached(value: LocalOmitThisParameter<(this: { value: int32 }) => string>): int32 { return value; }

function localIdentitySummary(): string {
  return \`${"${localPartial(\"shadow\")}:${localParameters([\"tuple\"])[0]}:${localReturn(true)}:${localDetached(7 as int32)}"}\`;
}

export function main(): void {
  check(modifierSummary(
    { nested: { value: 1 as int32 } },
    { id: 2 as int32, label: "required", nested: { value: 3 as int32 } },
    { id: 4 as int32, label: "readonly", nested: { value: 5 as int32 } },
    { id: 6 as int32 },
    { id: 7 as int32 },
    { left: 8 as int32, right: 9 as int32 },
  ) === "1:required:4:none:none:17");
  check(optionalSummary([10 as int32]) === "10:none");
  check(optionalSummary([11 as int32, "label"]) === "11:label");
  check(!restSummary([false]));
  check(restSummary([true, false]));
  check(overloadSummary(["over", "load"]) === "overload");
  const box = constructOptional([12 as int32]);
  check(box.value === (12 as int32) && box.label === "none");
  check(nestedAwaited(13 as int32) === (13 as int32));
  check(callBound(
    { value: 14 as int32 },
    (value: int32, label?: string): string =>
      \`${"${value}:${label ?? \"none\"}"}\`,
  ) === "14:3:bound");
  check(chooseLiteral() === "red");
  check(contextualRead() === (9 as int32));
  check(loudUnion(true) === "READY:loud:Hello:alpha");
  check(localIdentitySummary() === "shadow:tuple:true:7");
}
`;

const overloadDeclarations = `
import type { int32 } from "@tsonic/core/types.js";

export interface Overloaded {
  (value: int32): int32;
  (value: string, suffix?: string): string;
}
`;

const sourceOnlyUtilityEdges = `
import type { int32 } from "@tsonic/core/types.js";

interface CallableOverload {
  (value: int32): int32;
  (value: string, suffix?: string): string;
}
const callableArguments: Parameters<CallableOverload> = ["value"];
const callableResult: ReturnType<CallableOverload> = "value";

interface ConstructedNumber { numeric: int32; }
interface ConstructedText { text: string; }
interface ConstructorOverload {
  new(value: int32): ConstructedNumber;
  new(value: string, suffix?: string): ConstructedText;
}
const constructorArguments: ConstructorParameters<ConstructorOverload> = ["value"];
const constructed: InstanceType<ConstructorOverload> = { text: "value" };

interface FirstReceiver { first: int32; }
interface LastReceiver { last: string; }
interface ThisOverload {
  (this: FirstReceiver, value: int32): int32;
  (this: LastReceiver, value: string): string;
}
const selectedReceiver: ThisParameterType<ThisOverload> = { last: "value" };
const detached: OmitThisParameter<ThisOverload> = (value: string): string => value;

type Plain = (value: int32) => int32;
let implicitReceiver: ThisParameterType<Plain> = "unknown is intentionally broad";
implicitReceiver = 1 as int32;

type HeterogeneousRest = (first: int32, label?: string, ...flags: boolean[]) => string;
const heterogeneousArguments: Parameters<HeterogeneousRest> = [
  1 as int32,
  "label",
  true,
  false,
];

function choose<C extends string>(value: C, fallback: NoInfer<C>): C {
  void fallback;
  return value;
}
const chosen: "red" = choose("red", "red");

interface Thenable<T> { then(onfulfilled: (value: T) => void): void; }
const nullableAwaited: Awaited<Thenable<null>> = null;

export function retainSourceChecks(): void {
  void callableArguments;
  void callableResult;
  void constructorArguments;
  void constructed;
  void selectedReceiver;
  void detached;
  void implicitReceiver;
  void heterogeneousArguments;
  void chosen;
  void nullableAwaited;
}
`;

const shadowUtilityDeclarations = `
import type { int32 } from "@tsonic/core/types.js";

export type Partial<T> = string;
export type Parameters<T> = [string];
export type ReturnType<T> = boolean;
export type OmitThisParameter<T> = int32;
`;
