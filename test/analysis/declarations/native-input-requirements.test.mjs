import assert from "node:assert/strict";
import test from "node:test";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustContextualRuntimeConversionContract } from "../../../dist/policy/conversions/contextual.js";

function checked(text, surfaces) {
  const { program } = analyzeRust({ surfaces, files: { "index.ts": text } });
  const ast = program.source.ast;
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts")).forEach(visit);
  const declaration = name => {
    const selected = nodes.find(node => ast.is.IsFunctionDeclaration(node) &&
      ast.name(node) !== undefined && ast.text(ast.name(node)) === name);
    assert.equal(selected !== undefined, true, `${name}: original checked declaration exists`);
    return selected;
  };
  return { program, ast, nodes, declaration };
}

function inputRequirements(current, declaration) {
  const inputs = current.program.callableValues.native.inputsFor(declaration);
  assert.equal(inputs.length, 1, "exactly the authored callable input has a native implementation parameter");
  const input = inputs[0];
  assert.equal(input.subject.node === current.ast.parameters(declaration)[0], true,
    "the native implementation retains the original value-parameter node");
  return { input, requirements: nativeRequirementSets(current, declaration, input) };
}

function nativeRequirementSets(current, declaration, input) {
  const header = current.program.records.nativeGenerics.get(declaration);
  assert.equal(header !== undefined, true, "the original declaration has its completed native generic header");
  const contracts = [
    current.program.declarationGenericRequirements.contractFor(declaration),
    current.program.declarationGenericRequirements.contractFor(declaration, true),
    header.sourceRequirements,
    header.bodyRequirements,
  ];
  return contracts.map((contract, index) => {
    assert.equal(contract !== undefined, true, `${index}: source/body/header contract is published`);
    const parameter = contract.nativeInputs.find(candidate => candidate.identity === input.implementation.identity);
    assert.equal(parameter !== undefined, true, `${index}: the exact native implementation identity is retained`);
    return parameter.requirements;
  });
}

const forwarded = [
  ["transitive", "function send<Value>(done: (value: Value) => void, value: Value): void { done(value); } function forward<Value>(done: (value: Value) => void, value: Value): void { send(done, value); }", "forward(done, value)"],
  ["recursive", "function send<Value>(done: (value: Value) => void, value: Value, depth: number): void { if (depth > 0) send(done, value, depth - 1); else done(value); }", "send(done, value, 1)"],
];

