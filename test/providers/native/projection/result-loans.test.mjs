import assert from "node:assert/strict";
import test from "node:test";
import { projectRustNativeResultLoans, projectRustNativeExplicitReceiverResultLoans,
  projectRustNativeResultRetentionQuestion } from "../../../../dist/providers/native/projection/result-loans.js";
import { substituteRustCompilerGenericParameter } from "../../../../dist/providers/native/model/types/substitution.js";
import { isRustNativeResultLoanContract } from "../../../../dist/target-model/operations/result-loans.js";
import { rustCompilerLifetimeSemanticKey } from "../../../../dist/providers/native/model/rustdoc-types.js";
import { selectRustCompilerResultLoans } from "../../../../dist/providers/native/model/normalization/functions.js";
import { projectRustCompilerModule } from "../../../../dist/providers/native/projection/declarations.js";
import { rustCompilerProviderProtocolVersion } from "../../../../dist/providers/native/model/model.js";

const identity = itemId => ({ itemId, canonicalPath: ["loan_fixture", itemId] });
const lifetime = (itemId, name = "owner") => ({ kind: "parameter", identity: identity(itemId), name });
const native = (itemId, lifetimes = []) => ({ kind: "path", identity: identity(itemId), crateName: "loan_fixture",
  modulePath: [], name: itemId, genericArguments: lifetimes.map(value => ({ kind: "lifetime", lifetime: value })) });
const reference = (selected, target = native("Owner"), mutable = false) =>
  ({ kind: "reference", lifetime: selected, target, mutable });
const callable = (result, parameters = [], receiver, genericParameters = []) => {
  const declaration = { identity: identity("guard"), name: "guard",
    parameters: parameters.map((type, index) => ({ name: `argument${index}`, type })), result,
    genericParameters, typeRequirements: [], asynchronous: false, unsafe: false, abi: "Rust", variadic: false,
    ...(receiver === undefined ? {} : { receiver: { ...receiver,
      type: receiver.kind === "shared" || receiver.kind === "mutable" ? reference(receiver.lifetime, native("Owner"),
        receiver.kind === "mutable") : receiver.type } }) };
  const selected = selectRustCompilerResultLoans(declaration);
  return { ...declaration, resultLoans: selected.contract, resultLoanTypes: selected.types };
};

test("returned native lifetimes retain every exact receiver and formal origin", () => {
  const selected = lifetime("guard::owner");
  const result = native("Guard", [selected]);
  const contract = projectRustNativeResultLoans(callable(result, [reference(selected)],
    { kind: "shared", lifetime: selected }), result);
  assert.equal(isRustNativeResultLoanContract(contract), true, "the projected contract is closed and valid");
  assert.equal(contract.kind, "complete", "the declared correspondence is complete");
  assert.equal(contract.loans.length, 1, "one actual returned lifetime position");
  assert.equal(contract.loans[0].origins.length, 2, "correlated input alternatives are not reduced to one");
  assert.equal(contract.loans[0].origins.some(origin => origin.input.kind === "receiver"), true, "actual receiver preserved");
  assert.equal(contract.loans[0].origins.some(origin => origin.input.kind === "argument" &&
    origin.input.sourceIndex === 0), true, "actual formal position preserved");
});

test("equal displayed lifetime names do not equate distinct declared binders", () => {
  const returned = lifetime("guard::returned", "same");
  const foreign = lifetime("other::foreign", "same");
  const result = native("Guard", [returned]);
  const contract = projectRustNativeResultLoans(callable(result, [reference(foreign)]), result);
  assert.equal(contract.kind, "unavailable", "foreign declaration identity cannot establish correspondence");
  assert.equal(contract.loans.length, 0, "no fabricated borrowed input");
  assert.equal(contract.reasons.length > 0, true, "unknown is not a proven empty contract");
});

