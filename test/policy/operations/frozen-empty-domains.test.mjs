import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { selectJsSurfaceOperation } from "../../../dist/policy/operations/source-profiles/js/selection.js";
import { rustValueDomainHasTargetType } from "../../../dist/analysis/objects/value-domain-carriers.js";
import { rustEmptyObjectTargetType, rustFixedArrayTargetType, rustJsArrayTargetType, rustJsValueTargetType, rustTsValueTargetType } from "../../../dist/target-model/types/index.js";

for (const carrier of [rustTsValueTargetType(), rustJsValueTargetType()]) {
  for (const [member, method] of [["freeze", "freeze_object_state"], ["isFrozen", "object_state_is_frozen"]]) {
    test(`${carrier.id} ${member} requires exact complete EmptyObject evidence`, () => {
      const request = { ownerName: "ObjectConstructor", memberName: member, operationKind: "call",
        argumentCarriers: [carrier] };
      assert.equal(selectJsSurfaceOperation(request), undefined, "no implicit broad trait or fallback");
      assert.equal(selectJsSurfaceOperation({ ...request,
        argumentValueDomainHasTargetType: () => false,
        carrierSupportsProjectIdentity: () => true,
      }), undefined, "project identity does not bypass the complete domain");
      let calls = 0;
      const selected = selectJsSurfaceOperation({ ...request,
        argumentValueDomainHasTargetType: (index, expected) => {
          calls++;
          assert.equal(index, 0);
          assert.deepEqual(expected, rustEmptyObjectTargetType());
          return true;
        },
      });
      assert.equal(selected !== undefined, true, "exact closed capability selects");
      assert.equal(calls, 1, "one canonical evidence request");
      assert.equal(selected.fact.target.form, "call");
      assert.equal(selected.fact.target.path.endsWith(`::${method}`), true);
      assert.deepEqual(selected.fact.target.argModes, ["ref"]);
      assert.deepEqual(selected.parameterCarriers, [carrier]);
      if (member === "freeze") assert.deepEqual(selected.resultCarrier, carrier);
    });
  }
}

test("typed EmptyObject freeze retains the original native path without broad evidence", () => {
  for (const [member, path] of [["freeze", "freeze_object"], ["isFrozen", "object_is_frozen"]]) {
    const selected = selectJsSurfaceOperation({ ownerName: "ObjectConstructor", memberName: member,
      operationKind: "call", argumentCarriers: [rustEmptyObjectTargetType()],
      argumentValueDomainHasTargetType: () => { assert.fail("typed path requires no broad projection"); },
    });
    assert.equal(selected?.fact.target.path, `tsonic_rust_runtime::${path}`);
  }
});

function domainHost({ selection = "complete", carriers = [rustEmptyObjectTargetType()],
  projection = [], absent = false, admitsAbsence = false, failure, lateFailure = false,
  subjectKind = "value", missingSelectedType = false } = {}) {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/domain", files: {
    "/domain/index.ts": "const value = {};",
  }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0);
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/domain/index.ts");
  assert.equal(file !== undefined, true);
  const storage = createSourceStorageQuery(source, [file]);
  const value = storage.nodes.find(candidate => source.ast.is.IsVariableDeclaration(candidate));
  const scope = storage.bindingsForLexicalOwner(value);
  assert.equal(scope.kind, "resolved", "the query receives a real canonical checked storage binding");
  const node = {};
  const sourceFile = {};
  const selectedType = {};
  const absentType = {};
  const origins = carriers.map((carrier, index) => ({ sourceFile, type: absent && index === 0 ? absentType : {},
    subject: { kind: subjectKind, node: { carrier }, projection }, bindings: scope.bindings }));
  let resolved = false;
  const semantics = { types: {
    expressionType: () => missingSelectedType ? undefined : selectedType,
    isUnion: () => admitsAbsence,
    unionOrIntersectionTypes: () => [selectedType, absentType],
    isNullish: type => type === absentType,
  } };
  return { node, bindings: scope.bindings, host: {
    sourceStorage: {
      source: { ast: { getSourceFile: () => sourceFile }, semantics: { includes: () => true } },
      failureReason: () => failure ?? (lateFailure && resolved ? "budget exhausted" : undefined),
      subjectFor: () => ({ kind: "resolved", subject: {} }),
      storageProducersFor: (subject, bindings) => {
        assert.equal(bindings === scope.bindings, true, "no global or empty-binding fallback");
        return selection === "unresolved" ? { kind: "unresolved", reason: "exact fixture refusal" }
          : { kind: selection, producers: origins };
      },
    },
    semantics: () => semantics,
    types: { resolveNode: subject => { resolved = true; return subject.carrier; } },
  } };
}

test("domain carrier proof fails closed for open, empty, unsupported and exhausted evidence", () => {
  for (const options of [{ selection: "open" }, { selection: "unresolved" }, { carriers: [] },
    { carriers: [rustEmptyObjectTargetType(), rustJsValueTargetType()] },
    { failure: "budget exhausted" }, { lateFailure: true }, { subjectKind: "storage" },
    { missingSelectedType: true }, { carriers: [undefined] },
  ]) {
    const { node, host, bindings } = domainHost(options);
    assert.equal(rustValueDomainHasTargetType(host, node, rustEmptyObjectTargetType(), bindings), false,
      "every present origin must retain the exact selected target carrier");
  }
  const { node, host, bindings } = domainHost();
  assert.equal(rustValueDomainHasTargetType(host, node, rustEmptyObjectTargetType(), bindings), true);
  assert.equal(rustValueDomainHasTargetType({ ...host, sourceStorage: undefined }, node, rustEmptyObjectTargetType(), bindings), false);
});

test("domain absence proof follows checked refinement and requires a present origin", () => {
  for (const [options, expected] of [
    [{ absent: true, carriers: [undefined, rustEmptyObjectTargetType()] }, true],
    [{ absent: true, admitsAbsence: true, carriers: [undefined, rustEmptyObjectTargetType()] }, false],
    [{ absent: true, carriers: [undefined] }, false],
  ]) {
    const { node, host, bindings } = domainHost(options);
    assert.equal(rustValueDomainHasTargetType(host, node, rustEmptyObjectTargetType(), bindings), expected);
  }
});

test("domain projection retains exact array and tuple element carriers without widening", () => {
  for (const [carrier, projection, expected] of [
    [{ kind: "array", element: rustEmptyObjectTargetType() }, [{ kind: "array-element" }], true],
    [{ kind: "slice", element: rustEmptyObjectTargetType() }, [{ kind: "array-element" }], true],
    [rustJsArrayTargetType(rustEmptyObjectTargetType()), [{ kind: "array-element" }], true],
    [rustFixedArrayTargetType(rustEmptyObjectTargetType(), 2), [{ kind: "array-element" }], true],
    [{ kind: "tuple", elements: [rustJsValueTargetType(), rustEmptyObjectTargetType()] }, [{ kind: "tuple-element", index: 1 }], true],
    [{ kind: "tuple", elements: [rustEmptyObjectTargetType()] }, [{ kind: "tuple-element", index: 1 }], false],
    [{ kind: "array", element: rustJsValueTargetType() }, [{ kind: "array-element" }], false],
  ]) {
    const { node, host, bindings } = domainHost({ carriers: [carrier], projection });
    assert.equal(rustValueDomainHasTargetType(host, node, rustEmptyObjectTargetType(), bindings), expected);
  }
});
