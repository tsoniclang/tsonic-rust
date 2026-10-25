import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { mapRustTargetTypes } from "../../../dist/target-model/types/carriers/substitution.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const cases = [
  { name: "nested generic arguments", source: `
    type Storage<Key, Value> = { readonly key: Key; readonly value: Value };
    class Slice<Element> { constructor(readonly first: Element) {} }
    export function select<Key, Value>(read: (values: Slice<Storage<Key, Value>>) => Value,
      values: Slice<Storage<Key, Value>>): Value { return read(values); }
  ` },
  { name: "conditional associated outputs", source: `
    interface Stored<Storage> { readonly storage: Storage; }
    type StorageOf<Value> = Value extends Stored<infer Storage> ? Storage : Value;
    type Pair<Key, Value> = { readonly key: StorageOf<Key>; readonly value: StorageOf<Value> };
    class Slice<Element> { constructor(readonly first: Element) {} }
    export function project<Key, Value>(callback: (value: Slice<Pair<Key, Value>>) => StorageOf<Value>,
      value: Slice<Pair<Key, Value>>): StorageOf<Value> { return callback(value); }
  ` },
];

for (const example of cases) for (const surfaces of [[], ["js"]]) {
  test(`native protocol structural headers close ${example.name} on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": example.source } });
    const instances = program.structuralShapes.instances;
    let checked = 0;
    for (const protocol of program.callableValues.native.protocols) {
      for (const root of [...protocol.method.parameters, protocol.method.result, protocol.result]) {
        mapRustTargetTypes(root, (current, source) => {
          const shape = rustStructuralObjectCarrierValue(source);
          if (shape === undefined) return current;
          const definition = program.structuralShapes.definitionForCarrier(source);
          assert.equal(definition !== undefined, true, "the actual normalized protocol header was admitted before the structural seal");
          assert.equal(program.records.structuralShape.get(source) === definition, true, "project emission reads the same canonical declaration");
          assert.equal(program.records.typeEmission.get(source)?.structural !== undefined, true, "TYPE receives the completed native declaration");
          assert.equal(definition.fields.length, shape.fields.length, "the native template retains exact source field geometry");
          for (const [index, field] of shape.fields.entries()) {
            assert.equal(definition.fields[index]?.sourceName, field.sourceName, "the native field order is unchanged");
            assert.equal(rustTargetTypeRefEquals(definition.fields[index].carrier, field.type), true, "the native field retains exact normalized payload identity");
          }
          const missing = rustStructuralObjectTargetType(shape.ownerFileName, shape.fields.map((field, index) =>
            index === 0 ? { ...field, sourceName: "unadmittedField" } : field), shape.representation,
            shape.construction, shape.bases, shape.implementation);
          assert.equal(program.structuralShapes.definitionForCarrier(missing) === undefined, true, "a mismatched native layout is not registered after sealing");
          assert.equal(program.structuralShapes.instances === instances, true, "sealed reads cannot instantiate or mutate the definition inventory");
          assert.equal(program.structuralShapes.definitionForCarrier(source) === definition, true, "repeated sealed reads preserve declaration identity");
          checked++;
          return current;
        });
      }
    }
    assert.equal(checked > 0, true, "the real checked program exercises a nested structural protocol header");
  });
}