test("returned placeholder elision uses the real receiver before unrelated parameters", () => {
  const owner = lifetime("guard::owner");
  const other = lifetime("guard::other");
  const result = native("Guard", [{ kind: "placeholder" }]);
  const contract = projectRustNativeResultLoans(callable(result, [reference(other)],
    { kind: "shared", lifetime: owner }), result);
  assert.equal(contract.kind, "complete", "the native receiver elision rule applies");
  assert.equal(contract.loans[0].lifetime, rustCompilerLifetimeSemanticKey(owner), "canonical receiver lifetime retained");
  assert.equal(contract.loans[0].origins.length, 1, "unrelated argument is not made an owner");
  assert.equal(contract.loans[0].origins[0].input.kind, "receiver", "the actual receiver is selected");
});

test("anonymous lifetimes in two different input positions do not become one lifetime", () => {
  const result = native("Guard", [{ kind: "placeholder" }]);
  const contract = projectRustNativeResultLoans(callable(result,
    [reference({ kind: "placeholder" }), reference({ kind: "placeholder" })]), result);
  assert.equal(contract.kind, "unavailable", "two unrelated anonymous inputs cannot justify output elision");
  assert.equal(contract.loans.length, 0, "no pick-first anonymous origin");
});

test("an owned input carrying a lifetime does not become a borrow of its storage", () => {
  const selected = lifetime("guard::owner");
  const result = native("Guard", [selected]);
  const contract = projectRustNativeResultLoans(callable(result, [native("Input", [selected])]), result);
  assert.equal(contract.kind, "complete", "the declared carried lifetime is available");
  assert.equal(contract.loans[0].origins.length, 1, "one real carried input origin");
  assert.equal(contract.loans[0].origins[0].kind, "carried", "the input's existing loan must be propagated");
  assert.equal(contract.loans[0].origins[0].input.sourceIndex, 0, "the declared by-value formal is retained");
});

test("an owned receiver transports its actual declared lifetime without borrowing the receiver container", () => {
  const selected = lifetime("Token::owner");
  const token = native("Token", [selected]);
  const declaration = callable(token, [], { kind: "value", type: token });
  const contract = projectRustNativeResultLoans(declaration, token);
  assert.equal(contract.kind, "complete", "the normalized owned Self type retains its actual lifetime argument");
  assert.equal(contract.loans.length, 1, "one exact carried result lifetime");
  assert.equal(contract.loans[0].origins.length, 1, "one exact owned receiver origin");
  assert.equal(contract.loans[0].origins[0].kind, "carried", "moving Token does not borrow Token's storage");
  assert.equal(contract.loans[0].origins[0].input.kind, "receiver", "the ABI receiver identity is retained");
  assert.equal(contract.loans[0].origins[0].inputType === contract.resultTypeIdentity, true,
    "the actual normalized receiver and result types correspond");
});

test("native outlives relations retain every exact eligible input through transitive bounds", () => {
  const first = lifetime("view::first");
  const middle = lifetime("view::middle");
  const returned = lifetime("view::returned");
  const result = native("Guard", [returned]);
  const declaration = callable(result, [reference(first), reference(returned)], undefined, [
    { kind: "lifetime", lifetime: first, outlives: [middle] },
    { kind: "lifetime", lifetime: middle, outlives: [returned] },
    { kind: "lifetime", lifetime: returned, outlives: [] },
  ]);
  const contract = projectRustNativeResultLoans(declaration, result);
  assert.equal(contract.kind, "complete", "actual native outlives constraints establish the declared relation");
  assert.equal(contract.loans[0].origins.length, 2, "both direct and transitive eligible formal origins remain");
  assert.equal(contract.loans[0].origins[0].input.sourceIndex, 0, "the transitive formal remains exact");
  assert.equal(contract.loans[0].origins[1].input.sourceIndex, 1, "the directly equal formal remains exact");
});

test("projection reads the one normalized native relation without selecting origins again", () => {
  const selected = lifetime("guard::owner");
  const result = native("Guard", [selected]);
  const declaration = callable(result, [reference(selected)]);
  const canonical = declaration.resultLoans;
  Object.defineProperty(declaration, "parameters", { get() { throw new Error("origin selection after normalization"); } });
  assert.equal(projectRustNativeResultLoans(declaration, result) === canonical, true, "the exact normalized relation is read unchanged");
  assert.throws(() => projectRustNativeResultLoans(declaration, { ...result }), /original selected result type/u,
    "a structurally equal foreign result node cannot silently replace the original selected native type");
});

