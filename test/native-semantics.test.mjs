import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeTestingPackage, acmeVectorsPackage, artifactText, compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

const counterSource = `
import type { int32 } from "@tsonic/core/types.js";

export class Counter {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  add(delta: int32): int32 {
    this.value += delta;
    return this.value;
  }

  current(): int32 {
    return this.value;
  }
}

export function drive(): int32 {
  const counter = new Counter(10);
  counter.add(5);
  return counter.current() + counter.value;
}
`;

test("classes lower to struct plus impl with fact-backed members", () => {
  const { result } = compileRust({ files: { "index.ts": counterSource } });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /#\[derive\(Clone, Copy, Debug, PartialEq\)\]\npub struct Counter \{\n    pub value: i32,\n\}/u);
  assert.match(text, /impl Counter \{/u);
  assert.match(text, /pub fn new\(value: i32\) -> Counter \{\n        Counter \{ value \}\n    \}/u);
  assert.match(text, /pub fn add\(&mut self, delta: i32\) -> i32 \{/u);
  assert.match(text, /self\.value \+= delta;/u);
  assert.match(text, /pub fn current\(&self\) -> i32 \{/u);
  assert.match(text, /let mut counter = Counter::new\(10\);/u);
  assert.match(text, /counter\.add\(5\);/u);
  assert.match(text, /counter\.current\(\) \+ counter\.value/u);
});

test("enums lower with TSTS integer discriminants and fact-backed equality", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export enum Color {
  Red,
  Green = 5,
  Blue,
}

export function pick(flag: boolean): Color {
  if (flag) {
    return Color.Green;
  }
  return Color.Blue;
}

export function isGreen(color: Color): boolean {
  return color === Color.Green;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /#\[derive\(Clone, Copy, Debug, PartialEq\)\]\npub enum Color \{\n    Red = 0,\n    Green = 5,\n    Blue = 6,\n\}/u);
  assert.match(text, /Color::Green/u);
  assert.match(text, /color == Color::Green/u);
});

test("class inheritance fails closed", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export class Base {
  constructor() {}
}

export class Derived extends Base {
  constructor() {
    super();
  }
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.message.includes("inheritance")));
});

test("generated cargo binary proves class and enum lowering at runtime", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r4_native_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
import { Counter } from "./counter.js";

export enum Mode {
  Off,
  On = 3,
}

export function pick_mode(flag: boolean): Mode {
  if (flag) {
    return Mode.On;
  }
  return Mode.Off;
}

export function main(): void {
  const counter = new Counter(10);
  check(counter.add(5) === 15);
  check(counter.current() === 15);
  check(counter.value === 15);
  const mode = pick_mode(true);
  check(mode === Mode.On);
  check(mode !== Mode.Off);
}
`,
      "counter.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Counter {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  add(delta: int32): int32 {
    this.value += delta;
    return this.value;
  }

  current(): int32 {
    return this.value;
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("native-semantics-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("flow markers erase into finalized argument modes", () => {
  const { result } = compileRust({
    packages: [acmeVectorsPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { borrow, move } from "@tsonic/core/lang.js";
import { Vector, magnitude, consume } from "@acme/vectors";

export function drive(): int32 {
  const v = new Vector(3, 4);
  const m = magnitude(borrow(v));
  return m + consume(move(v));
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /acme_vectors::magnitude\(&v\)/u);
  assert.match(text, /acme_vectors::consume\(v\)/u);
});

test("flow markers mismatching argument modes fail closed", () => {
  const { result, extensionHost } = compileRust({
    packages: [acmeVectorsPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { borrow } from "@tsonic/core/lang.js";
import { Vector, consume } from "@acme/vectors";

export function bad(): int32 {
  const v = new Vector(1, 2);
  return consume(borrow(v));
}
`,
    },
  });

  assert.ok(extensionHost.diagnostics.all().some((diagnostic) =>
    diagnostic.extensionCode === "RUST_FLOW_MARKER_MISMATCH"));
});

test("byref passing markers are rejected deterministically", () => {
  const { extensionHost } = compileRust({
    packages: [acmeVectorsPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { ref } from "@tsonic/core/lang.js";
import { Vector, consume } from "@acme/vectors";

export function bad(): int32 {
  const v = new Vector(1, 2);
  return consume(ref(v));
}
`,
    },
  });

  assert.ok(extensionHost.diagnostics.all().some((diagnostic) =>
    diagnostic.extensionCode === "RUST_SOURCE_MARKER_UNSUPPORTED"));
});
