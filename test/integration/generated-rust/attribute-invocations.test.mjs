import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRust, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { attributePackage } from "../../helpers/rust-session/provider-attributes.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

function compile(files, outputType = "bin") {
  return compileRust({ packages: [attributePackage(), acmeTestingPackage()],
    target: { id: "rust", options: { outputType, crateName: "native_attributes" } }, files }).result;
}

test("checked attribute lambdas preserve alias identity, order and native expansion", { timeout: 300_000 }, () => {
  const result = compile({ "index.ts": `
    import { attribute } from "@tsonic/core/lang.js";
    import type { int32 } from "@tsonic/core/types.js";
    import { offset as plus } from "@acme/attributes";
    import * as attributes from "@acme/attributes";
    import { check } from "@acme/testing";
    function first(): int32 { return 4; }
    function second(): int32 { return 4; }
    const amount = 3;
    attribute<typeof first>().add(() => plus(amount));
    attribute<typeof first>().add(() => attributes.offset(2));
    export function main(): void { check(first() === 9 && second() === 4); }
  ` });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /#\[acme_attributes::offset\(3\)\][\s\S]*#\[acme_attributes::offset\(2\)\][\s\S]*fn first\(/u);
  assert.doesNotMatch(output, /attribute\(|attributes::offset\(amount\)|Callable::new/u);
  validateGeneratedProject("native-attribute-lambdas", result.artifacts, { run: true });
});

test("module attributes receive inline items and exact checked helper tuples", { timeout: 300_000 }, () => {
  const result = compile({
    "kernels.ts": `
      import { attribute } from "@tsonic/core/lang.js";
      import type { int32 } from "@tsonic/core/types.js";
      import { moduleContract, entry, launchShape, offset } from "@acme/attributes";
      export function value(): int32 { return 4; }
      attribute.module().add(() => moduleContract());
      attribute<typeof value>().add(() => entry());
      attribute<typeof value>().add(() => launchShape({ block: [256, 1, 1], domain: 1 }));
      attribute<typeof value>().add(() => offset(3));
    `,
    "index.ts": `import { check } from "@acme/testing"; import { value } from "./kernels.js";
      export function main(): void { check(value() === 7); }`,
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.artifacts.some(artifact => artifact.path === "src/kernels.rs"), false);
  const root = artifactText(result, "src/lib.rs");
  assert.match(root, /#\[acme_attributes::module_contract\][\s\S]*mod kernels \{/u);
  assert.match(root, /#\[launch_shape\(block = \(256, 1, 1\), domain = 1\)\]/u);
  validateGeneratedProject("native-module-attributes", result.artifacts, { run: true });
});

test("attribute applications fail closed for local impostors, effects, placement and missing parent", () => {
  for (const statement of [
    "attribute<typeof target>().add(() => local(1));",
    "attribute<typeof target>().add(() => offset(value()));",
    "attribute<typeof target>().add(() => entry());",
    "attribute<typeof target>().add(() => moduleContract());",
    "attribute.module().add(() => offset(1));",
    "offset(3);",
  ]) {
    const result = compile({ "index.ts": `
      import { attribute } from "@tsonic/core/lang.js";
      import type { int32 } from "@tsonic/core/types.js";
      import { offset, moduleContract, entry } from "@acme/attributes";
      function local(amount: int32): void {} function value(): int32 { return 3; }
      function target(): int32 { return 4; }
      ${statement}
      export function main(): void {}
    ` });
    assert.ok(result.diagnostics.length > 0, statement);
    assert.equal(result.artifacts.length, 0, statement);
  }
});

test("derive selection retains exact class identity without constructing an attribute at runtime", { timeout: 300_000 }, () => {
  const result = compile({ "index.ts": `
    import { attribute } from "@tsonic/core/lang.js";
    import type { int32 } from "@tsonic/core/types.js";
    import { deriveProbe } from "@acme/attributes";
    export class RecordValue { value: int32 = 1; }
    attribute<RecordValue>().add(() => deriveProbe());
    export function main(): void {}
  ` }, "lib");
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /#\[derive\(acme_attributes::Probe(?:, [A-Za-z]+)*\)\]/u);
  const root = writeGeneratedProject("native-derived-attribute", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/derive.rs"), `
#[test]
fn derive_expands_on_selected_source_type() {
    assert_eq!(native_attributes::index::RecordValue::ATTRIBUTE_PROBE, 7);
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["test", "--locked", "--offline"]);
});

test("removed flat and bare attribute factories never retain a parallel path", () => {
  for (const invocation of ["offset, 2", "offset", "factory", "async () => offset(2)", "() => { offset(2); }"]) {
    const source = `
      import { attribute } from "@tsonic/core/lang.js";
      import { offset } from "@acme/attributes";
      import type { int32 } from "@tsonic/core/types.js";
      function target(): int32 { return 4; }
      const factory = () => offset(2);
      attribute<typeof target>().add(${invocation});
      export function main(): void {}
    `;
    let result;
    try {
      result = compile({ "index.ts": source });
    } catch (error) {
      assert.match(String(error), /argument|inline|lambda|attribute|assignable/iu, invocation);
      continue;
    }
    assert.ok(result.diagnostics.length > 0, invocation);
    assert.equal(result.artifacts.length, 0, invocation);
  }
});
