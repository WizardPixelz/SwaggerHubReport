/**
 * Validation Engine - Uses Spectral to lint OpenAPI specifications
 *
 * Validates against:
 * - OpenAPI 2.0/3.x spec compliance
 * - API design best practices (naming, descriptions, response codes, etc.)
 */

const { Spectral, Document } = require('@stoplight/spectral-core');
const Parsers = require('@stoplight/spectral-parsers');
const { oas } = require('@stoplight/spectral-rulesets');
const { truthy, pattern } = require('@stoplight/spectral-functions');

class ValidationEngine {
  constructor(options = {}) {
    this.includeBestPractices = options.includeBestPractices !== false;
  }

  /**
   * Validate an OpenAPI specification
   * @param {string|object} apiSpec - The OpenAPI spec (JSON string or object)
   * @returns {object} Validation results with categorized issues and summary
   */
  async validate(apiSpec) {
    const spectral = new Spectral();

    // Build combined ruleset: standard OAS rules + optional best practice rules
    const rulesetDefinition = {
      extends: [[oas, 'all']],
      rules: {},
    };

    if (this.includeBestPractices) {
      rulesetDefinition.rules = this.getBestPracticeRules();
    }

    spectral.setRuleset(rulesetDefinition);

    // Parse the spec if it's a string
    const specString = typeof apiSpec === 'string' ? apiSpec : JSON.stringify(apiSpec);

    // Create a Spectral document
    const document = new Document(specString, Parsers.Json, 'api-spec.json');

    // Run validation
    const diagnostics = await spectral.run(document);

    // Categorize and format results
    return this.formatResults(diagnostics);
  }

  /**
   * Best practice rules using actual Spectral function references
   */
  getBestPracticeRules() {
    return {
      'bp-path-casing': {
        description: 'API paths should use kebab-case (e.g., /my-resource)',
        message: 'Path should use kebab-case. Avoid camelCase or snake_case in URLs.',
        severity: 'warn',
        given: '$.paths',
        then: {
          function: pattern,
          functionOptions: { match: '^(/[a-z0-9\\-{}]+)+$' },
          field: '@key',
        },
      },
      'bp-request-body-required': {
        description: 'POST, PUT, and PATCH operations should define a request body',
        message: 'Operation should have a requestBody defined.',
        severity: 'warn',
        given: '$.paths[*][post,put,patch]',
        then: {
          function: truthy,
          field: 'requestBody',
        },
      },
      'bp-response-descriptions': {
        description: 'All API responses should have meaningful descriptions',
        message: 'Response should have a description.',
        severity: 'warn',
        given: '$.paths[*][*].responses[*]',
        then: {
          function: truthy,
          field: 'description',
        },
      },
      'bp-parameter-descriptions': {
        description: 'All parameters should have descriptions',
        message: 'Parameter should have a description.',
        severity: 'info',
        given: '$.paths[*][*].parameters[*]',
        then: {
          function: truthy,
          field: 'description',
        },
      },
      'bp-tags-description': {
        description: 'Tags should have descriptions for better documentation',
        message: 'Tag should have a description.',
        severity: 'info',
        given: '$.tags[*]',
        then: {
          function: truthy,
          field: 'description',
        },
      },
    };
  }

  /**
   * Format Spectral diagnostics into a structured report
   */
  formatResults(diagnostics) {
    const issues = diagnostics.map((d) => ({
      code: d.code,
      message: d.message,
      severity: this.mapSeverity(d.severity),
      severityLevel: d.severity,
      path: d.path ? d.path.join('.') : '',
      range: d.range
        ? {
            startLine: d.range.start.line + 1,
            startCol: d.range.start.character + 1,
            endLine: d.range.end.line + 1,
            endCol: d.range.end.character + 1,
          }
        : null,
      category: this.categorizeIssue(d.code),
    }));

    // Sort by severity (errors first)
    issues.sort((a, b) => a.severityLevel - b.severityLevel);

    // Build summary
    const summary = {
      totalIssues: issues.length,
      errors: issues.filter((i) => i.severity === 'Error').length,
      warnings: issues.filter((i) => i.severity === 'Warning').length,
      info: issues.filter((i) => i.severity === 'Information').length,
      hints: issues.filter((i) => i.severity === 'Hint').length,
      passedValidation: issues.filter((i) => i.severity === 'Error').length === 0,
      categories: this.summarizeByCategory(issues),
      score: this.calculateScore(issues),
    };

    return { issues, summary };
  }

  /**
   * Map Spectral severity numbers to human-readable labels
   * Spectral: 0=Error, 1=Warning, 2=Information, 3=Hint
   */
  mapSeverity(severity) {
    const map = {
      0: 'Error',
      1: 'Warning',
      2: 'Information',
      3: 'Hint',
    };
    return map[severity] || 'Unknown';
  }

  /**
   * Categorize an issue based on its rule code
   */
  categorizeIssue(code) {
    const categories = {
      // Spec compliance
      'oas2-schema': 'Spec Compliance',
      'oas3-schema': 'Spec Compliance',
      'oas3-valid-schema-example': 'Spec Compliance',
      'oas2-valid-schema-example': 'Spec Compliance',
      'oas3-valid-media-example': 'Spec Compliance',

      // Structure
      'info-contact': 'Documentation',
      'info-description': 'Documentation',
      'info-license': 'Documentation',
      'operation-description': 'Documentation',
      'operation-operationId': 'Structure',
      'operation-tags': 'Structure',
      'path-params': 'Structure',
      'no-eval-in-markdown': 'Security',
      'no-script-tags-in-markdown': 'Security',

      // Naming & Design
      'operation-operationId-valid-in-url': 'Naming Conventions',
      'operation-operationId-unique': 'Naming Conventions',
      'path-keys-no-trailing-slash': 'Naming Conventions',
      'path-not-include-query': 'Naming Conventions',

      // Responses
      'operation-success-response': 'Response Design',
      'oas3-api-servers': 'Server Configuration',
      'oas2-api-host': 'Server Configuration',
      'oas2-api-schemes': 'Server Configuration',

      // Best practices
      'bp-path-casing': 'Best Practice',
      'bp-request-body-required': 'Best Practice',
      'bp-response-descriptions': 'Best Practice',
      'bp-parameter-descriptions': 'Best Practice',
      'bp-schema-properties-descriptions': 'Best Practice',
      'bp-no-numeric-ids-in-paths': 'Best Practice',
    };

    return categories[code] || 'General';
  }

  /**
   * Summarize issues grouped by category
   */
  summarizeByCategory(issues) {
    const categories = {};
    for (const issue of issues) {
      if (!categories[issue.category]) {
        categories[issue.category] = { count: 0, errors: 0, warnings: 0 };
      }
      categories[issue.category].count++;
      if (issue.severity === 'Error') categories[issue.category].errors++;
      if (issue.severity === 'Warning') categories[issue.category].warnings++;
    }
    return categories;
  }

  /**
   * Calculate an overall API quality score (0-100)
   * Deductions: Errors = -10pts, Warnings = -3pts, Info = -1pt
   */
  calculateScore(issues) {
    let score = 100;
    for (const issue of issues) {
      switch (issue.severity) {
        case 'Error':
          score -= 10;
          break;
        case 'Warning':
          score -= 3;
          break;
        case 'Information':
          score -= 1;
          break;
        default:
          break;
      }
    }
    return Math.max(0, Math.min(100, score));
  }
}

module.exports = { ValidationEngine };
