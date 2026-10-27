import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { Node_Expression, Node_Operand, BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import type { RustValueConversion } from "../../target-model/operations/model.js";
import { rustValueConversionContract } from "../../policy/conversions/contracts.js";
import { rustEffectiveValueCarrier } from "./value-carrier-queries.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function admitRustSourceValueConversions(input: { readonly ast: AstReader; readonly records: RustProgramRecords;
  readonly definitions: RustTypeDefinitions; readonly fallible: boolean }, node: Node, operation: RustTargetOperationFact | undefined): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const requests: { readonly node: Node; readonly conversion: RustValueConversion }[] = [];
  const add = (subject: Node | undefined, conversion: RustValueConversion | undefined): void => {
    if (subject !== undefined && conversion !== undefined) requests.push({ node: subject, conversion });
  };
  if (operation?.kind === "operator-call" || operation?.kind === "operator-token") {
    add(BinaryExpression_Left(input.ast, node) ?? Node_Operand(input.ast, node), operation.leftConversion);
    add(BinaryExpression_Right(input.ast, node), operation.rightConversion);
  } else if (operation?.kind === "source-conversion") add(Node_Expression(input.ast, node) ?? Node_Operand(input.ast, node), operation.conversion);
  for (const request of requests) {
    const contract = rustValueConversionContract(request.conversion, input.definitions);
    const source = rustEffectiveValueCarrier(input.records, request.node);
    const refuse = (capability: string, message: string): void => { issues.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: request.node,
      message: `${message} Node kind: ${input.ast.kindName(request.node)}.`, evidence: [`target.capability=${capability}`] }); };
    if (contract !== undefined && source !== undefined && !rustTargetTypeRefEquals(source, contract.source))
      refuse("rust.backend.value-conversion-source", "Target value conversion source does not match the finalized source carrier.");
    if (contract?.fallible === true && !input.fallible)
      refuse("rust.backend.value-conversion", "Fallible target value conversion requires a finalized fallible lowering context.");
    if (contract?.lowering === "js-argument-vector-callback" && contract.lane === "native" && !input.fallible)
      refuse("rust.backend.regexp-callback-native-string", "A native RegExp callback projection requires a finalized fallible lowering context.");
  }
  return Object.freeze(issues);
}
