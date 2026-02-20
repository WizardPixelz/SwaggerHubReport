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

  // Step 2: Generate PDF report
  console.log('\n2. Generating PDF report...');
  const reportGen = new ReportGenerator();
  const pdfBuffer = await reportGen.generate({
    apiName: 'Sample Pet Store API',
    apiVersion: '1.0.0',
    owner: 'test-organization',
    validationResults: results,
    generatedAt: new Date().toISOString(),
  });

  // Step 3: Write to file
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
