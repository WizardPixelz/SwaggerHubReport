/**
 * Local Test Script
 *
 * Run with: node src/local-test.js
 *
 * Tests the full validation + report pipeline locally using a sample OpenAPI spec.
 * The PDF report is written to ./test-output/
 */

const fs = require('fs');
const path = require('path');
const { ValidationEngine } = require('./services/validation-engine');
const { ReportGenerator } = require('./services/report-generator');
const { DiffEngine } = require('./services/diff-engine');

// Sample OpenAPI 3.0 spec with intentional issues for testing
const sampleSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Sample Pet Store API',
    version: '1.0.0',
    // Missing: description, contact, license
  },
  paths: {
    '/pets': {
      get: {
        // Missing: operationId, description
        tags: ['pets'],
        summary: 'List all pets',
        responses: {
          '200': {
            description: 'A list of pets',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Pet' },
                },
              },
            },
          },
          // Missing: error responses
        },
      },
      post: {
        summary: 'Create a pet',
        tags: ['pets'],
        operationId: 'createPet',
        // Missing: requestBody (best practice violation)
        responses: {
          '201': {
            description: 'Pet created',
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        summary: 'Get a pet by ID',
        operationId: 'getPetById',
        tags: ['pets'],
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            // Missing: description
          },
        ],
        responses: {
          '200': {
            description: 'A single pet',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Pet' },
              },
            },
          },
          '404': {
            description: 'Pet not found',
          },
        },
      },
    },
    // Naming violation: camelCase path
    '/petCategories': {
      get: {
        summary: 'List categories',
        operationId: 'listCategories',
        tags: ['categories'],
        responses: {
          '200': {
            description: 'A list of categories',
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: {
            type: 'integer',
            format: 'int64',
            // Missing: description
          },
          name: {
            type: 'string',
            // Missing: description
          },
          tag: {
            type: 'string',
          },
        },
      },
    },
  },
  // Missing: servers
};

async function main() {
  console.log('=== SwaggerHub Validation Report - Local Test ===\n');

  // Step 1: Validate
  console.log('1. Running validation...');
  const engine = new ValidationEngine({ includeBestPractices: true });
  const results = await engine.validate(sampleSpec);

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
