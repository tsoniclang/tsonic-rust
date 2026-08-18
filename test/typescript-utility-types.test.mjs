import assert from "node:assert/strict";
import test from "node:test";

import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("the complete pinned TypeScript utility family lowers and executes", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "typescript_utility_types" },
    },
    files: { "index.ts": utilitySource },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /patch_id/u);
  assert.match(source, /required_id/u);
  assert.match(source, /read_only_id/u);
  assert.match(source, /picked_id/u);
  assert.match(source, /omitted_label/u);
  assert.match(source, /record_total/u);
  assert.match(source, /awaited_value/u);
  assert.match(source, /call_detached/u);
  assert.match(source, /construct_pair/u);
  assert.match(source, /contextual_value/u);
  assert.match(source, /fn format\(_value: i32, suffix: String\) -> String/u);
  assert.match(source, /fn choose<T[^>]*>\(value: T, _fallback: T\) -> T/u);
  assert.match(
    source,
    /#\[allow\(dead_code, reason = "preserves the checked source contract"\)\]\n(?:pub\(crate\) )?struct Model/u,
  );
  assert.equal(
    validateGeneratedProject("typescript-utility-types", result.artifacts, { run: true }).status,
    0,
  );
});

const utilitySource = `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Model {
  id: int32;
  label: string;
  active?: boolean;
}

type ModelPatch = Partial<Model>;
type CompleteModel = Required<Model>;
type ReadOnlyModel = Readonly<CompleteModel>;
type ModelId = Pick<Model, "id">;
type ModelWithoutId = Omit<Model, "id">;
type Totals = Record<"left" | "right", int32>;

function patchId(value: ModelPatch): int32 {
  return value.id ?? (0 as int32);
}

function requiredId(value: CompleteModel): int32 {
  return value.id;
}

function readOnlyId(value: ReadOnlyModel): int32 {
  return value.id;
}

function pickedId(value: ModelId): int32 {
  return value.id;
}

function omittedLabel(value: ModelWithoutId): string {
  return value.label;
}

function recordTotal(value: Totals): int32 {
  return value.left + value.right;
}

type Selection = "left" | "right" | undefined;
type PresentSelection = NonNullable<Selection>;
type LeftSelection = Extract<PresentSelection, "left">;
type RightSelection = Exclude<PresentSelection, "left">;

function leftSelection(): LeftSelection {
  return "left";
}

function rightSelection(): RightSelection {
  return "right";
}

interface Thenable<T> {
  then(onfulfilled: (value: T) => void): void;
}

type AwaitedInt = Awaited<Thenable<int32>>;

function awaitedValue(value: AwaitedInt): int32 {
  return value;
}

function format(value: int32, suffix: string): string {
  return suffix;
}

type FormatParameters = Parameters<typeof format>;
type FormatResult = ReturnType<typeof format>;

function callFormat(values: FormatParameters): FormatResult {
  return format(values[0], values[1]);
}

class Pair {
  left: int32;
  label: string;

  constructor(left: int32, label: string) {
    this.left = left;
    this.label = label;
  }
}

type PairParameters = ConstructorParameters<typeof Pair>;
type PairInstance = InstanceType<typeof Pair>;

function constructPair(values: PairParameters): PairInstance {
  return new Pair(values[0], values[1]);
}

interface Receiver {
  value: int32;
}

type BoundIncrement = (this: Receiver, delta: int32) => int32;
type IncrementReceiver = ThisParameterType<BoundIncrement>;
type DetachedIncrement = OmitThisParameter<BoundIncrement>;
type BoundFormat = (this: Receiver, value: int32, suffix: string) => string;
type DetachedFormat = OmitThisParameter<BoundFormat>;

function receiverValue(receiver: IncrementReceiver): int32 {
  return receiver.value;
}

function callDetached(increment: DetachedIncrement): int32 {
  return increment(2 as int32);
}

function callDetachedFormat(formatter: DetachedFormat): string {
  return formatter(3 as int32, "items");
}

function choose<T>(value: T, fallback: NoInfer<T>): T {
  return value;
}

function chooseInt(value: int32): int32 {
  return choose(value, 0 as int32);
}

interface ContextualMethods {
  read(): int32;
}

type ContextualObject = Receiver & ContextualMethods &
  ThisType<Receiver & ContextualMethods>;

function contextualValue(): int32 {
  const object: ContextualObject = {
    value: 11 as int32,
    read(): int32 { return this.value; },
  };
  return object.read();
}

type Loud = Uppercase<"ready">;
type Quiet = Lowercase<"QUIET">;
type Greeting = Capitalize<"hello">;
type Subject = Uncapitalize<"World">;

function loud(): Loud { return "READY"; }
function quiet(): Quiet { return "quiet"; }
function greeting(): Greeting { return "Hello"; }
function subject(): Subject { return "world"; }

export function main(): void {
  check(patchId({ label: "patch" }) === (0 as int32));
  check(requiredId({ id: 1 as int32, label: "required", active: true }) === (1 as int32));
  check(readOnlyId({ id: 2 as int32, label: "readonly", active: false }) === (2 as int32));
  check(pickedId({ id: 3 as int32 }) === (3 as int32));
  check(omittedLabel({ label: "omitted", active: true }) === "omitted");
  check(recordTotal({ left: 4 as int32, right: 5 as int32 }) === (9 as int32));
  check(leftSelection() === "left");
  check(rightSelection() === "right");
  check(awaitedValue(6 as int32) === (6 as int32));
  check(callFormat([7 as int32, "formatted"]) === "formatted");
  const pair = constructPair([8 as int32, "pair"]);
  check(pair.left === (8 as int32) && pair.label === "pair");
  check(receiverValue({ value: 9 as int32 }) === (9 as int32));
  check(callDetached((delta: int32): int32 => delta + (1 as int32)) === (3 as int32));
  check(callDetachedFormat((_value: int32, suffix: string): string => suffix) === "items");
  check(chooseInt(10 as int32) === (10 as int32));
  check(contextualValue() === (11 as int32));
  check(loud() === "READY");
  check(quiet() === "quiet");
  check(greeting() === "Hello");
  check(subject() === "world");
}
`;
