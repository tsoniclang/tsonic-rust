import { rustCaughtErrorPhysicalDeclaration } from "../errors/catching-try.js";
import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression, sourceEnclosingCallable, sourceTransparentExpressionOperand, type SourceProgramNavigation } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import { rustOptionElementCarrier, rustCallableProtocol } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustLocalStorageAliasPlan } from "./local-aliases.js";
import type { RustObjectRepresentationPlan } from "../project-types/object-representation.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import type { RustNativeStoragePlan } from "../callables/storage/native-storage.js";
import type { RustLexicalFunctionQueries } from "../../target-model/records/callables/lexical-functions.js";
import type { RustLocalBindingProducer } from "../program/records/storage/local-bindings.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";
import type { RustRuntimeValueUsePlan } from "../program/runtime-value-uses.js";
import { rustBindingUseIsEmitted } from "../control-flow/binding-liveness.js";
import { rustNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { RustSafetyApplicationFactIndex } from "../safety/application-index.js";

export function analyzeRustLocalBindings(input: {
  readonly ast: AstReader; readonly nodes: readonly Node[]; readonly records: RustProgramRecords;
  readonly navigation: SourceProgramNavigation; readonly names: RustNamePlan;
  readonly aliases: RustLocalStorageAliasPlan; readonly representations: RustObjectRepresentationPlan;
  readonly projectTypes: RustProjectTypePolicy; readonly nativeStorage: Pick<RustNativeStoragePlan, "valueFor">;
  readonly lexicalFunctions: RustLexicalFunctionQueries; readonly producer: RustLocalBindingProducer;
  readonly required: RustRequiredRecord[];
  readonly runtimeValueUses: Pick<RustRuntimeValueUsePlan, "promiseCallAliasTarget">;
  readonly safetyApplications: RustSafetyApplicationFactIndex;
}): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const safetyOperation = (expression: Node) => input.safetyApplications.operationForExpression(expression);
  const refuse = (node: Node, capability: string, message: string, code = "RUST_UNSUPPORTED_AST"): void => {
    issues.push(Object.freeze({ code, category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${input.ast.kindName(node)}.`, evidence: Object.freeze([`target.capability=${capability}`]) }));
  };
  for (const node of input.nodes) {
    if (input.records.nativeParticipation.get(node) === "erased" ||
      rustNodeIsOutsideNativeCode(input.ast, input.records, safetyOperation, node)) continue;
    if (input.ast.is.IsVariableStatement(node) && input.records.variableDeclarations.get(node)?.length === 0) {
      refuse(node, "rust.backend.variable", "Variable statement has no exact variable declaration.");
    }
    if (!input.ast.is.IsVariableDeclaration(node)) continue;
    const parent = input.ast.parent(node);
    if (parent !== undefined && input.ast.is.IsCatchClause(parent)) continue;
    const statement = parent === undefined ? undefined : input.ast.parent(parent);
    if (statement !== undefined && (input.ast.is.IsForInStatement(statement) || input.ast.is.IsForOfStatement(statement))) continue;
    requireRustRecord(input.required, "localBinding", node, input.ast.kindName(node), "analyzeRustLocalBindings");
    const owner = input.aliases.owner(node);
    // An ambient declaration is type-only: it has no native value and the planner skips its statement. A Promise call
    // alias holds no value either: each of its calls is a native Promise edge of the aliased function.
    if (input.records.compileTimeSource.get(node) !== undefined || owner !== undefined && owner !== node ||
      input.records.typeOnlyDeclaration.get(node) !== undefined || input.runtimeValueUses.promiseCallAliasTarget(node) !== undefined) {
      input.producer.declaration(node, { kind: "erased" });
      continue;
    }
    const variable = input.ast.as.AsVariableDeclaration(node);
    const nameNode = variable?.name;
    const initializer = variable?.Initializer;
    const carrier = rustCaughtErrorPhysicalDeclaration(input.ast, input.records, node) ?? input.records.runtimeCarrier.get(node)?.carrier;
    if (nameNode !== undefined && (input.ast.is.IsArrayBindingPattern(nameNode) || input.ast.is.IsObjectBindingPattern(nameNode))) {
      if (initializer === undefined || carrier === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "A checked binding pattern requires its initializer and native carrier.", node);
      input.producer.declaration(node, { kind: "pattern", pattern: nameNode, initializer, carrier });
      continue;
    }
    const name = input.names.nameForDeclaration(node);
    if (nameNode === undefined || !input.ast.is.IsIdentifier(nameNode) || name === undefined || !isValidRustIdentifier(name)) {
      refuse(node, "rust.backend.variable", "Variable declarations require a plain identifier that is valid in Rust.");
      continue;
    }
    const lexical = initializer === undefined ? undefined : input.lexicalFunctions.forDeclaration(initializer);
    if (lexical?.kind === "unresolved") {
      refuse(node, "rust.backend.lexical-function", lexical.reason, "RUST_MISSING_TARGET_FACT");
      continue;
    }
    // A lexical function, or a module binding stored as a native callable (planned as a native function by
    // module-bindings.ts), is a function declaration rather than a value binding.
    if (initializer !== undefined && (lexical !== undefined || input.records.moduleBinding.get(node)?.storage === "native-callable")) {
      input.producer.declaration(node, { kind: "function", initializer, name });
      continue;
    }
    if (carrier === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted local binding requires its finalized carrier.", node);
    // The physical value destination is selected for the initializer; a declaration without one keeps its carrier.
    const physical = input.nativeStorage.valueFor(node);
    if (physical.kind === "unresolved" && initializer !== undefined) {
      refuse(node, "rust.backend.value-destination", physical.reason, "RUST_MISSING_TARGET_FACT");
      continue;
    }
    const nativeArray = input.records.nativeArrayStorage.get(node);
    const storage = nativeArray === undefined ? input.records.bindingStorage.get(node) : undefined;
    const absenceInitializer = initializer === undefined && rustOptionElementCarrier(carrier) !== undefined;
    if (initializer === undefined && !absenceInitializer && storage !== undefined) {
      refuse(node, "rust.backend.typed-location-storage", "Promoted Rust location storage requires a source initializer or a native absence carrier.");
      continue;
    }
    const summary = input.navigation.declarationUseSummary(node);
    const representation = input.representations.representationFor(input.projectTypes.definitionForCarrier(carrier));
    const liveness = input.records.bindingLiveness.get(node);
    const resource = input.records.resourceManagement.get(node);
    const ownerCallable = sourceEnclosingCallable(node, input.ast);
    const nativelyWritten = input.navigation.declarationUses(node).some(use => {
      if (!rustBindingUseIsEmitted(input.ast, input.records, use.reference, node, ownerCallable)) return false;
      if (nativeArray !== undefined) {
        let receiver = use.reference;
        let access = input.ast.parent(receiver);
        while (access !== undefined && sourceTransparentExpressionOperand(input.ast, access) === receiver) {
          receiver = access;
          access = input.ast.parent(receiver);
        }
        if (access !== undefined && Node_Expression(input.ast, access) === receiver &&
          input.records.nativeArrayStorage.get(access)?.kind === "element") return false;
      }
      const read = input.records.readOwnership.get(use.reference);
      return summary.bindingWritten && use.role === "write" || read?.readsStorage === true &&
        read.source.kind === "borrow" && read.source.mutable;
    });
    const mutable = nativeArray !== undefined ? nativelyWritten : storage?.iterationScope !== undefined || storage === undefined &&
      (input.aliases.requiresMutableOwner(node) || (initializer !== undefined || absenceInitializer ||
        liveness?.multipleWrites !== false) && nativelyWritten ||
        representation?.kind === "value" && representation.mutable && summary.memberWritten ||
        carrier.kind !== "pointer" && carrier.kind !== "reference" && input.records.mutatedReferentBinding.get(node) !== undefined ||
        resource?.disposal.target.receiverMode === "mut-ref");
    const operation = initializer === undefined ? undefined : input.records.targetOperation.get(initializer);
    input.producer.declaration(node, { kind: "value", name, initializer, carrier,
      nativeCarrier: physical.kind === "selected" ? physical.carrier : carrier,
      initializerCarrier: physical.kind === "selected" ? physical.carrier : undefined, storage, mutable,
      selfTypedInitializer: storage === undefined &&
        (operation?.kind === "closure" && rustCallableProtocol(carrier) !== undefined &&
          rustTargetTypeRefEquals(operation.resultCarrier, carrier) ||
          initializer !== undefined && variable?.Type === undefined && physical.kind === "selected" &&
          operation?.kind === "source-call" && rustTargetTypeRefEquals(operation.resultCarrier, carrier) &&
          input.records.contextualValueConversion.get(initializer) === undefined &&
          input.records.optionProjection.get(initializer) === undefined &&
          input.records.projectUpcast.get(initializer) === undefined &&
          input.records.flowReadProjection.get(initializer) === undefined),
      annotated: variable?.Type !== undefined, absenceInitializer });
  }
  return Object.freeze(issues);
}
