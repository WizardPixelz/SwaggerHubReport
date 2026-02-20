/**
 * Validation Engine - Processes SwaggerHub Standardization API results
 *
 * Instead of running Spectral locally, this engine consumes the validation
 * errors returned by the SwaggerHub Standardization API endpoint:
 *   GET /apis/{owner}/{api}/{version}/standardization
 *
 * The engine normalizes the response into our standard format with:
 * - Categorized issues
 * - Severity mapping
 * - Numeric quality score (0-100)
 * - Summary statistics
 */

class ValidationEngine {
  constructor(options = {}) {
    // Reserved for future options
  }

  /**
   * Process standardization results from the SwaggerHub API
   * @param {object} standardizationData - Response from GET .../standardization
   *   Expected shape: { errors: [{ description, line, message, ruleName, severity }] }
   *   Or: { result: { errors: [...] } }
   * @returns {object} Validation results with categorized issues and summary
   */
  async validate(standardizationData) {
    // The SwaggerHub API may return errors at the top level or nested under 'result'
    const rawErrors = standardizationData.errors
      || standardizationData.result?.errors
      || [];

    // Normalize each standardization error into our issue format
    const issues = rawErrors.map((err) => ({
      code: err.ruleName || err.rule || 'standardization',
      message: err.message || err.description || 'Standardization violation',
      severity: this.mapSeverity(err.severity),
      severityLevel: this.mapSeverityLevel(err.severity),
      path: err.pointer || err.path || (err.line ? `line ${err.line}` : ''),
      range: err.line
        ? {
            startLine: err.line,
            startCol: err.character || 1,
            endLine: err.line,
            endCol: err.character || 1,
          }
        : null,
      category: this.categorizeIssue(err.ruleName || err.rule || ''),
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
   * Map SwaggerHub standardization severity to human-readable label
   * SwaggerHub StandardizationRuleSeverity: ERROR, WARN/WARNING, INFO, HINT
   */
  mapSeverity(severity) {
    if (!severity) return 'Warning';
    const s = String(severity).toUpperCase();
    if (s === 'ERROR' || s === '0') return 'Error';
    if (s === 'WARN' || s === 'WARNING' || s === '1') return 'Warning';
    if (s === 'INFO' || s === 'INFORMATION' || s === '2') return 'Information';
    if (s === 'HINT' || s === '3') return 'Hint';
    return 'Warning';
  }

  /**
   * Map severity to numeric level (for sorting)
   * 0=Error, 1=Warning, 2=Information, 3=Hint
   */
  mapSeverityLevel(severity) {
    if (!severity) return 1;
    const s = String(severity).toUpperCase();
    if (s === 'ERROR' || s === '0') return 0;
    if (s === 'WARN' || s === 'WARNING' || s === '1') return 1;
    if (s === 'INFO' || s === 'INFORMATION' || s === '2') return 2;
    if (s === 'HINT' || s === '3') return 3;
    return 1;
  }

  /**
   * Categorize an issue based on its rule name
   */
  categorizeIssue(ruleName) {
    const code = String(ruleName).toLowerCase();

    // Spec compliance
    if (code.includes('schema') || code.includes('oas2-') || code.includes('oas3-')) return 'Spec Compliance';

    // Documentation
    if (code.includes('description') || code.includes('contact') || code.includes('license') || code.includes('info-')) return 'Documentation';

    // Structure
    if (code.includes('operationid') || code.includes('operation-tags') || code.includes('path-params')) return 'Structure';

    // Security
    if (code.includes('security') || code.includes('eval') || code.includes('script')) return 'Security';

    // Naming
    if (code.includes('casing') || code.includes('naming') || code.includes('path-key') || code.includes('trailing-slash')) return 'Naming Conventions';

    // Response design
    if (code.includes('response') || code.includes('success-response')) return 'Response Design';

    // Server config
    if (code.includes('server') || code.includes('host') || code.includes('scheme')) return 'Server Configuration';

    // Best practice
    if (code.includes('bp-') || code.includes('best-practice')) return 'Best Practice';

    return 'General';
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