for (const [label, body, inputCount] of [
  ["unknown native callback", "export function invoke(callbacks: Callback[], next: () => number): number { return callbacks[0](next()); }", 2],
  ["selected source call", "function next(): number { return 1; } export function invoke(callbacks: Callback[]): number { return callbacks[0](next()); }", 1],
]) {
  test(`indexed callable snapshots retain their original physical Clone requirement across ${label}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ files: { "index.ts": `interface Callback { (value: number): number; }\n${body}` } });
    assert.equal(result.diagnostics.length, 0, "the original checked native program remains admitted");
    const program = result.program;
    assert.equal(program !== undefined, true, "the actual native ownership and requirement catalogs are published");
    const { ast } = program.source;
    const nodes = [];
    const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
    program.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts")).forEach(visit);
    const owner = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "invoke");
    assert.equal(owner !== undefined, true, "the original native invocation owner is retained");
    const inputs = program.callableValues.native.inputsFor(owner);
    assert.equal(inputs.length, inputCount, "the complete original native input inventory is unchanged");
    const input = inputs.find(candidate => candidate.subject.node === ast.parameters(owner)[0] &&
      candidate.subject.projection[0]?.kind === "array-element");
    assert.equal(input !== undefined, true, "the exact original array component owns the native implementation");
    const element = nodes.find(node => ast.is.IsElementAccessExpression(node) && ast.is.IsCallExpression(ast.parent(node)));
    assert.equal(element !== undefined, true, "the original indexed callee is retained");
    const invocation = ast.parent(element);
    const argument = ast.arguments(invocation)[0];
    assert.equal(program.callableValues.native.callFor(invocation)?.input === input, true,
      "the invocation names precisely the original projected implementation");
    const read = program.ownership.reads.get(element);
    assert.equal(read?.value.kind, "clone", "the canonical ownership owner selects a pre-argument snapshot");
    assert.equal(read?.source.kind, "clone", "the snapshot retains the original source value");
    assert.equal(read?.borrowedAcross.has(argument), false, "no safe borrow across the original call is fabricated");
    for (const [index, requirements] of nativeRequirementSets({ program }, owner, input).entries()) {
      assert.equal(requirements.includes("clone"), true,
        `${index}: the actual physical implementation carries its required snapshot bound`);
    }
    for (const other of inputs.filter(candidate => candidate !== input)) {
      for (const [index, requirements] of nativeRequirementSets({ program }, owner, other).entries()) {
        assert.equal(requirements.includes("clone"), false,
          `${index}: another same-call input receives no blanket Clone requirement`);
      }
    }
    const project = writeGeneratedProject(`indexed-callable-snapshot-${label.replaceAll(" ", "-")}`, result.artifacts);
    runCargo(project, ["generate-lockfile", "--offline"]);
    runCargo(project, ["fmt", "--check"]);
    runCargo(project, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  });
}

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  for (const [name, helpers, invocation] of forwarded) {
    test(`native input Clone follows the original ${name} body read in ${surface}`, () => {
      const current = checked(`${helpers}
export function make<Value>(done: (value: Value) => void, value: Value): () => void {
  return () => { ${invocation}; };
}`, surfaces);
      const make = current.declaration("make");
      const { input, requirements } = inputRequirements(current, make);
      for (const [index, required] of requirements.entries()) {
        assert.equal(required.includes("clone"), true, `${index}: body cloning requires Clone on the native implementation`);
      }
      const arrow = current.nodes.find(node => current.ast.is.IsArrowFunction(node) &&
        sourceEnclosingCallable(current.ast.parent(node), current.ast) === make);
      assert.equal(arrow !== undefined, true, "the original returned closure is present");
      const nested = current.program.declarationGenericRequirements.contractFor(arrow);
      assert.equal(nested !== undefined && nested.nativeInputs.some(parameter =>
        parameter.identity === input.implementation.identity && parameter.requirements.includes("clone")), true,
      "the nested body's native obligation propagates through the existing callable contract");
      const capture = current.program.records.captureOwnership.get(arrow)?.find(row => row.declaration === input.subject.node);
      assert.equal(capture !== undefined && capture.read.kind === "move" && capture.invocation.kind === "move", true,
        "capturing the input still moves it; only the actual repeated body read requires Clone");
      const argument = current.nodes.find(node => current.ast.is.IsIdentifier(node) && current.ast.text(node) === "done" &&
        current.ast.is.IsCallExpression(current.ast.parent(node)) && sourceEnclosingCallable(node, current.ast) === arrow &&
        current.ast.arguments(current.ast.parent(node)).includes(node));
      assert.equal(argument !== undefined, true, "the source-call argument is the original body node");
      const physical = current.program.callableValues.nativeStorage.operandFor(argument);
      assert.equal(physical.kind === "selected" && physical.carrier.kind === "type-parameter" &&
        physical.carrier.identity === input.implementation.identity, true,
      "the clone obligation names the selected stored native implementation, not its logical Callable type");
      const read = current.program.ownership.reads.get(argument);
      assert.equal(read?.source.kind === "clone" && read.value.kind === "clone", true,
        "the actual body read is a clone independently of construction ownership");
    });
  }

  test(`a source-call borrow conversion adds no native input Clone bound in ${surface}`, () => {
    const current = checked(`function send<Value>(done: (value: Value) => void, value: Value): void { done(value); }
export function make<Value>(done: (value: Value) => void, value: Value): () => void {
  return () => { send(done, value); };
}`, surfaces);
    const make = current.declaration("make");
    const { input, requirements } = inputRequirements(current, make);
    for (const [index, required] of requirements.entries()) {
      assert.equal(required.includes("clone"), false, `${index}: the selected borrowed conversion does not clone its native input`);
    }
    const arrow = current.nodes.find(node => current.ast.is.IsArrowFunction(node) &&
      sourceEnclosingCallable(current.ast.parent(node), current.ast) === make);
    assert.equal(arrow !== undefined, true, "the identical original returned closure is present");
    const nested = current.program.declarationGenericRequirements.contractFor(arrow);
    assert.equal(nested !== undefined && nested.nativeInputs.some(parameter =>
      parameter.identity === input.implementation.identity && !parameter.requirements.includes("clone")), true,
    "the nested and enclosing contracts retain the same native identity without a gratuitous Clone bound");
    const capture = current.program.records.captureOwnership.get(arrow)?.find(row => row.declaration === input.subject.node);
    assert.equal(capture !== undefined && capture.read.kind === "move" && capture.invocation.kind === "move", true,
      "construction and invocation capture ownership remain moves");
    const argument = current.nodes.find(node => current.ast.is.IsIdentifier(node) && current.ast.text(node) === "done" &&
      current.ast.is.IsCallExpression(current.ast.parent(node)) && sourceEnclosingCallable(node, current.ast) === arrow &&
      current.ast.arguments(current.ast.parent(node)).includes(node));
    assert.equal(argument !== undefined, true, "the original source-call argument is retained");
    const conversion = current.program.records.contextualValueConversion.get(argument)?.conversion;
    assert.equal(conversion?.kind, "callable-input", "the admitted conversion is the actual native callable input view");
    assert.equal(rustContextualRuntimeConversionContract(conversion, current.program.typeDefinitions)?.sourceMode, "ref",
      "the canonical conversion contract borrows its original source");
    const read = current.program.ownership.reads.get(argument);
    assert.equal(read?.source.kind === "borrow" && read.value.kind === "clone", true,
      "the source borrow is distinct from ownership of the converted logical value");
  });

  test(`borrowed invocation does not impose Clone on its native implementation in ${surface}`, () => {
    const current = checked("export function invoke<Value>(done: (value: Value) => void, value: Value): void { done(value); }", surfaces);
    const declaration = current.declaration("invoke");
    const { input, requirements } = inputRequirements(current, declaration);
    const physical = current.program.callableValues.nativeStorage.parameterFor(input.subject.node);
    assert.equal(physical.kind === "selected" && physical.carrier.kind === "reference" &&
      physical.carrier.mutable === false && physical.carrier.referent === input.implementation, true,
    "the real native input is an immutable reference to the original implementation");
    for (const [index, required] of requirements.entries()) {
      assert.equal(required.includes("clone"), false, `${index}: a non-Clone native implementation remains admissible`);
    }
  });

  test(`an owned native input can be returned by move without a Clone bound in ${surface}`, () => {
    const current = checked("export function transfer<Value>(done: (value: Value) => void): (value: Value) => void { return done; }", surfaces);
    const declaration = current.declaration("transfer");
    const { requirements } = inputRequirements(current, declaration);
    for (const [index, required] of requirements.entries()) {
      assert.equal(required.includes("clone"), false, `${index}: moving the input never adds a Clone obligation`);
    }
    const returned = current.nodes.find(node => current.ast.is.IsIdentifier(node) && current.ast.text(node) === "done" &&
      current.ast.is.IsReturnStatement(current.ast.parent(node)));
    assert.equal(returned !== undefined && current.program.ownership.reads.get(returned)?.value.kind === "move", true,
      "the original return reads the actual input by move");
  });

  test(`Copy source-call arguments retain no clone obligation in ${surface}`, () => {
    const current = checked(`import type { int32 } from "@tsonic/core/types.js";
function send(value: int32): int32 { return value; }
export function twice(value: int32): int32 { send(value); return value; }`, surfaces);
    const declaration = current.declaration("twice");
    const contract = current.program.declarationGenericRequirements.contractFor(declaration);
    assert.equal(contract !== undefined && contract.nativeInputs.length === 0, true,
      "a concrete Copy value introduces no native implementation parameter");
    const argument = current.nodes.find(node => current.ast.is.IsIdentifier(node) && current.ast.text(node) === "value" &&
      current.ast.is.IsCallExpression(current.ast.parent(node)) && sourceEnclosingCallable(node, current.ast) === declaration);
    assert.equal(argument !== undefined, true, "the original Copy argument is present");
    assert.equal(contract.uses.some(use => use.node === argument && use.requirements.includes("clone")), false,
      "the native Copy argument does not publish a clone requirement");
    assert.equal(current.program.ownership.reads.get(argument)?.value.kind, "copy", "the native read remains Copy");
  });

  test(`projected tuple reads require Clone on each original native input in ${surface}`, () => {
    const current = checked(`interface Callback { (): number; }
export function tuple(callbacks: [Callback, Callback]): [Callback, Callback] {
  const left = callbacks[0]; const right = callbacks[1]; return callbacks;
}`, surfaces);
    const owner = current.declaration("tuple");
    const parameter = current.ast.parameters(owner)[0];
    const inputs = current.program.callableValues.native.inputsFor(owner);
    assert.equal(inputs.length, 2, "the original tuple has two distinct native implementation inputs");
    const physical = current.program.callableValues.nativeStorage.parameterFor(parameter);
    assert.equal(physical.kind === "selected" && physical.carrier.kind === "tuple", true,
      "the original parameter has its completed physical tuple carrier");
    for (const input of inputs) {
      const projection = input.subject.projection[0];
      assert.equal(input.subject.node === parameter && projection?.kind === "tuple-element", true,
        "the implementation retains its original formal and tuple projection");
      assert.equal(physical.carrier.elements[projection.index] === input.implementation, true,
        `tuple component ${projection.index}: exact selected implementation identity`);
      for (const [index, requirements] of nativeRequirementSets(current, owner, input).entries()) {
        assert.equal(requirements.includes("clone"), true,
          `${index}: tuple component ${projection.index} requires its actual native Clone bound`);
      }
    }
    const reads = current.nodes.filter(node => current.ast.is.IsElementAccessExpression(node) &&
      sourceEnclosingCallable(node, current.ast) === owner);
    assert.equal(reads.length, 2, "both original tuple reads remain in the checked program");
    for (const [index, node] of reads.entries()) {
      const read = current.program.ownership.reads.get(node);
      assert.equal(read?.source.kind === "clone" && read.value.kind === "clone", true,
        `${index}: native bounds follow actual cloned reads, not a blanket callable requirement`);
    }
  });

  test(`array input Clone follows its selected native storage in ${surface}`, () => {
    const current = checked(`interface Callback { (): number; }
export function array(callbacks: Callback[]): Callback[] {
  const item = callbacks[0]; return callbacks;
}`, surfaces);
    const owner = current.declaration("array");
    const inputs = current.program.callableValues.native.inputsFor(owner);
    assert.equal(inputs.length, surfaces.length === 0 ? 0 : 1,
      "native concrete array storage and JS generic element storage retain their actual distinct ABI");
    for (const input of inputs) {
      assert.equal(input.subject.node === current.ast.parameters(owner)[0] &&
        input.subject.projection[0]?.kind === "array-element", true,
      "the generic element retains its original array formal and projection");
      for (const [index, requirements] of nativeRequirementSets(current, owner, input).entries()) {
        assert.equal(requirements.includes("clone"), true,
          `${index}: the provider's owned element read requires Clone on the actual implementation`);
      }
    }
  });

  test(`provider Clone retains the original same-signature array input in ${surface}`, () => {
    const current = checked(`interface Callback { (): number; }
export function select(used: Callback[], untouched: Callback[]): Callback[] {
  const item = used[0]; return untouched;
}`, surfaces);
    const owner = current.declaration("select");
    const inputs = current.program.callableValues.native.inputsFor(owner);
    assert.equal(inputs.length, surfaces.length === 0 ? 0 : 2,
      "both array formals keep their selected concrete or generic native representation");
    for (const [index, input] of inputs.entries()) {
      assert.equal(input.subject.node === current.ast.parameters(owner)[index] &&
        input.subject.projection.length === 1 && input.subject.projection[0].kind === "array-element", true,
      `${index}: the native implementation belongs to its original array and element projection`);
      for (const [contract, requirements] of nativeRequirementSets(current, owner, input).entries()) {
        assert.equal(requirements.includes("clone"), index === 0,
          `${contract}: only the actually read array component requires Clone, not its equal-signature peer`);
      }
    }
  });

  test(`moving an array input adds no element Clone requirement in ${surface}`, () => {
    const current = checked(`interface Callback { (): number; }
export function move(callbacks: Callback[]): Callback[] { return callbacks; }`, surfaces);
    const owner = current.declaration("move");
    const inputs = current.program.callableValues.native.inputsFor(owner);
    assert.equal(inputs.length, surfaces.length === 0 ? 0 : 1,
      "an unread array retains its complete native element input inventory");
    for (const input of inputs) {
      for (const [contract, requirements] of nativeRequirementSets(current, owner, input).entries()) {
        assert.equal(requirements.includes("clone"), false,
          `${contract}: moving the original array never invents a Clone demand on its element`);
      }
    }
  });

  test(`indexed callable bounds retain native borrowing and JS owned reads in ${surface}`, () => {
    const current = checked(`interface Callback { (): number; }
export function invoke(callbacks: Callback[]): number { return callbacks[0](); }`, surfaces);
    const owner = current.declaration("invoke");
    const inputs = current.program.callableValues.native.inputsFor(owner);
    assert.equal(inputs.length, 1,
      "the actual invocation retains its original generic callable array component on both surfaces");
    const element = current.nodes.find(node => current.ast.is.IsElementAccessExpression(node) &&
      sourceEnclosingCallable(node, current.ast) === owner);
    assert.equal(element !== undefined, true, "the exact original indexed callable remains present");
    const invocation = current.ast.parent(element);
    assert.equal(current.program.callableValues.native.callFor(invocation)?.input === inputs[0], true,
      "the actual native invocation retains precisely its original projected input");
    const operation = current.program.records.targetOperation.get(element);
    assert.equal(operation?.kind === "provider-operation" &&
      (surfaces.length === 0 ? operation.abi.target.form === "index"
        : operation.abi.target.form === "receiver-method" && operation.abi.target.name === "get_number"), true,
    "native Index borrows its output while the selected JS array API returns an owned element");
    if (surfaces.length === 0) {
      const read = current.program.ownership.reads.get(element);
      assert.equal(read?.value.kind === "borrow" && read.value.mutable === false, true,
        "the completed native indexed invocation actually borrows its original stored output");
    }
    for (const input of inputs) {
      assert.equal(input.subject.node === current.ast.parameters(owner)[0] &&
        input.subject.projection.length === 1 && input.subject.projection[0].kind === "array-element", true,
      "the borrowed invocation retains its exact original array component");
      for (const [contract, requirements] of nativeRequirementSets(current, owner, input).entries()) {
        assert.equal(requirements.includes("clone"), surfaces.length !== 0,
          `${contract}: only the selected owned JS element read requires Clone; native borrowing does not`);
      }
    }
  });

  for (const [name, body, resultType] of [
    ["borrowed invocation", "return callbacks[0]() + callbacks[1]();", "number"],
    ["whole tuple move", "return callbacks;", "[Callback, Callback]"],
  ]) {
    test(`projected native inputs retain no Clone bound for ${name} in ${surface}`, () => {
      const current = checked(`interface Callback { (): number; }
export function retain(callbacks: [Callback, Callback]): ${resultType} { ${body} }`, surfaces);
      const owner = current.declaration("retain");
      const inputs = current.program.callableValues.native.inputsFor(owner);
      assert.equal(inputs.length, 2, "both original callable components retain distinct native inputs");
      assert.equal(inputs[0].implementation.identity !== inputs[1].implementation.identity, true,
        "the two projected native inputs are never conflated by their logical signature");
      for (const [component, input] of inputs.entries()) {
        for (const [index, requirements] of nativeRequirementSets(current, owner, input).entries()) {
          assert.equal(requirements.includes("clone"), false,
            `${index}: ${name} preserves non-Clone component ${component}`);
        }
      }
    });
  }

  for (const [name, source, projections] of [
    ["nested optional tuple move", `export function preserve(callbacks: [Callback, [Callback | undefined]]): [Callback, [Callback | undefined]] {
  return callbacks;
}`, [[0], [1, 0]]],
    ["unused tuple formal", "export function preserve(callbacks: [Callback, Callback]): number { return 1; }", [[0], [1]]],
  ]) {
    test(`aggregate native inputs are complete before ${name} in ${surface}`, () => {
      const current = checked(`interface Callback { (): number; } ${source}`, surfaces);
      const owner = current.declaration("preserve");
      const parameter = current.ast.parameters(owner)[0];
      const inputs = current.program.callableValues.native.inputsFor(owner);
      assert.equal(inputs.length, projections.length, "the full authored aggregate has its exact native component inventory");
      for (const [index, input] of inputs.entries()) {
        assert.equal(input.subject.node === parameter, true, `${index}: the original formal owns its component`);
        assert.equal(JSON.stringify(input.subject.projection.map(component =>
          component.kind === "tuple-element" ? component.index : component.kind)), JSON.stringify(projections[index]),
        `${index}: original checked component order and nested projections are retained`);
        for (const [contract, requirements] of nativeRequirementSets(current, owner, input).entries()) {
          assert.equal(requirements.includes("clone"), false,
            `${contract}: discovering component ${index} does not manufacture a Clone obligation`);
        }
      }
      assert.equal(new Set(inputs.map(input => input.implementation.identity)).size, inputs.length,
        "equal logical signatures never collapse distinct physical component identities");
    });
  }

  test(`aggregate Clone requirements retain unused component inverses in ${surface}`, () => {
    const current = checked(`interface Callback { (): number; }
export function preserve(callbacks: [Callback, Callback]): [Callback, Callback] {
  const first = callbacks[0]; const repeated = callbacks[0]; return callbacks;
}`, surfaces);
    const owner = current.declaration("preserve");
    const inputs = current.program.callableValues.native.inputsFor(owner);
    assert.equal(inputs.length, 2, "both components are published even when only one component is read");
    for (const input of inputs) {
      const projection = input.subject.projection[0];
      assert.equal(projection?.kind, "tuple-element", "the exact native input has its original tuple projection");
      for (const [contract, requirements] of nativeRequirementSets(current, owner, input).entries()) {
        assert.equal(requirements.includes("clone"), projection.index === 0,
          `${contract}: only the component actually cloned by the body requires Clone`);
      }
    }
  });
}
