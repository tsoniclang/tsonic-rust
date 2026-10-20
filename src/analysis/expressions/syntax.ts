import type { Node } from "@tsonic/tsts";
import { Node_Expression, sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustExpressionSyntaxProducer } from "../program/records/expression-syntax.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustAbsenceCarrier, rustOptionElementCarrier, getRustGeneratorProtocol } from "../../target-model/types/index.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";
import { sourceCharCodeUnit } from "../../target-model/syntax/literals.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";

export function analyzeRustExpressionSyntax(program: Omit<RustTargetProgram, "reachability">, nodes: readonly Node[],
  producer: RustExpressionSyntaxProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  const refuse = (node: Node, capability: string, message: string, unsupported = false): void => {
    issues.push({ code: unsupported ? "RUST_UNSUPPORTED_AST" : "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
    const fact = program.records.targetOperation.get(node);
    const carrier = program.records.valueRead.get(node)?.source;
    const binding = program.records.sourceBinding.get(node);
    const kind = ast.kindName(node);
    if (kind === "KindStringLiteral" || kind === "KindNoSubstitutionTemplateLiteral") {
      if (fact?.kind === "source-enum-member") continue;
      if (carrier?.kind === "source-primitive" && carrier.name === "char") {
        const value = sourceCharCodeUnit(ast.text(node));
        if (value === undefined) refuse(node, "rust.backend.char-literal", "Neutral char lowering requires one exact UTF-16 code unit.");
        else producer.publish(node, { kind: "char", value });
      } else producer.publish(node, { kind: "string", value: ast.text(node) });
    }
    if (kind === "KindNullKeyword" || kind === "KindIdentifier" && (fact?.kind === "option-none" || binding === undefined && isRustAbsenceCarrier(carrier))) {
      if (carrier === undefined || fact?.kind !== "option-none" && !isRustAbsenceCarrier(carrier))
        refuse(node, "rust.backend.nullish", "null literals require an exact native absence carrier or finalized Option lane fact.");
      else producer.publish(node, { kind: "absence", carrier });
    }
    if (kind === "KindIdentifier" && binding !== undefined && program.records.sourceCallableValue.get(node) === undefined && program.records.classValue.get(node) === undefined) {
      if (ast.kindName(binding.sourceDeclaration) === "KindClassDeclaration")
        refuse(node, "rust.backend.class-value", "Class constructor used as a value has no exact finalized constructor-object view.", true);
      else {
        const name = program.names.nameForDeclaration(binding.sourceDeclaration);
        if (name === undefined || !isValidRustIdentifier(name))
          refuse(node, "rust.backend.identifier", `Identifier '${ast.text(node)}' does not lower to a valid Rust identifier.`, true);
      }
    }
    if (kind === "KindNonNullExpression") {
      const inner = Node_Expression(ast, node);
      const source = inner === undefined ? undefined : program.records.valueRead.get(inner)?.value;
      if (fact?.kind !== "non-null-expression" || source === undefined || !rustTargetTypeRefEquals(source, fact.sourceCarrier)) {
        refuse(node, "rust.backend.non-null-expression", "Non-null syntax requires one exact finalized source and result carrier."); continue;
      }
      const identity = rustTargetTypeRefEquals(fact.sourceCarrier, fact.resultCarrier);
      if (!identity && !rustTargetTypeRefEquals(rustOptionElementCarrier(fact.sourceCarrier), fact.resultCarrier)) {
        refuse(node, "rust.backend.non-null-option", "Non-null syntax can remove only the exact nullish lane from its finalized source carrier."); continue;
      }
      producer.publish(node, { kind: "non-null", source: fact.sourceCarrier, operation: identity ? "identity"
        : rustOptionalStorageValue(fact.sourceCarrier) === undefined ? "unwrap" : "custom" });
    }
    if (kind === "KindYieldExpression") {
      const selected = program.records.yield.get(node);
      const owner = sourceEnclosingCallable(node, ast);
      const generator = owner === undefined ? undefined : program.records.generator.get(owner);
      if (selected === undefined || owner === undefined || generator === undefined || selected.generatorDeclaration !== owner ||
        !rustTargetTypeRefEquals(selected.yieldType, generator.yieldType) ||
        selected.kind === "value" && !rustTargetTypeRefEquals(selected.resultType, generator.nextType)) {
        refuse(node, "rust.backend.generator-yield", "Yield expressions require an exact finalized fact owned by the active generator."); continue;
      }
      const operand = Node_Expression(ast, node);
      const delegated = selected.kind === "delegate" ? getRustGeneratorProtocol(selected.delegatedCarrier) : undefined;
      if (selected.kind === "delegate" && (delegated === undefined || operand === undefined ||
        !rustTargetTypeRefEquals(delegated.yieldType, generator.yieldType) || !rustTargetTypeRefEquals(delegated.nextType, generator.nextType) ||
        !rustTargetTypeRefEquals(delegated.returnType, selected.resultType) || !rustTargetTypeRefEquals(delegated.returnType, generator.returnType) ||
        generator.kind === "sync" && delegated.kind !== "sync")) {
        refuse(node, "rust.backend.generator-delegation", "Delegated yield requires one compatible finalized Rust generator protocol."); continue;
      }
      producer.publish(node, { kind: "yield", declaration: owner, operand,
        delegated: delegated === undefined ? undefined : Object.freeze({ next: delegated.nextType, result: delegated.returnType }), method: selected.kind !== "delegate" ? "yield_value"
        : delegated!.kind === "sync" ? "yield_from" : "yield_from_async" });
    }
  }
  return Object.freeze(issues);
}
