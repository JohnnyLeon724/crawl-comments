'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const canonical = require('../schemas/ai-comment-extraction.schema.json');
const { createModelOutputSchema } = require('../src/normalize/model-output-schema.js');

test('creates a strict model schema without mutating the canonical project schema', () => {
  const modelSchema = createModelOutputSchema(canonical);

  assert.notEqual(modelSchema, canonical);
  assert.equal(canonical.required.includes('platform'), false);
  assert.equal(canonical.properties.rejected.items.required.includes('evidence'), false);
  assert.equal(modelSchema.required.includes('platform'), true);
  assert.equal(modelSchema.properties.rejected.items.required.includes('evidence'), true);
});

test('requires every declared object property at every nested level', () => {
  const modelSchema = createModelOutputSchema(canonical);
  const extractionRow = modelSchema.properties.rows.items;

  assert.deepEqual(
    [...modelSchema.required].sort(),
    Object.keys(modelSchema.properties).sort()
  );
  assert.deepEqual(
    [...extractionRow.required].sort(),
    Object.keys(extractionRow.properties).sort()
  );
});
