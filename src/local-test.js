/**
 * Local Test Script
 *
 * Run with: node src/local-test.js
 *
 * Tests the full validation + report pipeline locally using mock
 * SwaggerHub Standardization API data (since the real API requires
 * network access and credentials).
 *
 * The PDF report is written to ./test-output/
 */

const fs = require('fs');
const path = require('path');
const { ValidationEngine } = require('./services/validation-engine');
const { ReportGenerator } = require('./services/report-generator');
const { DiffEngine } = require('./services/diff-engine');

/**
 * Mock SwaggerHub Standardization API response
 * Simulates what GET /apis/{owner}/{api}/{version}/standardization returns
 * for a Pet Store API with intentional style-guide violations.
 */
const mockStandardizationResponse = {
  errors: [
    {
      ruleName: 'info-contact',
      message: 'Info object must have "contact" object.',
      severity: 'WARN',
      line: 3,
      pointer: 'info',
    },
    {
      ruleName: 'info-description',
      message: 'Info "description" must be present and non-empty string.',
      severity: 'WARN',
      line: 3,
      pointer: 'info',
    },
    {
      ruleName: 'info-license',
      message: 'Info object must have "license" object.',
      severity: 'WARN',
      line: 3,
      pointer: 'info',
    },
    {
      ruleName: 'oas3-api-servers',
      message: 'OpenAPI "servers" must be present and non-empty array.',
      severity: 'WARN',
      line: 1,
      pointer: '',
    },
    {
      ruleName: 'operation-description',
      message: 'Operation "description" must be present and non-empty string.',
      severity: 'WARN',
      line: 10,
      pointer: 'paths./pets.get',
    },
    {
      ruleName: 'operation-operationId',
      message: 'Operation must have "operationId".',
      severity: 'WARN',
      line: 10,
      pointer: 'paths./pets.get',
    },
    {
      ruleName: 'operation-description',
      message: 'Operation "description" must be present and non-empty string.',
      severity: 'WARN',
      line: 32,
      pointer: 'paths./pets.post',
    },
    {
      ruleName: 'operation-description',
      message: 'Operation "description" must be present and non-empty string.',
      severity: 'WARN',
      line: 48,
      pointer: 'paths./pets/{petId}.get',
    },
    {
      ruleName: 'bp-path-casing',
      message: 'Path should use kebab-case. Avoid camelCase or snake_case in URLs.',
      severity: 'WARN',
      line: 70,
      pointer: 'paths./petCategories',
    },
    {
      ruleName: 'operation-tags',
      message: 'Operation must have non-empty "tags" array.',
      severity: 'WARN',
      line: 70,
      pointer: 'paths./petCategories.get',
    },
    {
      ruleName: 'bp-parameter-descriptions',
      message: 'Parameter should have a description.',
      severity: 'INFO',
      line: 55,
      pointer: 'paths./pets/{petId}.get.parameters.0',
    },
    {
      ruleName: 'bp-response-descriptions',
      message: 'Response should have a meaningful description.',
      severity: 'INFO',
      line: 38,
      pointer: 'paths./pets.post.responses.201',
    },
    {
      ruleName: 'bp-tags-description',
      message: 'Tag should have a description.',
      severity: 'INFO',
      line: 0,
      pointer: 'tags.0',
    },
    {
      ruleName: 'bp-tags-description',
      message: 'Tag should have a description.',
      severity: 'INFO',
      line: 0,
      pointer: 'tags.1',
    },
    {
      ruleName: 'oas3-schema',
      message: 'Property "id" should have a description.',
      severity: 'INFO',
      line: 85,
      pointer: 'components.schemas.Pet.properties.id',
    },
    {
      ruleName: 'oas3-schema',
      message: 'Property "name" should have a description.',
      severity: 'INFO',
      line: 89,
      pointer: 'components.schemas.Pet.properties.name',
    },
    {
      ruleName: 'oas3-schema',
      message: 'Property "tag" should have a description.',
      severity: 'INFO',
      line: 92,
      pointer: 'components.schemas.Pet.properties.tag',
    },
    {
      ruleName: 'operation-success-response',
      message: 'Operation must define at least one 2xx or 3xx response.',
      severity: 'WARN',
      line: 70,
      pointer: 'paths./petCategories.get.responses',
    },
    {
      ruleName: 'bp-request-body-required',
      message: 'POST operation should have a requestBody defined.',
      severity: 'WARN',
      line: 32,
      pointer: 'paths./pets.post',
    },
    {
      ruleName: 'no-eval-in-markdown',
      message: 'Markdown descriptions should not contain "eval(" expressions.',
      severity: 'ERROR',
      line: 5,
      pointer: 'info.description',
    },
  ],
};