test("primitive explicit receiver projection transports every native formal without a second origin matcher", () => {
  const selected = lifetime("guard::owner");
  const result = native("Guard", [selected]);
  const declaration = callable(result, [reference(selected)], { kind: "shared", lifetime: selected });
  const contract = projectRustNativeExplicitReceiverResultLoans(declaration.resultLoans);
  assert.equal(contract.kind, declaration.resultLoans.kind, "native correspondence availability is unchanged");
  assert.equal(contract.declarationIdentity, declaration.resultLoans.declarationIdentity, "the native declaration is not changed");
  assert.equal(contract.loans[0].origins.length, 2, "both correlated native input alternatives are retained");
  for (const [index, origin] of contract.loans[0].origins.entries()) {
    const original = declaration.resultLoans.loans[0].origins[index];
    assert.equal(origin.input.kind, "argument", "the namespace adapter has only explicit source arguments");
    assert.equal(origin.input.sourceIndex, index, "the original receiver becomes zero and each formal shifts by one");
    assert.equal(origin.lifetime, original.lifetime, "native binder identity is untouched");
    assert.equal(origin.inputType, original.inputType, "the actual native formal type is untouched");
    assert.equal(origin.inputPath === original.inputPath, true, "the original native type projection is retained");
    assert.equal(Object.isFrozen(origin) && Object.isFrozen(origin.input), true, "the projected data stays immutable");
  }
  assert.equal(declaration.resultLoans.loans[0].origins[0].input.kind, "receiver", "the original normalized relation is not mutated");
});

for (const mode of ["value", "shared", "mutable", "custom", "absent", "static"]) {
  test(`primitive native projection preserves ${mode} receiver and argument correspondence exactly once`, () => {
    const selected = lifetime("primitive::owner");
    const scalar = { kind: "primitive", name: "i32" };
    const result = mode === "value" ? scalar : reference(mode === "static" ? { kind: "static" } : selected, scalar);
    const receiver = mode === "value" ? { kind: "value", type: scalar }
      : mode === "shared" || mode === "mutable" ? { kind: mode, lifetime: selected,
        type: reference(selected, scalar, mode === "mutable") }
      : mode === "custom" ? { kind: "custom", type: reference(selected, scalar) } : undefined;
    const declaration = { identity: identity(`primitive::${mode}`), name: `inspect_${mode}`, result,
      parameters: mode === "value" || mode === "static" ? [] : [{ name: "other", type: reference(selected, scalar) }],
      genericParameters: mode === "value" || mode === "static" ? [] : [{ kind: "lifetime", lifetime: selected, outlives: [] }],
      typeRequirements: [], asynchronous: false, unsafe: false, abi: "Rust", variadic: false,
      ...(receiver === undefined ? {} : { receiver }),
      ...(mode === "value" ? {} : { borrowedResult: { sourceType: scalar, conversion: "copy" } }) };
    const selectedLoans = selectRustCompilerResultLoans(declaration);
    declaration.resultLoans = selectedLoans.contract;
    declaration.resultLoanTypes = selectedLoans.types;
    const original = declaration.resultLoans;
    const dependency = { alias: "loan_fixture", packageId: "loan_fixture 1", packageName: "loan_fixture", packageVersion: "1",
      crateName: "loan_fixture", targetCrateName: "loan_fixture", manifestPath: "/loan_fixture/Cargo.toml",
      sourceRoot: "/loan_fixture", sourceDigest: "test", closurePackageIds: ["loan_fixture 1"], features: [] };
    const projected = projectRustCompilerModule({ protocolVersion: rustCompilerProviderProtocolVersion,
      projectDigest: "loan_fixture", dependency, modulePath: [], unsupportedExports: [], standardTypeLocations: [],
      exports: [{ id: "primitive", name: "NativeInt", kind: "primitive", canonicalPath: ["core", "primitive", "i32"],
        targetPath: ["core", "primitive", "i32"], type: scalar, methods: [declaration],
        associatedConstants: [], unsupportedMembers: [] }] },
    { providerModuleId: "loan_fixture", moduleSpecifier: "@loan_fixture/index.js" });
    assert.equal(projected.operations.length, 1, "one exact primitive method operation survives projection");
    const contract = projected.operations[0].resultLoans;
    assert.equal(contract.kind, "complete", "projection retains known declaration evidence");
    assert.equal(contract.declarationIdentity, original.declarationIdentity, "native declaration identity is unchanged");
    assert.equal(contract.resultTypeIdentity, original.resultTypeIdentity, "native result type evidence is unchanged");
    assert.equal(declaration.resultLoans === original, true, "the normalized source relation is never modified");
    if (mode === "value" || mode === "static") {
      assert.equal(contract.loans.length, 0, "value-only scalar and static native output carry no input loan");
    } else {
      assert.equal(contract.loans.length, 1, "the raw returned reference correspondence remains available");
      const expected = mode === "absent" ? 1 : 2;
      assert.equal(contract.loans[0].origins.length, expected, "every correlated native input alternative remains");
      for (const [index, origin] of contract.loans[0].origins.entries()) {
        assert.equal(origin.input.kind, "argument", "primitive namespace methods have explicit source arguments only");
        assert.equal(origin.input.sourceIndex, index, "custom and absent receivers are not shifted twice");
      }
    }
    if (mode === "shared" || mode === "mutable") {
      assert.equal(contract.loans[0].origins[0].mutable, mode === "mutable", "native receiver mutability is transported without reinterpretation");
      assert.equal(original.loans[0].origins[0].input.kind, "receiver", "the original implicit receiver stays canonical in native metadata");
    }
  });
}

