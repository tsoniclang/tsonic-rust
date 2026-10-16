import assert from "node:assert/strict";
import test from "node:test";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";

const surfaces = [["native", undefined], ["js", ["js"]]];
const forms = [
  ["computed numeric key in an unused alias", index => `type T${index} = { [1]: number };\nexport function f${index}(): number {\n  return 1;\n}\n`],
  ["computed string key in an unused alias", index => `type T${index} = { ["a"]: number };\nexport function f${index}(): number {\n  return 1;\n}\n`],
  ["computed const key in an unused alias",
    index => `const key${index} = "a";\ntype T${index} = { [key${index}]: number };\nexport function f${index}(): number {\n  return 1;\n}\n`],
  ["computed non-finite key in an unused alias", index => `type T${index} = { [1e400]: number };\nexport function f${index}(): number {\n  return 1;\n}\n`],
  ["computed method key in an unused alias", index => `type T${index} = { ["m"](): number };\nexport function f${index}(): number {\n  return 1;\n}\n`],
  ["computed key after a plain key in an unused alias",
    index => `type T${index} = { a: number; ["b"]: number };\nexport function f${index}(): number {\n  return 1;\n}\n`],
  ["numeric member name in an unused alias", index => `type T${index} = { 1: number };\nexport function f${index}(): number {\n  return 1;\n}\n`],
  ["string member name in an unused alias", index => `type T${index} = { "a": number };\nexport function f${index}(): number {\n  return 1;\n}\n`],
  ["computed numeric key in a parameter type", index => `export function f${index}(value: { [1]: number }): number {\n  return 1;\n}\n`],
  ["computed string key in a return type", index => `export function f${index}(): { ["a"]: number } {\n  return { a: 1 };\n}\n`],
  ["computed string key read through an alias",
    index => `type T${index} = { ["a"]: number };\nexport function f${index}(value: T${index}): number {\n  return value.a;\n}\n`],
];

function compileCapturing(source, selected) {
  try {
    return { result: compileRust({ surfaces: selected ?? [], files: { "index.ts": source } }).result };
  } catch (error) {
    return { threw: String(error?.message ?? error).split("\n")[0] };
  }
}

for (const [surface, selected] of surfaces) {
  forms.forEach(([name, body], index) => {
    test(`${surface}: a type-literal member with a ${name} is classified for reachability`, () => {
      const { result, threw } = compileCapturing(body(index), selected);
      assert.equal(threw === undefined, true, `${name}: the compilation does not throw: ${threw}`);
      assert.equal(result.diagnostics.length === 0, true,
        `${name}: no diagnostics: ${JSON.stringify(result.diagnostics.map(entry => entry.code))}`);
      assert.equal(result.artifacts.length > 0, true, `${name}: the compilation publishes its project`);
    });
  });
  test(`${surface}: every type-literal member form compiles natively in one project`, { timeout: 300_000 }, () => {
    const { result, threw } = compileCapturing(forms.map(([, body], index) => body(index)).join(""), selected);
    assert.equal(threw === undefined, true, `${surface}: the compilation does not throw: ${threw}`);
    assert.equal(result.diagnostics.length === 0, true,
      `${surface}: no diagnostics: ${JSON.stringify(result.diagnostics.map(entry => entry.code))}`);
    const projectRoot = writeGeneratedProject(`type-literal-members-${surface}`, result.artifacts.map(artifact =>
      ({ path: String(artifact.path), text: String(artifact.text) })));
    runCargo(projectRoot, ["generate-lockfile", "--offline"]);
    runCargo(projectRoot, ["fmt", "--all", "--check"]);
    runCargo(projectRoot, ["build", "--all-targets", "--locked", "--offline"]);
  });
}