async function main() {
  console.log('=== SwaggerHub Validation Report - Local Test ===\n');
  console.log('   Using mock SwaggerHub Standardization API data\n');

  // Step 1: Process mock standardization results through validation engine
  console.log('1. Processing standardization results...');
  const engine = new ValidationEngine();
  const results = await engine.validate(mockStandardizationResponse);

  console.log(`\n   Score: ${results.summary.score}/100`);
  console.log(`   Passed: ${results.summary.passedValidation}`);
  console.log(`   Total Issues: ${results.summary.totalIssues}`);
  console.log(`   - Errors:   ${results.summary.errors}`);
  console.log(`   - Warnings: ${results.summary.warnings}`);
  console.log(`   - Info:     ${results.summary.info}`);
  console.log(`   - Hints:    ${results.summary.hints}`);

  console.log('\n   Issues:');
  results.issues.forEach((issue, i) => {
    console.log(`   ${i + 1}. [${issue.severity}] ${issue.message}`);
    if (issue.path) console.log(`      Path: ${issue.path}`);
  });

  // Step 2: Simulate a previous scan for diff comparison
  console.log('\n2. Simulating previous scan (with more issues)...');
  const previousScan = {
    version: '0.9.0',
    scannedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week ago
    summary: {
      totalIssues: 25,
      errors: 2,
      warnings: 12,
      info: 8,
      hints: 3,
      passedValidation: false,
      score: 30,
      categories: {
        Documentation: { count: 5, errors: 0, warnings: 3 },
        'Best Practice': { count: 6, errors: 0, warnings: 4 },
        Structure: { count: 4, errors: 1, warnings: 2 },
        Security: { count: 2, errors: 1, warnings: 1 },
        'Naming Conventions': { count: 3, errors: 0, warnings: 2 },
        General: { count: 5, errors: 0, warnings: 0 },
      },
    },
    issues: [
      // Some issues that will still be present (persisting)
      ...results.issues.slice(0, 10).map((i) => ({ ...i })),
      // Some issues that got resolved (won't be in current)
      {
        code: 'oas3-schema',
        message: 'Schema object "Pet" has an invalid "type" value',
        severity: 'Error',
        severityLevel: 0,
        path: 'components.schemas.Pet.type',
        category: 'Spec Compliance',
      },
      {
        code: 'no-script-tags-in-markdown',
        message: 'Description contains script tags',
        severity: 'Error',
        severityLevel: 0,
        path: 'info.description',
        category: 'Security',
      },
      {
        code: 'bp-path-casing',
        message: 'Path should use kebab-case. Avoid camelCase or snake_case in URLs.',
        severity: 'Warning',
        severityLevel: 1,
        path: 'paths./userAccounts',
        category: 'Best Practice',
      },
      {
        code: 'operation-description',
        message: 'Operation "description" must be present and non-empty string.',
        severity: 'Warning',
        severityLevel: 1,
        path: 'paths./users.get',
        category: 'Documentation',
      },
      {
        code: 'operation-description',
        message: 'Operation "description" must be present and non-empty string.',
        severity: 'Warning',
        severityLevel: 1,
        path: 'paths./users.post',
        category: 'Documentation',
      },
    ],
  };

  // Run diff
  console.log('   Computing diff...');
  const diffEngine = new DiffEngine();
  const diff = diffEngine.compare(results, previousScan);

  console.log(`\n   Diff Results:`);
  console.log(`   - Previous score: ${diff.previousScore} → Current score: ${diff.currentScore} (${diff.scoreChange > 0 ? '+' : ''}${diff.scoreChange})`);
  console.log(`   - Resolved issues: ${diff.resolvedIssues.length}`);
  console.log(`   - New issues: ${diff.newIssues.length}`);
  console.log(`   - Persisting issues: ${diff.persistingIssues.length}`);

  if (diff.resolvedIssues.length > 0) {
    console.log('\n   Resolved:');
    diff.resolvedIssues.forEach((i) => console.log(`     ✓ [${i.severity}] ${i.message}`));
  }
  if (diff.newIssues.length > 0) {
    console.log('\n   New:');
    diff.newIssues.forEach((i) => console.log(`     ● [${i.severity}] ${i.message}`));
  }

  // Step 3: Generate PDF report with diff
  console.log('\n3. Generating PDF report (with diff section)...');
  const reportGen = new ReportGenerator();
  const pdfBuffer = await reportGen.generate({
    apiName: 'Sample Pet Store API',
    apiVersion: '1.0.0',
    owner: 'test-organization',
    validationResults: results,
    diff,
    generatedAt: new Date().toISOString(),
  });

  // Step 4: Write to file
  const outputDir = path.join(__dirname, '..', 'test-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'validation-report.pdf');
  fs.writeFileSync(outputPath, pdfBuffer);
  console.log(`\n   PDF written to: ${outputPath}`);
  console.log(`   File size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

  console.log('\n=== Test Complete ===');
}

main().catch(console.error);