test("a raw pointer does not prove a safe returned borrow", () => {
  const selected = lifetime("guard::owner");
  const result = native("Guard", [selected]);
  const contract = projectRustNativeResultLoans(callable(result,
    [{ kind: "raw-pointer", mutable: false, target: native("Owner", [selected]) }]), result);
  assert.equal(contract.kind, "unavailable", "raw pointer spelling does not grant safe reference provenance");
  assert.equal(contract.loans.length, 0, "no source-place lifetime invented from a pointer");
});

test("closed loan-free native results differ from unresolved generic results", () => {
  const scalar = { kind: "primitive", name: "f64" };
  const empty = projectRustNativeResultLoans(callable(scalar), scalar);
  assert.equal(empty.kind, "complete", "an actual scalar result has a known empty relation");
  assert.equal(empty.loans.length, 0, "no scalar input loan");
  const generic = { kind: "generic", identity: identity("guard::T"), name: "T" };
  const unresolved = projectRustNativeResultLoans(callable(generic), generic);
  assert.equal(unresolved.kind, "unavailable", "uninstantiated generic evidence is not declared loan-free");
  assert.equal(isRustNativeResultLoanContract(unresolved), true, "unavailability is explicit valid data");
});

test("native result-loan metadata rejects extra fields, duplicates and fake empty unknowns", () => {
  const selected = lifetime("guard::owner");
  const result = native("Guard", [selected]);
  const contract = projectRustNativeResultLoans(callable(result, [reference(selected)]), result);
  assert.equal(isRustNativeResultLoanContract({ ...contract, dropProven: true }), false,
    "declared lifetime correspondence cannot claim native destructor proof");
  assert.equal(isRustNativeResultLoanContract({ ...contract, loans: [...contract.loans, ...contract.loans] }), false,
    "the same returned lifetime position cannot be published twice");
  assert.equal(isRustNativeResultLoanContract({ ...contract, kind: "unavailable", reasons: [] }), false,
    "an unavailable relation requires its actual reason");
});

