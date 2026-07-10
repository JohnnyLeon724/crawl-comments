'use strict';

const fs = require('node:fs');

const REQUIRED_SELECTORS = [
  'postRootSelector',
  'commentRootSelector',
  'commentItemSelector',
  'replyContainerSelector',
  'scrollContainerSelector',
  'sortScopeSelector'
];

const ALLOWED_PROFILE_FIELDS = new Set([
  'platform',
  'identityMode',
  ...REQUIRED_SELECTORS,
  'sorts',
  'endTexts',
  'safeReplyExpandPatterns',
  'compositeIdentity',
  'identityAttributes'
]);

const ALLOWED_SORT_FIELDS = new Set(['label', 'selectedAttribute', 'selectedValue']);
const ALLOWED_IDENTITY_ATTRIBUTES = new Set(['comment', 'parent', 'root']);
const ALLOWED_COMPOSITE_IDENTITY_FIELDS = new Set([
  'authorHrefSelector',
  'commentTextSelector',
  'timestampSelector'
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function validateAllowedFields(value, allowedFields, path, errors) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return;
  for (const name of Object.keys(value)) {
    if (!allowedFields.has(name)) errors.push(`${path}.${name} is not allowed`);
  }
}

function validateStringArray(value, name, errors, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum) {
    errors.push(`${name} must contain at least one ${name.includes('Pattern') ? 'pattern' : 'value'}`);
    return;
  }

  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      errors.push(`${name}[${index}] must be a non-empty string`);
    }
  });
}

function validateWeiboCommentProfile(value) {
  const errors = [];

  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return ['profile must be an object'];
  }

  for (const name of Object.keys(value)) {
    if (!ALLOWED_PROFILE_FIELDS.has(name)) errors.push(`${name} is not allowed`);
  }

  if (value.platform !== 'weibo') {
    errors.push('platform must be "weibo"');
  }

  const identityMode = value.identityMode;
  if (!isNonEmptyString(identityMode)) {
    errors.push('identityMode is required');
  } else if (!['dom_id', 'composite'].includes(identityMode)) {
    errors.push('identityMode must be one of: dom_id, composite');
  }

  for (const name of REQUIRED_SELECTORS) {
    if (!isNonEmptyString(value[name])) errors.push(`${name} is required`);
  }

  validateAllowedFields(value.sorts, new Set(['hot', 'time']), 'sorts', errors);
  for (const mode of ['hot', 'time']) {
    const sort = value.sorts && value.sorts[mode];
    validateAllowedFields(sort, ALLOWED_SORT_FIELDS, `sorts.${mode}`, errors);
    if (!isNonEmptyString(sort && sort.label)) {
      errors.push(`sorts.${mode}.label is required`);
    }
    if (!isNonEmptyString(sort && sort.selectedAttribute)) {
      errors.push(`sorts.${mode}.selectedAttribute is required`);
    }
    if (!isNonEmptyString(sort && sort.selectedValue)) {
      errors.push(`sorts.${mode}.selectedValue is required`);
    }
  }

  validateStringArray(value.endTexts, 'endTexts', errors, 1);
  validateStringArray(value.safeReplyExpandPatterns, 'safeReplyExpandPatterns', errors, 1);
  for (const [index, pattern] of (value.safeReplyExpandPatterns || []).entries()) {
    if (!isNonEmptyString(pattern)) continue;
    try {
      new RegExp(pattern);
    } catch (_error) {
      errors.push(`safeReplyExpandPatterns[${index}] must be a valid regular expression`);
    }
  }

  const identities = value.identityAttributes;
  validateAllowedFields(identities, ALLOWED_IDENTITY_ATTRIBUTES, 'identityAttributes', errors);
  if (!Array.isArray(identities && identities.comment)) {
    errors.push('identityAttributes.comment must be an array');
  } else if (identityMode === 'dom_id' && !identities.comment.length) {
    errors.push('identityAttributes.comment must contain at least one attribute');
  } else {
    validateStringArray(
      identities.comment,
      'identityAttributes.comment',
      errors,
      identityMode === 'dom_id' ? 1 : 0
    );
  }

  for (const name of ['parent', 'root']) {
    if (!Array.isArray(identities && identities[name])) {
      errors.push(`identityAttributes.${name} must be an array`);
      continue;
    }
    validateStringArray(identities[name], `identityAttributes.${name}`, errors);
  }

  validateAllowedFields(
    value.compositeIdentity,
    ALLOWED_COMPOSITE_IDENTITY_FIELDS,
    'compositeIdentity',
    errors
  );
  if (identityMode === 'composite') {
    for (const name of ['authorHrefSelector', 'commentTextSelector', 'timestampSelector']) {
      if (!isNonEmptyString(value.compositeIdentity && value.compositeIdentity[name])) {
        errors.push(`compositeIdentity.${name} is required`);
      }
    }
  }

  return errors;
}

function readWeiboCommentProfile(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const errors = validateWeiboCommentProfile(value);
  if (errors.length) {
    throw new Error(`Invalid Weibo comment profile: ${errors.join('; ')}`);
  }
  return value;
}

module.exports = {
  validateWeiboCommentProfile,
  readWeiboCommentProfile
};
