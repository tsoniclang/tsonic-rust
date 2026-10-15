import assert from "node:assert/strict";

export function assertRustRecordRequirement(requiredRecords, family, subject) {
  assert.equal(subject !== undefined, true, family + " selects an exact checked subject");
  assert.equal(requiredRecords.some(row => row.family === family && row.subject === subject), true,
    family + " has its independent selected-source obligation");
}