test("native retention questions consume the normalized formal identity without redoing elision", () => {
  const selected = lifetime("question::owner");
  const parameter = { kind: "lifetime", lifetime: selected, outlives: [] };
  const result = native("Guard", [selected]);
  const declaration = callable(result, [reference(selected)], undefined, [parameter]);
  const origin = declaration.resultLoans.loans[0].origins[0];
  const dependency = { crateName: "loan_fixture", targetCrateName: "loan_fixture" };
  Object.defineProperty(declaration, "parameters", { get() { throw new Error("second formal/elision selection"); } });
  const question = projectRustNativeResultRetentionQuestion({ id: "normalized-formal", declarationIdentity: declaration.identity.itemId,
    resultTypeIdentity: declaration.resultLoans.valueTypeIdentity, phase: "value", origin,
    application: { types: new Map(), lifetimes: new Map(), consts: new Map() }, arguments: [] },
  { declaration, dependency, publicPath: ["loan_fixture", "guard"], ownerParameters: [],
    parameters: [{ native: parameter, projected: { kind: "lifetime", sourceName: "owner", targetIdentity: "owner" } }] }, []);
  assert.equal(question.invocation.inputs[0].input === declaration.resultLoanTypes.inputs[0].input, true,
    "the canonical normalized receiver/formal token is preserved");
  assert.equal(question.origin.referent.identity.itemId, "Owner", "the actual original normalized referent is retained");
  assert.equal(question.origin.lifetime === selected, true, "the original declared lifetime identity is never chosen by spelling");
});

test("an erased target carrier cannot select the first of distinct native applications", () => {
  const selected = lifetime("question::owner");
  const lifetimeParameter = { kind: "lifetime", lifetime: selected, outlives: [] };
  const typeParameter = { kind: "type", identity: identity("question::Value"), name: "Value", requirements: [], outlives: [], maybeSized: false };
  const result = native("Guard", [selected]);
  const declaration = callable(result, [reference(selected), { kind: "generic", identity: typeParameter.identity, name: "Value" }],
    undefined, [lifetimeParameter, typeParameter]);
  const carrier = { kind: "target-named", id: "erased-native-value" };
  const projection = { declaration, dependency: { crateName: "loan_fixture", targetCrateName: "loan_fixture" },
    publicPath: ["loan_fixture", "guard"], ownerParameters: [], parameters: [
      { native: lifetimeParameter, projected: { kind: "lifetime", sourceName: "owner", targetIdentity: "owner" } },
      { native: typeParameter, projected: { kind: "type", sourceName: "Value", targetIdentity: typeParameter.identity.itemId } },
    ] };
  const request = { id: "ambiguous-native-application", declarationIdentity: declaration.identity.itemId,
    resultTypeIdentity: declaration.resultLoans.valueTypeIdentity, phase: "value", origin: declaration.resultLoans.loans[0].origins[0],
    application: { types: new Map([[typeParameter.identity.itemId, carrier]]), lifetimes: new Map(), consts: new Map() }, arguments: [] };
  const first = native("Token", [lifetime("Token::first")]);
  const second = native("Token", [lifetime("Token::second")]);
  assert.throws(() => projectRustNativeResultRetentionQuestion(request, projection,
    [{ native: first, target: carrier }, { native: second, target: carrier }]), /not an erased carrier/u,
  "structurally equal target carriers do not erase distinct native lifetime applications");
  const question = projectRustNativeResultRetentionQuestion(request, projection, [{ native: first, target: carrier }]);
  assert.equal(question.invocation.genericArguments[0].type === first, true,
    "an unambiguous actual forward native projection is transported unchanged");
});

test("native parameter environments substitute nested trait and default arguments once", () => {
  const actual = { kind: "primitive", name: "i32" };
  const parameterType = { kind: "generic", identity: identity("question::Argument"), name: "Argument" };
  const trait = { identity: identity("NativeTrait"), path: "loan_fixture::NativeTrait", genericArguments: [{ kind: "type", type: parameterType }],
    associatedConstraints: [] };
  const parameter = { kind: "type", identity: identity("question::Value"), name: "Value", maybeSized: false, outlives: [],
    requirements: [{ kind: "trait", trait }], defaultType: parameterType };
  const selected = substituteRustCompilerGenericParameter(parameter,
    { types: new Map([[parameterType.identity.itemId, actual]]), lifetimes: new Map(), consts: new Map() });
  assert.equal(selected.identity === parameter.identity, true, "the native parameter keeps its exact declaration identity");
  assert.equal(selected.requirements[0].trait.genericArguments[0].type === actual, true, "the trait consumes the actual selected argument");
  assert.equal(selected.defaultType === actual, true, "the default uses the same original application");
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.requirements), true, "the substituted parameter environment remains immutable");
});
