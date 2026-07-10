'use strict';

const fs = require('node:fs');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeObjectsStrict(node) {
  if (!node || typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    node.forEach(makeObjectsStrict);
    return node;
  }

  if (node.properties && typeof node.properties === 'object') {
    for (const property of Object.values(node.properties)) {
      makeObjectsStrict(property);
    }
    node.required = Object.keys(node.properties);
    node.additionalProperties = false;
  }

  if (node.items) makeObjectsStrict(node.items);
  if (Array.isArray(node.anyOf)) node.anyOf.forEach(makeObjectsStrict);
  if (Array.isArray(node.oneOf)) node.oneOf.forEach(makeObjectsStrict);
  if (Array.isArray(node.allOf)) node.allOf.forEach(makeObjectsStrict);
  return node;
}

function createModelOutputSchema(canonicalSchema) {
  return makeObjectsStrict(clone(canonicalSchema));
}

function writeModelOutputSchema(canonicalPath, outputPath) {
  const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
  const modelSchema = createModelOutputSchema(canonical);
  fs.writeFileSync(outputPath, `${JSON.stringify(modelSchema, null, 2)}\n`);
  return modelSchema;
}

module.exports = {
  createModelOutputSchema,
  writeModelOutputSchema
};
