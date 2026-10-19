import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustReachability } from "../reachability/model.js";
import type { RustCallableDeclarationProducer } from "../program/records/callable-emission.js";
import { rustSourceItemIdentity } from "../program/source-package-facades.js";
import { isRustUnitCarrier } from "../../target-model/types/index.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";

export function analyzeRustCallableDeclarationEmission(input: {
  readonly program: RustTargetProgram;
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
  for (const declaration of input.nodes) {
    if (!ast.is.IsFunctionDeclaration(declaration) && !ast.is.IsFunctionExpression(declaration) && !ast.is.IsArrowFunction(declaration) &&
      !ast.is.IsMethodDeclaration(declaration) && !ast.is.IsGetAccessorDeclaration(declaration) && !ast.is.IsSetAccessorDeclaration(declaration)) continue;
    const body = ast.body(declaration);
    if (body === undefined || program.records.nativeParticipation.get(declaration) === "erased") continue;
    const sourceReturn = program.records.sourceCallableReturn.get(declaration);
    const asyncFact = program.records.asyncFunction.get(declaration);
    const generator = program.records.generator.get(declaration);
    const carrier = generator?.returnType ?? asyncFact?.outputCarrier ?? sourceReturn?.returnCarrier;
    if (sourceReturn === undefined || carrier === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted callable body requires its finalized source return and control-flow evidence.", declaration);
    const alwaysExits = ast.is.IsBlock(body) ? program.records.statementExit.get(body) : true;
    if (alwaysExits === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted callable body requires its sealed source statement exit.", body);
    const canFallThrough = !alwaysExits;
    if (!isRustUnitCarrier(carrier) && canFallThrough && sourceReturn.fallthroughUndefined !== true) {
      reject(body, generator === undefined ? "rust.backend.return-flow" : "rust.backend.generator-return-flow",
        generator === undefined ? "Value-returning functions require finalized control flow that returns or throws on every path."
          : "Value-returning generators require finalized control flow that returns on every path.");
      continue;
    }
    if (generator !== undefined && program.records.fallible.get(declaration) !== undefined) {
      reject(declaration, "rust.backend.generator-fallibility", "Throwing generator bodies require a closed Rust generator error protocol.");
      continue;
    }
    const name = program.names.functionNameForDeclaration(declaration) ?? program.names.nameForDeclaration(declaration);
    if (name === undefined) {
      if (ast.is.IsFunctionDeclaration(declaration)) failTargetAnalysisInvariant("tsonic-rust", "An admitted function declaration requires its sealed source name.", declaration);
    } else if (!isValidRustIdentifier(name)) {
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
    input.producer.declaration(declaration, { name, exported,
      visibility: lexical !== undefined ? "private" : exported || publicAbi ? "public" : "crate",
      deadCode: input.reachability.suppressedDeclarations.has(declaration) ? "authored-declaration" : undefined,
      nativeBody: program.promiseBodies.declarations.get(declaration), promiseObject: program.promiseBodies.objects.has(declaration),
      requiresSpecialization: program.sourceCallableSpecializations.requiresSpecialization(declaration),
      specializations: program.sourceCallableSpecializations.variantsForCallable(declaration),
      canFallThrough,
    });
  }
  return Object.freeze(issues);
}
