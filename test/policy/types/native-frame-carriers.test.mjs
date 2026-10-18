import assert from "node:assert/strict";
import test from "node:test";
import { checkRustSession, createRustSession } from "../../helpers/rust-session.mjs";
import { rustNativeFrameCallableCarriers, rustNativeFrameDefinitionCarrier }
  from "../../../dist/policy/types/model/native-type-selection.js";
import { rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";
import { rustSourceTypeCarrier } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustFrameCallableCarrier, rustFrameCallableTargetType, rustFrameCallableValue }
  from "../../../dist/target-model/types/carriers/frame-callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const integer = Object.freeze({ kind: "source-primitive", name: "int32" });
const boolean = Object.freeze({ kind: "source-primitive", name: "bool" });
const firstParameter = Object.freeze({ kind: "type-parameter", identity: "frame:first", name: "First" });
const secondParameter = Object.freeze({ kind: "type-parameter", identity: "frame:second", name: "Second" });
const source = checkRustSession(createRustSession({ entryPoint: "frame.ts", files: {
  "frame.ts": "export class Owner<First, Second> { first!: First; second!: Second; }",
} }));
const ownerDeclaration = source.ast.statements(source.getSourceFile("/src/frame.ts"))[0];

function fixture(storage = "standalone") {
  const definition = { ownerFileName: "/src/frame.ts", targetName: "SelectedFrame",
    environmentParameters: [firstParameter, secondParameter], storage: { kind: storage },
    activation: { ownerDeclaration },
    get entries() { assert.fail("whole-definition selection must not inspect an arbitrary entry"); } };
  const owner = { kind: "class", declaration: ownerDeclaration, fileName: "/src/frame.ts", stateName: "SelectedState",
    genericParameters: [{ kind: "type" }, { kind: "type" }] };
  const instance = rustSourceTypeCarrier("/src/frame.ts", "Owner", "object",
    [{ kind: "type", type: integer }, { kind: "type", type: boolean }]);
  const context = { moduleName: "use_site", crateName: undefined,
    moduleNameByFileName: new Map([["/src/frame.ts", "frame"]]), externalCrateNameByFileName: new Map(),
    externalPublicPathFor: () => undefined,
    projectTypes: { definitionForCarrier: carrier => carrier === instance ? owner : undefined },
    objectRepresentations: { representationFor: selected => selected === owner ? { kind: "shared-mutable" } : undefined },
    classValues: { forDeclaration: () => undefined, forCarrier: () => undefined },
    additionalArgumentsFor: () => [],
    callableValues: { frames: {
      definitionFor: () => { assert.fail("whole-definition selection receives the original definition directly"); },
      entryFor: () => { assert.fail("whole-definition selection never chooses a first entry"); },
    } } };
  return { definition, owner, instance, context };
}

test("whole native frame definitions consume every exact template or actual environment argument", () => {
  const { definition, context } = fixture();
  for (const [label, environment] of [["template", [firstParameter, secondParameter]], ["actual", [integer, boolean]]]) {
    const selected = rustNativeFrameDefinitionCarrier(definition, environment, undefined, context);
    const named = rustNamedTypeCarrierValue(selected);
    assert.equal(named?.path, "crate::frame::SelectedFrame", `${label}: original selected frame owner path`);
    assert.equal(named.genericArguments.length, 2, `${label}: complete owner environment, not one entry subset`);
    for (const [index, argument] of named.genericArguments.entries())
      assert.equal(rustTargetTypeRefEquals(argument.type, environment[index]), true,
        `${label}: exact environment argument ${index}`);
  }
  for (const environment of [[], [integer], [integer, boolean, integer]])
    assert.equal(rustNativeFrameDefinitionCarrier(definition, environment, undefined, context) === undefined, true,
      `environment length ${environment.length}: incomplete or extra owner arguments are refused`);
});

test("object-backed native frame definitions require their actual original owner and full environment", () => {
  const { definition, instance, context } = fixture("object");
  const selected = rustNamedTypeCarrierValue(rustNativeFrameDefinitionCarrier(definition, [integer, boolean], instance, context));
  assert.equal(selected?.path, "rt::ObjectHandleState", "the same native owner policy selects mutable object state");
  const state = rustNamedTypeCarrierValue(selected.genericArguments[0].type);
  assert.equal(state?.path, "crate::frame::SelectedState", "the exact original class state identity is retained");
  assert.equal(state.genericArguments.length, 2, "the selected class state preserves both actual generic arguments");
  for (const [label, ownerInstance, ownerContext] of [["missing owner", undefined, context],
    ["foreign instance", integer, context],
    ["different original activation", instance, { ...context, projectTypes: { definitionForCarrier: () => ({
      kind: "class", declaration: source.getSourceFile("/src/frame.ts"),
    }) } }]])
    assert.equal(rustNativeFrameDefinitionCarrier(definition, [integer, boolean], ownerInstance, ownerContext) === undefined,
      true, `${label}: native field ownership cannot be guessed`);
});

test("entry-specific native frame projection delegates its complete environment to the same definition owner", () => {
  const { definition, context } = fixture();
  const origin = { fileName: "/src/frame.ts", declarationIdentity: "checked:activation:frame" };
  const template = rustFrameCallableTargetType([], integer, { kind: "lexical", origin }, [firstParameter, secondParameter]);
  const carrier = rustFrameCallableCarrier({ ...rustFrameCallableValue(template), environment: [boolean, integer] });
  const entry = { targetName: "SelectedEntry", environmentIndexes: [1, 0], hasIndependent: false };
  const selectedContext = { ...context, callableValues: { frames: {
    definitionFor: () => definition, entryFor: () => entry,
  } } };
  const selected = rustNativeFrameCallableCarriers(carrier, selectedContext);
  const whole = rustNativeFrameDefinitionCarrier(definition, [integer, boolean], undefined, context);
  assert.equal(selected !== undefined, true, "the exact entry mapping still produces its native root");
  assert.equal(rustTargetTypeRefEquals(selected.frame, whole), true,
    "entry and whole-definition callers share one native frame choice");
  assert.equal(rustNamedTypeCarrierValue(selected.entry)?.path, "crate::frame::SelectedEntry",
    "the original entry name remains independently selected");
});
