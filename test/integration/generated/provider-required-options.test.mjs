import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { compileRust, artifactText, fixtureCratesRoot } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

function provider({ missingWrite = false, wrongAbsence = false } = {}) {
  const moduleSpecifier = "test:required-options";
  const input = { kind: "target-named", id: "native.options.Input" };
  const options = { kind: "target-named", id: "native.options.Options" };
  const unit = { kind: "tuple", elements: [] };
  const bool = { kind: "source-primitive", name: "bool" };
  const text = { kind: "target-named", id: "rust.std.String" };
  const reference = exportName => ({ kind: "provider-ref", moduleSpecifier, exportName });
  const optional = type => ({ kind: "target-named", id: "rust.std.Option", genericArguments: [{ kind: "type", type }] });
  const fields = [
    ["input", reference("Input"), input, false],
    ["label", { kind: "string" }, wrongAbsence ? text : optional(text), true],
    ["enabled", { kind: "boolean" }, optional(bool), true],
  ];
  return createRustProviderPackage({ id: "required-options", displayName: "Required native options", version: "1",
    modules: [{ moduleSpecifier, providerModuleId: "native.options", exports: [
      { id: "Input", name: "Input", kind: "interface", members: [] },
      { id: "Options", name: "Options", kind: "interface", members: fields.map(([name, type, , optional]) =>
        ({ id: `Options.${name}`, name, kind: "property", type, optional })) },
      { id: "createInput", name: "createInput", kind: "function", signatures: [{ id: "createInput.signature",
        parameters: [], returnType: reference("Input") }] },
      { id: "observe", name: "observe", kind: "function", signatures: [{ id: "observe.signature",
        parameters: [{ name: "options", type: reference("Options") }, { name: "expected", type: reference("Input") }],
        returnType: { kind: "boolean" } }] },
    ] }],
    types: [{ exportId: "Input", targetCarrier: input },
      { exportId: "Options", targetCarrier: options, objectLiteralConstruction: { kind: "struct" } }],
    carrierPaths: { [input.id]: "acme_required_options::Input", [options.id]: "acme_required_options::Options" },
    carrierTraits: { [input.id]: { implementations: [{ trait: { kind: "trait-ref", id: "core::clone::Clone", path: "core::clone::Clone", genericArguments: [], associatedConstraints: [] }, requirements: [] }] } },
    operations: [
      { exportId: "createInput", signatureId: "createInput.signature", operationKind: "method",
        target: { form: "call", path: "acme_required_options::create_input" }, parameterCarriers: [], resultCarrier: input },
      { exportId: "observe", signatureId: "observe.signature", operationKind: "method",
        target: { form: "call", path: "acme_required_options::observe", argModes: ["value", "ref"] },
        parameterCarriers: [options, input], resultCarrier: bool },
      ...fields.flatMap(([name, , carrier]) => [
        { exportId: "Options", memberId: `Options.${name}`, operationKind: "property",
          receiverCarrier: options, target: { form: "field", name }, resultCarrier: carrier },
        ...missingWrite && name === "label" ? [] : [{ exportId: "Options", memberId: `Options.${name}`, operationKind: "property-set",
          receiverCarrier: options, target: { form: "field", name }, parameterCarriers: [carrier], resultCarrier: unit }],
      ]),
    ],
    crates: [{ crateName: "acme_required_options", cargoPath: resolve(fixtureCratesRoot, "acme_required_options") }],
  });
}

const source = `
import { createInput, observe } from "test:required-options";
export function main(): void {
  const input = createInput();
  if (!observe({ input }, input)) throw new Error("literal input identity or absence changed");
  const options = { input };
  if (!observe(options, input)) throw new Error("copied input identity or absence changed");
}
`;

for (const surfaces of [[], ["js"]]) {
  test(`native required options construct and copy without Default (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [provider()],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": (source + "\nmain();\n") } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => `${row.code}: ${row.message}`).join("\n"));
    const code = artifactText(result, "src/index.rs");
    assert.doesNotMatch(code, /Default::default|unsafe|transmute/u);
    assert.match(code, /acme_required_options::Options\s*\{/u);
    assert.equal((code.match(/label:\s*Option::<String>::None/gu) ?? []).length, 2,
      `literal and structural copy retain native absence: ${code.split("\n")
        .filter(line => /\b(?:label|enabled):/u.test(line)).slice(0, 8).join("; ")}`);
    assert.equal((code.match(/enabled:\s*Option::<bool>::None/gu) ?? []).length, 2, "no aggregate Default or invented boolean is used");
    validateGeneratedProject(`required-options-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

for (const mutation of [{ missingWrite: true }, { wrongAbsence: true }]) {
  test(`required native option admission rejects incomplete or incompatible evidence (${JSON.stringify(mutation)})`, () => {
    const { result } = compileRust({ surfaces: [], packages: [provider(mutation)],
      files: { "index.ts": source } });
    assert.equal(result.diagnostics.some(row => row.category === "error"), true);
    assert.equal(result.artifacts.length, 0);
  });
}
