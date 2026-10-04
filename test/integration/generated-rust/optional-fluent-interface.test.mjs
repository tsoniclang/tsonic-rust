import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustSourceCallableReturnFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustSourceTypeCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const files = { "index.ts": `
export class Route<Value> {
  readonly value: Value;
  constructor(value: Value) { this.value = value; }
}
export interface RoutingHost<Value> {
  all(path: string, ...handlers: ((value: Value) => void)[]): this;
  head?(path: string, ...handlers: ((value: Value) => void)[]): this;
  options?(path: string, ...handlers: ((value: Value) => void)[]): this;
  use(path: string, ...handlers: ((value: Value) => void)[]): this;
  use(...handlers: ((value: Value) => void)[]): this;
  param(name: string, callback: (value: Value) => void): this;
  param(names: string[], callback: (value: Value) => void): this;
  choose(other: this): this;
  route(value: Value): Route<Value>;
}
export function main(): void {}
` };

for (const surface of ["native", "js"]) {
  const options = { surfaces: surface === "js" ? ["js"] : [],
    target: { id: "rust", options: { outputType: "bin" } }, files };

  test(`optional fluent interface facts retain nominal self, generic results and overload slots (${surface})`, () => {
    const { program } = analyzeRust(options);
    const definition = program.projectTypes.definitions.find(candidate => candidate.sourceName === "RoutingHost");
    assert.equal(definition !== undefined, true, "RoutingHost definition");
    assert.equal(program.projectTypes.isPolymorphic(definition), true);
    const ast = program.source.ast;
    const expected = program.projectTypes.openCarrier(definition);
    const selfSlots = [];
    let optionalCount = 0;
    for (const member of ast.members(definition.declaration)) {
      assert.equal(member !== undefined, true, "RoutingHost member");
      const name = ast.text(ast.name(member));
      const returnCarrier = program.facts.getFact(member, rustSourceCallableReturnFactKey)?.returnCarrier;
      assert.equal(returnCarrier !== undefined, true, `${name}: finalized return carrier`);
      if (name === "route") {
        const selected = rustSourceTypeCarrierValue(returnCarrier);
        assert.equal(selected?.typeName, "Route");
        assert.equal(selected?.genericArguments.length, 1);
        assert.equal(rustTargetTypeRefEquals(selected.genericArguments[0].type,
          rustSourceTypeCarrierValue(expected).genericArguments[0].type), true);
      } else {
        assert.equal(rustTargetTypeRefEquals(returnCarrier, expected), true, `${name}: finite self carrier`);
        const slots = program.projectMethodDispatch.variantsForMember(member).map(variant => variant.virtualSlot);
        assert.equal(slots.length, 1, `${name}: exact overload variant`);
        selfSlots.push(...slots);
      }
      if (ast.questionToken(member) !== undefined) optionalCount++;
    }
    assert.equal(optionalCount, 2);
    assert.equal(selfSlots.length, 8);
    assert.equal(new Set(selfSlots).size, selfSlots.length);
  });

  test(`optional fluent exported interface emits a valid native dispatch trait (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust(options);
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\\n"));
    const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.equal(/trait RoutingHostDispatch<Value: 'static \+ Clone>/u.test(source), true, "exact native dispatch bounds");
    for (const member of ["head", "options", "use_2", "param_2"]) {
      assert.equal(source.includes(`dispatch_routing_host_${member}`), true, `${member}: exact dispatch slot`);
    }
    assert.equal(/dyn Any|downcast_unchecked|transmute/u.test(source), false, "no erased native reflection");
    validateGeneratedProject(`optional-fluent-interface-${surface}`, result.artifacts, { run: true });
  });
}
