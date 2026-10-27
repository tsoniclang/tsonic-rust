import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustReachability } from "../../../target-model/records/program/reachability.js";
import type { RustCallableDeclarationProducer } from "../../program/records/callables/callable-emission.js";
import { rustSourceItemIdentity } from "../../../target-model/names/source-output-identities.js";
import { isRustUnitCarrier } from "../../../target-model/types/index.js";
import { isValidRustIdentifier } from "../../../target-model/names/identifiers.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustUnitTargetType } from "../../../target-model/types/index.js";
import { rustNodeIsOutsideNativeCode } from "../../control-flow/compile-time-statements.js";
import { type TargetSourceProgram } from "@tsonic/target-api/source";
import { createRustSourceCallableContract } from "../calls/source-callable-abi.js";
import type { RustCallableEntryConstruction } from "./entry-parameters.js";

export function analyzeRustCallableDeclarationEmission(input: {
  readonly callableEntries: Pick<RustCallableEntryConstruction, "get">;
  readonly program: Omit<RustAnalysisProgram, "reachability">;
  readonly source: TargetSourceProgram;
  readonly nodes: readonly Node[];
  readonly reachability: RustReachability;
  readonly producer: RustCallableDeclarationProducer;
}): readonly TargetDiagnostic[] {
  const { program } = input;
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  const reject = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_UNSUPPORTED_AST", source: "tsonic-rust", category: "error", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  const insideCompileTimeSource = (node: Node): boolean => rustNodeIsOutsideNativeCode(ast, program.records,
    expression => program.safetyApplications.operationForExpression(expression), node);
  // A module const callable is liveness-tracked through its variable declaration.
  const moduleBindingSuppressed = (declaration: Node): boolean => {
    const binding = ast.parent(declaration);
    return binding !== undefined && program.records.moduleBinding.get(binding)?.storage === "native-callable" &&
      input.reachability.suppressedDeclarations.has(binding);
  };
  for (const declaration of input.nodes) {
    if (!ast.is.IsFunctionDeclaration(declaration) && !ast.is.IsFunctionExpression(declaration) && !ast.is.IsArrowFunction(declaration) &&
      !ast.is.IsMethodDeclaration(declaration) && !ast.is.IsGetAccessorDeclaration(declaration) && !ast.is.IsSetAccessorDeclaration(declaration)) continue;
    const body = ast.body(declaration);
    if (body === undefined || program.records.nativeParticipation.get(declaration) === "erased" ||
      program.records.nativeUnreachable.get(declaration) === true || program.records.compileTimeSource.get(declaration) !== undefined ||
      insideCompileTimeSource(declaration)) continue;
    const sourceReturn = program.records.sourceCallableReturn.get(declaration);
    const asyncFact = program.records.asyncFunction.get(declaration);
    const generator = program.records.generator.get(declaration);
    const carrier = generator?.returnType ?? asyncFact?.outputCarrier ?? sourceReturn?.returnCarrier;
    if (sourceReturn === undefined || carrier === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted callable body requires its finalized source return and control-flow evidence.", declaration);
    const alwaysExits = ast.is.IsBlock(body) ? program.records.statementExit.get(body) : true;
    if (alwaysExits === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted callable body requires its sealed source statement exit.", body);
    const canFallThrough = !alwaysExits;
    const method = ast.is.IsMethodDeclaration(declaration) || ast.is.IsGetAccessorDeclaration(declaration) || ast.is.IsSetAccessorDeclaration(declaration);
    if (!isRustUnitCarrier(carrier) && canFallThrough && sourceReturn.fallthroughUndefined !== true) {
      reject(body, generator === undefined ? "rust.backend.return-flow" : "rust.backend.generator-return-flow",
        generator === undefined ? method ? "Value-returning methods require finalized control flow that returns or throws on every path."
          : "Value-returning functions require finalized control flow that returns or throws on every path."
          : method ? "Value-returning generator methods require finalized control flow that returns on every path."
          : "Value-returning generators require finalized control flow that returns on every path.");
      continue;
    }
    if (generator !== undefined && program.records.fallible.get(declaration) !== undefined) {
      reject(declaration, "rust.backend.generator-fallibility", method ? "Throwing generator method bodies require a closed Rust generator error protocol."
        : "Throwing generator bodies require a closed Rust generator error protocol.");
      continue;
    }
    const name = method ? program.projectTypes.callableTargetName(declaration)
      : program.names.functionNameForDeclaration(declaration) ?? program.names.nameForDeclaration(declaration);
    if (name === undefined) {
      if (ast.is.IsFunctionDeclaration(declaration)) failTargetAnalysisInvariant("tsonic-rust", "An admitted function declaration requires its sealed source name.", declaration);
    } else if (!method && !isValidRustIdentifier(name)) {
      reject(declaration, "rust.backend.function", `Function name '${name}' is not a valid Rust identifier.`);
      continue;
    }
    const file = ast.getSourceFile(declaration);
    const fileName = file === undefined ? undefined : ast.getFileName(file);
    const component = fileName === undefined ? undefined : program.sourcePackageComponents.componentForFile(fileName);
    const exported = ast.hasModifierKind(declaration, "export");
    const publicAbi = component !== undefined && (component.publishesImplementationAbi || name !== undefined && fileName !== undefined &&
      program.sourcePackageFacades.publicImplementationItemIdentitiesForComponent(component.componentId).includes(rustSourceItemIdentity(fileName, name)));
    const lexical = program.records.lexicalFunction.get(declaration);
    const nativeBody = program.promiseBodies.declarations.get(declaration);
    const objectPromise = asyncFact?.kind === "js-promise" && nativeBody === undefined;
    const resultCarrier = objectPromise ? program.records.callableReturn.get(declaration)?.invocation
      : isRustUnitCarrier(carrier) ? rustUnitTargetType() : program.records.callableReturn.get(declaration)?.outward;
    if (resultCarrier === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted callable requires its selected physical native result.", declaration);
    const leading = input.callableEntries.get(declaration);
    if (leading === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted callable requires its exact leading parameter ABI.", declaration);
    const parameterCarriers: TargetTypeRef[] = [...leading.parameters.map(parameter => parameter.carrier)];
    const contract = createRustSourceCallableContract({ source: input.source, records: program.records,
      sourceLifetimes: program.sourceLifetimes }, declaration, resultCarrier);
    if (contract === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted callable requires its exact checked native callable contract.", declaration);
    for (const parameter of contract.parameters) {
      const selected = program.records.callableParameter.get(parameter);
      if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted callable requires its complete native formal parameter ABI.", parameter);
      parameterCarriers.push(selected.carrier);
    }
    parameterCarriers.push(...(lexical?.captures.map(capture => capture.parameterCarrier) ?? []));
    const error = program.records.nativeErrorRegion.get(declaration);
    if (error === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted callable requires its selected native error region.", declaration);
    input.producer.declaration(declaration, { name, exported,
      visibility: lexical !== undefined ? "private" : publicAbi ? "public" : "crate",
      deadCode: input.reachability.suppressedDeclarations.has(declaration) || moduleBindingSuppressed(declaration)
        ? "authored-declaration" : undefined,
      promiseObjectDeadCode: program.promiseBodies.objects.has(declaration) && !input.reachability.usedPromiseObjects.has(declaration)
        ? "authored-declaration" : undefined,
      nativeBody, promiseObject: program.promiseBodies.objects.has(declaration),
      requiresSpecialization: program.sourceCallableSpecializations.requiresSpecialization(declaration),
      specializations: program.sourceCallableSpecializations.variantsForCallable(declaration),
      canFallThrough,
      contract, parameterCarriers: Object.freeze(parameterCarriers), resultCarrier,
      nativeAsync: generator === undefined && (asyncFact?.kind === "native-future" || nativeBody !== undefined && asyncFact?.kind === "js-promise" && asyncFact.lowering.kind === "factory"),
      resultWrapped: generator === undefined && !objectPromise && error.kind !== "infallible",
    });
  }
  return Object.freeze(issues);
}
