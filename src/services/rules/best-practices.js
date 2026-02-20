/**
 * Custom Best Practice Rules for API Design
 *
 * NOTE: These rules are defined in validation-engine.js using Spectral's
 * programmatic API with actual function references.
 *
 * This file documents the custom rules applied:
 *
 * bp-path-casing      - API paths should use kebab-case
 * bp-request-body-required - POST/PUT/PATCH should have request bodies
 * bp-response-descriptions - All responses need descriptions  
 * bp-parameter-descriptions - Parameters should have descriptions
 * bp-tags-description  - Tags should have descriptions
 *
 * To add more rules, edit ValidationEngine.getBestPracticeRules() in
 * validation-engine.js using Spectral function imports:
 *   const { truthy, pattern, schema } = require('@stoplight/spectral-functions');
 */

module.exports = { bestPracticeRules };
