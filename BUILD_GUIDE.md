# SwaggerHub Validation Report — Complete Build Guide

**What you're building:** An automated pipeline where SwaggerHub sends a webhook whenever someone creates or updates an API. That webhook triggers an AWS Lambda function that fetches the spec, validates it against OpenAPI standards and best practices, generates a professional PDF report with an incremental diff showing what changed since the last scan, stores it in S3, and emails it to the submitter.

**Architecture:**
```
SwaggerHub (webhook) → API Gateway (POST /webhook) → Lambda → SwaggerHub Standardization API
                                                          ↓
                                                   Diff vs Previous Scan (S3)
                                                          ↓
                                                    PDF Report (PDFKit)
                                                    ↓              ↓
                                                 S3 bucket     SES Email
                                                (storage)    (delivery)
```

---

## Prerequisites

Before you start, make sure you have the following installed on your machine:

1. **Node.js 18 or higher** — Download from https://nodejs.org  
   Verify: Open a terminal and run `node --version` (should show v18.x.x or higher)

2. **npm** — Comes with Node.js  
   Verify: `npm --version`

3. **AWS CLI** — Download from https://aws.amazon.com/cli/  
   Verify: `aws --version`  
   Configure: `aws configure` (enter your Access Key ID, Secret Access Key, default region like `us-east-1`)

4. **AWS CDK CLI** — Install globally:
   ```
   npm install -g aws-cdk
   ```
   Verify: `cdk --version`

5. **A SwaggerHub account** with an API key  
   Get your key: https://app.swaggerhub.com/settings/apiKey

6. **A verified email address or domain in AWS SES**  
   (Instructions in Step 11 below)

---

## Step 1: Create the Project Folder

Open a terminal (PowerShell on Windows, Terminal on Mac/Linux).

```
mkdir SwaggerHubReport
cd SwaggerHubReport
```

---

## Step 2: Create package.json

Create a file called `package.json` in the root of your project folder. You can use any text editor (VS Code, Notepad++, etc.).

**File: `package.json`**
```json
{
  "name": "swaggerhub-validation-report",
  "version": "1.0.0",
  "description": "Automated SwaggerHub API validation and PDF report generation via AWS Lambda",
  "main": "src/handler.js",
  "scripts": {
    "deploy": "cd infra && npx cdk deploy --all",
    "synth": "cd infra && npx cdk synth",
    "test": "jest --coverage",
    "test:local": "node src/local-test.js",
    "lint": "eslint src/",
    "package": "npm run build && cd dist && zip -r ../lambda.zip ."
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.400.0",
    "@aws-sdk/client-ses": "^3.400.0",
    "@aws-sdk/client-cloudwatch": "^3.400.0",
    "@aws-sdk/s3-request-presigner": "^3.400.0",
    "pdfkit": "^0.13.0",
    "axios": "^1.6.0",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "aws-cdk-lib": "^2.100.0",
    "constructs": "^10.3.0",
    "jest": "^29.7.0",
    "eslint": "^8.50.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**What each dependency does:**
- `@aws-sdk/client-s3` — AWS SDK to upload PDF reports to S3
- `@aws-sdk/client-ses` — AWS SDK to send emails via SES
- `@aws-sdk/client-cloudwatch` — AWS SDK to publish custom CloudWatch metrics
- `@aws-sdk/s3-request-presigner` — Generates presigned S3 download URLs
- `pdfkit` — Generates PDF documents in Node.js
- `axios` — HTTP client to call the SwaggerHub API
- `js-yaml` — YAML parser (for YAML-format specs)
- `aws-cdk-lib`, `constructs` — AWS CDK for infrastructure-as-code deployment

---

## Step 3: Create the Folder Structure

Create the following folders. On Windows PowerShell:
```
mkdir src
mkdir src\services
mkdir src\services\rules
mkdir infra
mkdir infra\bin
mkdir infra\lib
```

On Mac/Linux:
```
mkdir -p src/services/rules
mkdir -p infra/bin infra/lib
```

Your project structure should now look like:
```
SwaggerHubReport/
├── package.json
├── src/
│   └── services/
│       └── rules/
└── infra/
    ├── bin/
    └── lib/
```

---

## Step 4: Create .gitignore

**File: `.gitignore`**
```
node_modules/
cdk.out/
test-output/
.env
*.zip
dist/
coverage/
.cdk.staging/
```

---

## Step 5: Create the Configuration File

**File: `src/config.js`**
```javascript
/**
 * Application configuration
 * Values are loaded from environment variables (set in Lambda/CDK)
 */

module.exports = {
  swaggerHub: {
    baseUrl: process.env.SWAGGERHUB_BASE_URL || 'https://api.swaggerhub.com',
    apiKey: process.env.SWAGGERHUB_API_KEY || '',
  },

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    s3Bucket: process.env.REPORT_S3_BUCKET || 'swaggerhub-validation-reports',
    sesFromEmail: process.env.SES_FROM_EMAIL || 'noreply@yourdomain.com',
  },

  defaultNotifyEmail: process.env.DEFAULT_NOTIFY_EMAIL || '',

  validation: {
    // Validation rules are managed in SwaggerHub via Standardization (style guides)
    // The pipeline fetches violations from the SwaggerHub Standardization API
  },

  report: {
    companyName: process.env.COMPANY_NAME || 'API Governance Team',
    companyLogo: process.env.COMPANY_LOGO_URL || '',
    reportTitle: process.env.REPORT_TITLE || 'API Validation Report',
  },
};
```

---

## Step 6: Create the Lambda Handler (Main Entry Point)

This is the main file that runs when the Lambda is triggered. It orchestrates the entire pipeline, including comparing against the previous scan to produce an incremental diff. It uses structured logging (for CloudWatch Insights) and publishes custom CloudWatch metrics.

**File: `src/handler.js`**
```javascript
/**
 * SwaggerHub Validation Report - AWS Lambda Handler
 *
 * Receives SwaggerHub webhook events, validates the API spec,
 * generates a PDF report, stores it in S3, and emails it via SES.
 */

const { SwaggerHubClient } = require('./services/swaggerhub-client');
const { ValidationEngine } = require('./services/validation-engine');
const { ReportGenerator } = require('./services/report-generator');
const { S3Service } = require('./services/s3-service');
const { EmailService } = require('./services/email-service');
const { ScanHistoryService } = require('./services/scan-history-service');
const { DiffEngine } = require('./services/diff-engine');
const { createLogger } = require('./services/logger');
const { MetricsService } = require('./services/metrics-service');
const config = require('./config');

/**
 * Main Lambda handler - entry point for API Gateway webhook
 */
exports.handler = async (event, context) => {
  const pipelineStart = Date.now();
  const log = createLogger({
    requestId: context?.awsRequestId || 'local',
  });

  log.info('webhook.received', { eventKeys: Object.keys(event) });

  try {
    // 1. Parse the SwaggerHub webhook payload
    const webhookPayload = parseWebhookEvent(event);
    log.info('webhook.parsed', {
      owner: webhookPayload.owner,
      apiName: webhookPayload.apiName,
      version: webhookPayload.version,
      action: webhookPayload.action,
    });

    // Enrich logger with API context for all subsequent logs
    const apiLog = log.child({
      owner: webhookPayload.owner,
      apiName: webhookPayload.apiName,
      version: webhookPayload.version,
    });

    // 2. Fetch the full API spec from SwaggerHub
    const swaggerHubClient = new SwaggerHubClient(config.swaggerHub);
    const apiSpec = await swaggerHubClient.fetchApiSpec(
      webhookPayload.owner,
      webhookPayload.apiName,
      webhookPayload.version
    );
    apiLog.info('spec.fetched');

    // 3. Validate the API spec
    const validationEngine = new ValidationEngine();
    const validationResults = await validationEngine.validate(apiSpec);
    apiLog.info('validation.complete', {
      score: validationResults.summary.score,
      totalIssues: validationResults.summary.totalIssues,
      errors: validationResults.summary.errors,
      warnings: validationResults.summary.warnings,
      passed: validationResults.summary.passedValidation,
    });

    // 3b. Compare against previous scan (incremental diff)
    const s3Service = new S3Service(config.aws);
    const scanHistoryService = new ScanHistoryService(config.aws);
    const diffEngine = new DiffEngine();

    let diff = null;
    try {
      const previousScan = await scanHistoryService.getPreviousScan(
        webhookPayload.owner,
        webhookPayload.apiName
      );
      diff = diffEngine.compare(validationResults, previousScan);
      apiLog.info('diff.computed', {
        resolvedCount: diff.resolvedIssues.length,
        newCount: diff.newIssues.length,
        persistingCount: diff.persistingIssues.length,
        scoreChange: diff.scoreChange,
        isFirstScan: diff.isFirstScan,
      });
    } catch (error) {
      apiLog.warn('diff.failed', { errorMessage: error.message });
    }

    // 3c. Save current scan for future comparisons
    try {
      await scanHistoryService.saveCurrentScan(
        webhookPayload.owner,
        webhookPayload.apiName,
        webhookPayload.version,
        validationResults
      );
      apiLog.info('scan-history.saved');
    } catch (error) {
      apiLog.warn('scan-history.save-failed', { errorMessage: error.message });
    }

    // 4. Generate PDF report (with diff if available)
    const reportStart = Date.now();
    const reportGenerator = new ReportGenerator();
    const pdfBuffer = await reportGenerator.generate({
      apiName: webhookPayload.apiName,
      apiVersion: webhookPayload.version,
      owner: webhookPayload.owner,
      validationResults,
      diff,
      generatedAt: new Date().toISOString(),
    });
    const reportGenTimeMs = Date.now() - reportStart;
    apiLog.info('report.generated', { sizeBytes: pdfBuffer.length, durationMs: reportGenTimeMs });

    // 5. Upload report to S3
    const reportKey = `reports/${webhookPayload.owner}/${webhookPayload.apiName}/${webhookPayload.version}/validation-report-${Date.now()}.pdf`;
    const reportUrl = await s3Service.uploadReport(reportKey, pdfBuffer);
    apiLog.info('report.uploaded', { reportKey });

    // 6. Send email notification with report
    const emailService = new EmailService(config.aws);
    await emailService.sendReport({
      recipientEmail: webhookPayload.notifyEmail || config.defaultNotifyEmail,
      apiName: webhookPayload.apiName,
      apiVersion: webhookPayload.version,
      owner: webhookPayload.owner,
      reportUrl,
      pdfBuffer,
      validationSummary: validationResults.summary,
      diff,
    });
    apiLog.info('email.sent', {
      recipient: webhookPayload.notifyEmail || config.defaultNotifyEmail,
    });

    // 7. Publish CloudWatch metrics
    const totalDurationMs = Date.now() - pipelineStart;
    const metricsService = new MetricsService(config.aws);
    try {
      await metricsService.recordValidation({
        owner: webhookPayload.owner,
        apiName: webhookPayload.apiName,
        version: webhookPayload.version,
        summary: validationResults.summary,
        diff,
        reportGenTimeMs,
        totalDurationMs,
      });
      apiLog.info('metrics.published');
    } catch (error) {
      apiLog.warn('metrics.publish-failed', { errorMessage: error.message });
    }

    apiLog.info('pipeline.complete', { totalDurationMs });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Validation report generated and delivered',
        reportUrl,
        summary: validationResults.summary,
      }),
    };
  } catch (error) {
    log.error('pipeline.failed', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error processing validation request',
        error: error.message,
      }),
    };
  }
};

/**
 * Parse the incoming SwaggerHub webhook event
 * SwaggerHub webhooks send JSON payloads with API metadata
 */
function parseWebhookEvent(event) {
  let body;

  if (typeof event.body === 'string') {
    body = JSON.parse(event.body);
  } else {
    body = event.body || event;
  }

  // SwaggerHub webhook payload structure
  // See: https://swagger.io/docs/swaggerhub/webhooks/
  const payload = {
    owner: body.owner || body.organization || '',
    apiName: body.apiName || body.api || body.name || '',
    version: body.version || body.apiVersion || 'latest',
    notifyEmail: body.notifyEmail || body.email || null,
    action: body.action || body.event || 'API_UPDATED',
  };

  if (!payload.owner || !payload.apiName) {
    throw new Error('Invalid webhook payload: missing owner or apiName');
  }

  return payload;
}
```

---

## Step 7: Create the SwaggerHub Client

This file calls the SwaggerHub REST API to download the full OpenAPI spec.

**File: `src/services/swaggerhub-client.js`**
```javascript
/**
 * SwaggerHub API Client
 *
 * Interacts with the SwaggerHub Registry API to fetch API specifications.
 * See: https://app.swaggerhub.com/apis/swagger-hub/registry-api/
 */

const axios = require('axios');

class SwaggerHubClient {
  constructor(config) {
    this.baseUrl = config.baseUrl || 'https://api.swaggerhub.com';
    this.apiKey = config.apiKey;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        Accept: 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
    });
  }

  /**
   * Fetch an API specification from SwaggerHub
   * @param {string} owner - API owner (organization or user)
   * @param {string} apiName - Name of the API
   * @param {string} version - API version (or 'latest')
   * @returns {object} The parsed OpenAPI specification
   */
  async fetchApiSpec(owner, apiName, version = 'latest') {
    try {
      let url;
      if (version && version !== 'latest') {
        url = `/apis/${owner}/${apiName}/${version}`;
      } else {
        url = `/apis/${owner}/${apiName}`;
      }

      console.log(`Fetching API spec from SwaggerHub: ${url}`);

      const response = await this.http.get(url, {
        headers: { Accept: 'application/json' },
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const message = error.response.data?.message || error.message;

        switch (status) {
          case 401:
            throw new Error(`SwaggerHub authentication failed. Check your API key. (${message})`);
          case 403:
            throw new Error(`Access denied to ${owner}/${apiName}. Check permissions. (${message})`);
          case 404:
            throw new Error(`API not found: ${owner}/${apiName}@${version}. (${message})`);
          default:
            throw new Error(`SwaggerHub API error (${status}): ${message}`);
        }
      }
      throw new Error(`Failed to connect to SwaggerHub: ${error.message}`);
    }
  }

  /**
   * Fetch API metadata (without the full spec)
   * @param {string} owner - API owner
   * @param {string} apiName - API name
   * @returns {object} API metadata
   */
  async fetchApiMetadata(owner, apiName) {
    try {
      const response = await this.http.get(`/apis/${owner}/${apiName}/settings/default`);
      return response.data;
    } catch (error) {
      console.warn(`Could not fetch metadata for ${owner}/${apiName}:`, error.message);
      return null;
    }
  }

  /**
   * List all versions of an API
   * @param {string} owner - API owner
   * @param {string} apiName - API name
   * @returns {Array} List of version strings
   */
  async listVersions(owner, apiName) {
    try {
      const response = await this.http.get(`/apis/${owner}/${apiName}`);
      return response.data?.apis?.map((a) => a.properties?.find((p) => p.type === 'X-Version')?.value) || [];
    } catch (error) {
      console.warn(`Could not list versions for ${owner}/${apiName}:`, error.message);
      return [];
    }
  }
}

module.exports = { SwaggerHubClient };
```

---

## Step 8: Create the Validation Engine

This engine processes the validation results returned by the SwaggerHub Standardization API (`GET /apis/{owner}/{api}/{version}/standardization`). Instead of running Spectral locally, it normalizes the API response into categorized, scored issues for the PDF report.

**How rules are managed:** Validation rules (Spectral rulesets / style guides) are configured in SwaggerHub under Organisation Settings → Standardization. The pipeline fetches the violations via the API — no local Spectral installation needed.

**File: `src/services/validation-engine.js`**
```javascript
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
```

---

## Step 9: Create the Best Practices Rules Reference File

This file documents where validation rules are managed. Rules are now configured in SwaggerHub via the Standardization feature (style guides / Spectral rulesets).

**File: `src/services/rules/best-practices.js`**
```javascript
/**
 * Best Practice Rules Reference
 *
 * NOTE: Validation rules are now managed in SwaggerHub via the
 * Standardization feature (style guide / Spectral rulesets).
 *
 * The validation pipeline fetches rule violations from:
 *   GET /apis/{owner}/{api}/{version}/standardization
 *
 * To customise rules, update your organisation's style guide in
 * SwaggerHub → Organisation Settings → Standardization, or use
 * the Spectral Rulesets API:
 *   GET/PUT /standardization/spectral-rulesets/{owner}/{name}/zip
 *
 * The validation engine (validation-engine.js) then categorises
 * and scores the results returned by SwaggerHub.
 */

module.exports = {};
```

---

## Step 9a: Create the Scan History Service

This service stores and retrieves previous validation results from S3 so we can compare scans and show what changed. Each API's latest scan is saved as a JSON file at `scan-history/{owner}/{apiName}/latest.json`.

**File: `src/services/scan-history-service.js`**
```javascript
/**
 * Scan History Service - Stores and retrieves previous validation results
 *
 * Uses S3 to persist the last scan result for each API so the diff engine
 * can compare current vs previous runs and show what changed.
 *
 * Storage path: scan-history/{owner}/{apiName}/latest.json
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

class ScanHistoryService {
  constructor(awsConfig) {
    this.s3 = new S3Client({ region: awsConfig.region });
    this.bucket = awsConfig.s3Bucket;
  }

  /**
   * Get the S3 key for an API's scan history
   */
  _historyKey(owner, apiName) {
    return `scan-history/${owner}/${apiName}/latest.json`;
  }

  /**
   * Retrieve the previous scan results for an API
   * @param {string} owner - API owner
   * @param {string} apiName - API name
   * @returns {object|null} Previous scan data, or null if no history exists
   */
  async getPreviousScan(owner, apiName) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: this._historyKey(owner, apiName),
      });

      const response = await this.s3.send(command);
      const bodyString = await response.Body.transformToString('utf-8');
      return JSON.parse(bodyString);
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        console.log(`No previous scan found for ${owner}/${apiName} (first scan)`);
        return null;
      }
      console.warn(`Error retrieving scan history for ${owner}/${apiName}:`, error.message);
      return null;
    }
  }

  /**
   * Save the current scan results as the latest for future comparison
   * @param {string} owner - API owner
   * @param {string} apiName - API name
   * @param {string} version - API version
   * @param {object} validationResults - The full validation results object
   */
  async saveCurrentScan(owner, apiName, version, validationResults) {
    const scanData = {
      owner,
      apiName,
      version,
      scannedAt: new Date().toISOString(),
      summary: validationResults.summary,
      issues: validationResults.issues,
    };

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this._historyKey(owner, apiName),
      Body: JSON.stringify(scanData, null, 2),
      ContentType: 'application/json',
      Metadata: {
        'generated-by': 'swaggerhub-validation-report',
        'scan-version': version,
        'scanned-at': scanData.scannedAt,
      },
    });

    await this.s3.send(command);
    console.log(`Scan history saved for ${owner}/${apiName}@${version}`);
  }
}

module.exports = { ScanHistoryService };
```

**How it works:**
- On each validation run, the handler calls `getPreviousScan()` to load the last scan (returns `null` on first run)
- After validation, `saveCurrentScan()` overwrites the `latest.json` so the next run has a baseline
- Uses the same S3 bucket as PDF reports — no additional infrastructure needed

---

## Step 9b: Create the Diff Engine

This compares the current validation results against the previous scan and produces a structured diff showing what was fixed, what's new, and how the score changed.

**File: `src/services/diff-engine.js`**
```javascript
/**
 * Diff Engine - Compares current validation results against a previous scan
 *
 * Produces a structured diff showing:
 * - New issues introduced since the last scan
 * - Issues resolved since the last scan
 * - Score change (delta)
 * - Summary comparison
 */

class DiffEngine {
  /**
   * Compare current validation results against a previous scan
   * @param {object} currentResults - Current validation results (from ValidationEngine)
   * @param {object} previousScan - Previous scan data (from ScanHistoryService), or null
   * @returns {object} Diff report
   */
  compare(currentResults, previousScan) {
    // If there's no previous scan, this is the first run
    if (!previousScan) {
      return {
        isFirstScan: true,
        previousVersion: null,
        previousScannedAt: null,
        scoreChange: 0,
        previousScore: null,
        currentScore: currentResults.summary.score,
        newIssues: [],
        resolvedIssues: [],
        persistingIssues: [],
        summaryDelta: {
          totalIssues: 0,
          errors: 0,
          warnings: 0,
          info: 0,
        },
      };
    }

    const prevIssues = previousScan.issues || [];
    const currIssues = currentResults.issues || [];
    const prevSummary = previousScan.summary || {};
    const currSummary = currentResults.summary || {};

    // Build fingerprints for matching issues
    // An issue is "the same" if it has the same rule code + path
    const prevFingerprints = new Map();
    prevIssues.forEach((issue) => {
      const fp = this._fingerprint(issue);
      prevFingerprints.set(fp, issue);
    });

    const currFingerprints = new Map();
    currIssues.forEach((issue) => {
      const fp = this._fingerprint(issue);
      currFingerprints.set(fp, issue);
    });

    // New issues: in current but not in previous
    const newIssues = [];
    currIssues.forEach((issue) => {
      const fp = this._fingerprint(issue);
      if (!prevFingerprints.has(fp)) {
        newIssues.push(issue);
      }
    });

    // Resolved issues: in previous but not in current
    const resolvedIssues = [];
    prevIssues.forEach((issue) => {
      const fp = this._fingerprint(issue);
      if (!currFingerprints.has(fp)) {
        resolvedIssues.push(issue);
      }
    });

    // Persisting issues: in both
    const persistingIssues = [];
    currIssues.forEach((issue) => {
      const fp = this._fingerprint(issue);
      if (prevFingerprints.has(fp)) {
        persistingIssues.push(issue);
      }
    });

    const previousScore = prevSummary.score != null ? prevSummary.score : null;
    const currentScore = currSummary.score;
    const scoreChange = previousScore != null ? currentScore - previousScore : 0;

    return {
      isFirstScan: false,
      previousVersion: previousScan.version || 'unknown',
      previousScannedAt: previousScan.scannedAt || null,
      scoreChange,
      previousScore,
      currentScore,
      newIssues,
      resolvedIssues,
      persistingIssues,
      summaryDelta: {
        totalIssues: currSummary.totalIssues - (prevSummary.totalIssues || 0),
        errors: currSummary.errors - (prevSummary.errors || 0),
        warnings: currSummary.warnings - (prevSummary.warnings || 0),
        info: currSummary.info - (prevSummary.info || 0),
      },
    };
  }

  /**
   * Create a fingerprint for an issue to identify it across scans.
   * Uses rule code + path as the identity (message can change slightly).
   */
  _fingerprint(issue) {
    return `${issue.code || ''}::${issue.path || ''}`;
  }
}

module.exports = { DiffEngine };
```

**How fingerprinting works:**
- Each issue is identified by its `rule code` + `path` (e.g., `info-contact::info` or `bp-path-casing::paths./petCategories`)
- If the same fingerprint exists in both scans → issue persists
- If it's only in the current scan → new issue
- If it's only in the previous scan → resolved issue
- This approach is robust even when messages change slightly between versions

---

## Step 9c: Create the Structured Logger

This replaces plain `console.log()` with structured JSON logging. In Lambda, every log entry is a single-line JSON object that CloudWatch Insights can query by field (level, event, apiName, score, etc.). In local mode, it falls back to readable text output.

**File: `src/services/logger.js`**
```javascript
/**
 * Structured Logger - JSON-formatted logging for CloudWatch Insights
 *
 * Replaces plain console.log() with structured JSON output so logs can be
 * queried in CloudWatch Insights using fields like:
 *   fields @timestamp, level, event, apiName, owner, score
 *   | filter level = "ERROR"
 *   | sort @timestamp desc
 *
 * In local/test mode, falls back to readable console output.
 */

class Logger {
  constructor(context = {}) {
    this.context = {
      service: 'swaggerhub-validation',
      ...context,
    };
    this.isLocal = process.env.IS_LOCAL === 'true' || !process.env.AWS_LAMBDA_FUNCTION_NAME;
  }

  child(additionalContext) {
    return new Logger({ ...this.context, ...additionalContext });
  }

  info(event, data = {}) {
    this._log('INFO', event, data);
  }

  warn(event, data = {}) {
    this._log('WARN', event, data);
  }

  error(event, data = {}) {
    if (data instanceof Error) {
      data = {
        errorMessage: data.message,
        errorName: data.name,
        stackTrace: data.stack,
      };
    }
    this._log('ERROR', event, data);
  }

  debug(event, data = {}) {
    if (this.isLocal || process.env.LOG_LEVEL === 'DEBUG') {
      this._log('DEBUG', event, data);
    }
  }

  _log(level, event, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...this.context,
      ...data,
    };

    Object.keys(entry).forEach((key) => {
      if (entry[key] === undefined) delete entry[key];
    });

    if (this.isLocal) {
      const prefix = `[${level}]`;
      const dataStr = Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
      console.log(`${prefix} ${event}${dataStr}`);
    } else {
      console.log(JSON.stringify(entry));
    }
  }
}

function createLogger(context) {
  return new Logger(context);
}

module.exports = { Logger, createLogger };
```

**How it works:**
- In Lambda: outputs `{"timestamp":"...","level":"INFO","event":"validation.complete","score":85,...}` — one JSON per line, queryable by CloudWatch Insights
- Locally: outputs `[INFO] validation.complete {"score":85}` — human-friendly
- `child()` creates a new logger that inherits parent context and adds more fields (e.g., requestId → owner → apiName)
- Error objects are automatically destructured into `errorMessage`, `errorName`, `stackTrace`
- DEBUG-level logs are suppressed in production unless `LOG_LEVEL=DEBUG`

---

## Step 9d: Create the CloudWatch Metrics Service

This publishes custom CloudWatch metrics after each validation run so you can build dashboards, set alarms, and track trends over time.

**File: `src/services/metrics-service.js`**
```javascript
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

const NAMESPACE = 'SwaggerHubValidation';

class MetricsService {
  constructor(awsConfig = {}) {
    this.cloudwatch = new CloudWatchClient({ region: awsConfig.region || process.env.AWS_REGION || 'us-east-1' });
    this.enabled = process.env.METRICS_ENABLED !== 'false' && !!process.env.AWS_LAMBDA_FUNCTION_NAME;
    this._buffer = [];
  }

  async recordValidation(params) {
    if (!this.enabled) return;

    const { owner, apiName, version, summary, diff, reportGenTimeMs, totalDurationMs } = params;
    const timestamp = new Date();

    const dimensions = [
      { Name: 'Owner', Value: owner },
      { Name: 'ApiName', Value: apiName },
    ];
    const globalDimensions = [{ Name: 'Service', Value: 'SwaggerHubValidation' }];

    // Per-API metrics
    this._addMetric('ValidationScore', summary.score, 'None', dimensions, timestamp);
    this._addMetric('TotalIssues', summary.totalIssues, 'Count', dimensions, timestamp);
    this._addMetric('ErrorCount', summary.errors, 'Count', dimensions, timestamp);
    this._addMetric('WarningCount', summary.warnings, 'Count', dimensions, timestamp);
    this._addMetric('ValidationPassed', summary.passedValidation ? 1 : 0, 'Count', dimensions, timestamp);

    // Global aggregate metrics
    this._addMetric('ValidationScore', summary.score, 'None', globalDimensions, timestamp);
    this._addMetric('TotalIssues', summary.totalIssues, 'Count', globalDimensions, timestamp);
    this._addMetric('ValidationPassed', summary.passedValidation ? 1 : 0, 'Count', globalDimensions, timestamp);

    // Diff metrics
    if (diff && !diff.isFirstScan) {
      this._addMetric('ScoreChange', diff.scoreChange, 'None', dimensions, timestamp);
      this._addMetric('ResolvedIssues', diff.resolvedIssues.length, 'Count', dimensions, timestamp);
      this._addMetric('NewIssues', diff.newIssues.length, 'Count', dimensions, timestamp);
    }

    // Performance metrics
    if (reportGenTimeMs != null) this._addMetric('ReportGenerationTime', reportGenTimeMs, 'Milliseconds', globalDimensions, timestamp);
    if (totalDurationMs != null) this._addMetric('PipelineDuration', totalDurationMs, 'Milliseconds', globalDimensions, timestamp);

    await this._flush();
  }

  _addMetric(name, value, unit, dimensions, timestamp) {
    this._buffer.push({ MetricName: name, Value: value, Unit: unit, Dimensions: dimensions, Timestamp: timestamp });
  }

  async _flush() {
    const batches = [];
    for (let i = 0; i < this._buffer.length; i += 25) {
      batches.push(this._buffer.slice(i, i + 25));
    }
    for (const batch of batches) {
      try {
        await this.cloudwatch.send(new PutMetricDataCommand({ Namespace: NAMESPACE, MetricData: batch }));
      } catch (error) {
        console.warn('Failed to publish CloudWatch metrics:', error.message);
      }
    }
    this._buffer = [];
  }
}

module.exports = { MetricsService };
```

**Metrics published per run:**

| Metric | Type | Dimensions | Description |
|--------|------|------------|-------------|
| `ValidationScore` | None (0-100) | Owner, ApiName | Quality score |
| `TotalIssues` | Count | Owner, ApiName | Total issues found |
| `ErrorCount` | Count | Owner, ApiName | Errors only |
| `WarningCount` | Count | Owner, ApiName | Warnings only |
| `ValidationPassed` | Count (0/1) | Owner, ApiName | Pass/fail flag |
| `ScoreChange` | None | Owner, ApiName | Delta vs previous scan |
| `ResolvedIssues` | Count | Owner, ApiName | Issues fixed since last scan |
| `NewIssues` | Count | Owner, ApiName | Issues introduced since last scan |
| `ReportGenerationTime` | Milliseconds | Service | PDF generation time |
| `PipelineDuration` | Milliseconds | Service | Total end-to-end time |

**CloudWatch dashboard query examples:**
```
# Average validation score over time
SELECT AVG(ValidationScore) FROM SwaggerHubValidation WHERE Service = 'SwaggerHubValidation' GROUP BY ApiName

# APIs failing validation
SELECT COUNT(ValidationPassed) FROM SwaggerHubValidation WHERE ValidationPassed = 0
```

---

## Step 10: Create the PDF Report Generator

This is the largest file. It uses PDFKit to create a multi-page PDF with a cover page, executive summary, detailed findings, category analysis, and recommendations.

**IMPORTANT NOTE:** The `bufferPages: true` option in the PDFDocument constructor is essential. Without it, the `addFooter()` method (which uses `doc.switchToPage()` to add page numbers to all pages) will crash with "switchToPage out of bounds".

**File: `src/services/report-generator.js`**
```javascript
/**
 * PDF Report Generator
 *
 * Generates a professional, branded PDF validation report using PDFKit.
 * Includes: cover page, executive summary, detailed findings, and recommendations.
 */

const PDFDocument = require('pdfkit');
const config = require('../config');

class ReportGenerator {
  constructor() {
    this.colors = {
      primary: '#1a56db',
      secondary: '#374151',
      error: '#dc2626',
      warning: '#f59e0b',
      info: '#3b82f6',
      hint: '#6b7280',
      success: '#16a34a',
      lightGray: '#f3f4f6',
      white: '#ffffff',
      black: '#111827',
    };
  }

  /**
   * Generate a PDF validation report
   * @param {object} data - Report data (apiName, version, validationResults, etc.)
   * @returns {Promise<Buffer>} PDF file as a buffer
   */
  async generate(data) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          bufferPages: true,
          margins: { top: 60, bottom: 60, left: 50, right: 50 },
          info: {
            Title: `${config.report.reportTitle} - ${data.apiName}`,
            Author: config.report.companyName,
            Subject: 'API Validation Report',
            Creator: 'SwaggerHub Validation Report Generator',
          },
        });

        const buffers = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        // Build the report pages
        this.addCoverPage(doc, data);
        this.addExecutiveSummary(doc, data);
        if (data.diff && !data.diff.isFirstScan) {
          this.addChangesSinceLastScan(doc, data);
        }
        this.addDetailedFindings(doc, data);
        this.addCategorySummary(doc, data);
        this.addRecommendations(doc, data);
        this.addFooter(doc);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Cover Page
   */
  addCoverPage(doc, data) {
    // Background accent bar
    doc.rect(0, 0, 595, 8).fill(this.colors.primary);

    // Title
    doc.moveDown(6);
    doc
      .font('Helvetica-Bold')
      .fontSize(32)
      .fillColor(this.colors.primary)
      .text(config.report.reportTitle, { align: 'center' });

    doc.moveDown(0.5);
    doc
      .font('Helvetica')
      .fontSize(14)
      .fillColor(this.colors.secondary)
      .text('Automated API Specification Analysis', { align: 'center' });

    // Divider line
    doc.moveDown(2);
    const lineY = doc.y;
    doc
      .moveTo(150, lineY)
      .lineTo(445, lineY)
      .strokeColor(this.colors.primary)
      .lineWidth(2)
      .stroke();

    // API Details
    doc.moveDown(2);
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(this.colors.black)
      .text(data.apiName, { align: 'center' });

    doc.moveDown(0.3);
    doc
      .font('Helvetica')
      .fontSize(14)
      .fillColor(this.colors.secondary)
      .text(`Version: ${data.apiVersion}`, { align: 'center' });

    doc.moveDown(0.3);
    doc.text(`Owner: ${data.owner}`, { align: 'center' });

    // Score badge
    doc.moveDown(3);
    const score = data.validationResults.summary.score;
    const scoreColor = score >= 80 ? this.colors.success : score >= 50 ? this.colors.warning : this.colors.error;

    // Score circle
    const centerX = 297.5;
    const centerY = doc.y + 50;
    doc.circle(centerX, centerY, 50).fillAndStroke(scoreColor, scoreColor);
    doc
      .font('Helvetica-Bold')
      .fontSize(36)
      .fillColor(this.colors.white)
      .text(String(score), centerX - 25, centerY - 20, { width: 50, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(10)
      .text('/100', centerX - 25, centerY + 16, { width: 50, align: 'center' });

    doc.y = centerY + 70;
    doc
      .font('Helvetica')
      .fontSize(12)
      .fillColor(this.colors.secondary)
      .text('API Quality Score', { align: 'center' });

    // Pass/Fail status
    doc.moveDown(1);
    const passed = data.validationResults.summary.passedValidation;
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(passed ? this.colors.success : this.colors.error)
      .text(passed ? '✓ PASSED VALIDATION' : '✗ VALIDATION FAILED', { align: 'center' });

    // Footer info
    doc.moveDown(6);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(this.colors.secondary)
      .text(`Generated: ${new Date(data.generatedAt).toLocaleString()}`, { align: 'center' });
    doc.text(`By: ${config.report.companyName}`, { align: 'center' });
  }

  /**
   * Executive Summary Page
   */
  addExecutiveSummary(doc, data) {
    doc.addPage();
    const summary = data.validationResults.summary;

    // Section header
    this.addSectionHeader(doc, 'Executive Summary');

    // Summary stats in a grid
    doc.moveDown(1);
    const statsY = doc.y;
    const colWidth = 120;
    const startX = 55;

    const stats = [
      { label: 'Total Issues', value: summary.totalIssues, color: this.colors.primary },
      { label: 'Errors', value: summary.errors, color: this.colors.error },
      { label: 'Warnings', value: summary.warnings, color: this.colors.warning },
      { label: 'Info', value: summary.info, color: this.colors.info },
    ];

    stats.forEach((stat, i) => {
      const x = startX + i * colWidth;

      // Stat box background
      doc.roundedRect(x, statsY, 105, 65, 5).fill(this.colors.lightGray);

      // Value
      doc
        .font('Helvetica-Bold')
        .fontSize(28)
        .fillColor(stat.color)
        .text(String(stat.value), x + 5, statsY + 8, { width: 95, align: 'center' });

      // Label
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(this.colors.secondary)
        .text(stat.label, x + 5, statsY + 42, { width: 95, align: 'center' });
    });

    doc.y = statsY + 85;

    // Validation overview text
    doc.moveDown(1);
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(this.colors.black)
      .text(this.generateSummaryText(data), { lineGap: 4 });

    // Category breakdown table
    doc.moveDown(1.5);
    this.addSubHeader(doc, 'Issues by Category');
    doc.moveDown(0.5);

    const categories = summary.categories;
    const tableStartY = doc.y;
    let currentY = tableStartY;

    // Table header
    doc.rect(50, currentY, 495, 22).fill(this.colors.primary);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(this.colors.white);
    doc.text('Category', 60, currentY + 6);
    doc.text('Issues', 350, currentY + 6, { width: 60, align: 'center' });
    doc.text('Errors', 410, currentY + 6, { width: 60, align: 'center' });
    doc.text('Warnings', 470, currentY + 6, { width: 70, align: 'center' });
    currentY += 22;

    // Table rows
    Object.entries(categories).forEach(([category, counts], index) => {
      const rowColor = index % 2 === 0 ? this.colors.lightGray : this.colors.white;
      doc.rect(50, currentY, 495, 20).fill(rowColor);

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(this.colors.black);
      doc.text(category, 60, currentY + 5);
      doc.text(String(counts.count), 350, currentY + 5, { width: 60, align: 'center' });

      doc.fillColor(counts.errors > 0 ? this.colors.error : this.colors.black);
      doc.text(String(counts.errors), 410, currentY + 5, { width: 60, align: 'center' });

      doc.fillColor(counts.warnings > 0 ? this.colors.warning : this.colors.black);
      doc.text(String(counts.warnings), 470, currentY + 5, { width: 70, align: 'center' });

      currentY += 20;
    });

    doc.y = currentY + 10;
  }

  /**
   * Detailed Findings Page(s)
   */
  addDetailedFindings(doc, data) {
    doc.addPage();
    this.addSectionHeader(doc, 'Detailed Findings');
    doc.moveDown(0.5);

    const issues = data.validationResults.issues;

    if (issues.length === 0) {
      doc
        .font('Helvetica')
        .fontSize(14)
        .fillColor(this.colors.success)
        .text('🎉 No issues found! Your API specification is clean.', { align: 'center' });
      return;
    }

    issues.forEach((issue, index) => {
      // Check if we need a new page (leave room for the issue block)
      if (doc.y > 700) {
        doc.addPage();
      }

      const issueY = doc.y;
      const severityColor = this.getSeverityColor(issue.severity);

      // Severity indicator bar
      doc.rect(50, issueY, 4, 50).fill(severityColor);

      // Issue number and severity badge
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(this.colors.black)
        .text(`#${index + 1}`, 62, issueY + 2);

      // Severity badge
      const badgeWidth = issue.severity.length * 6 + 12;
      doc.roundedRect(90, issueY, badgeWidth, 16, 3).fill(severityColor);
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(this.colors.white)
        .text(issue.severity.toUpperCase(), 96, issueY + 4);

      // Rule code
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(this.colors.secondary)
        .text(`Rule: ${issue.code}`, 90 + badgeWidth + 8, issueY + 4);

      // Message
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(this.colors.black)
        .text(issue.message, 62, issueY + 20, { width: 470 });

      // Path
      if (issue.path) {
        const messageBottom = doc.y;
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(this.colors.info)
          .text(`Path: ${issue.path}`, 62, messageBottom + 2, { width: 470 });
      }

      doc.y = doc.y + 12;
    });
  }

  /**
   * Category Summary Page
   */
  addCategorySummary(doc, data) {
    doc.addPage();
    this.addSectionHeader(doc, 'Category Analysis');
    doc.moveDown(1);

    const categories = data.validationResults.summary.categories;

    Object.entries(categories).forEach(([category, counts]) => {
      if (doc.y > 720) doc.addPage();

      // Category header
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(this.colors.primary)
        .text(category);

      // Issues bar visualization
      const barY = doc.y + 2;
      const maxBarWidth = 300;
      const maxCount = Math.max(...Object.values(categories).map((c) => c.count));
      const barWidth = maxCount > 0 ? (counts.count / maxCount) * maxBarWidth : 0;

      if (counts.errors > 0) {
        const errorWidth = (counts.errors / counts.count) * barWidth;
        doc.rect(55, barY, errorWidth, 14).fill(this.colors.error);
      }
      if (counts.warnings > 0) {
        const errorWidth = (counts.errors / counts.count) * barWidth;
        const warnWidth = (counts.warnings / counts.count) * barWidth;
        doc.rect(55 + errorWidth, barY, warnWidth, 14).fill(this.colors.warning);
      }
      const otherStart = ((counts.errors + counts.warnings) / counts.count) * barWidth;
      const otherWidth = barWidth - otherStart;
      if (otherWidth > 0) {
        doc.rect(55 + otherStart, barY, otherWidth, 14).fill(this.colors.info);
      }

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(this.colors.black)
        .text(`${counts.count} issues`, 55 + barWidth + 10, barY + 2);

      doc.y = barY + 26;

      // List the relevant issues for this category
      const categoryIssues = data.validationResults.issues.filter((i) => i.category === category);
      categoryIssues.slice(0, 5).forEach((issue) => {
        const bullet = issue.severity === 'Error' ? '●' : issue.severity === 'Warning' ? '▲' : '○';
        const color = this.getSeverityColor(issue.severity);
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(color)
          .text(`  ${bullet} `, 60, doc.y, { continued: true })
          .fillColor(this.colors.black)
          .text(issue.message, { width: 450 });
      });

      if (categoryIssues.length > 5) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(this.colors.secondary)
          .text(`  ... and ${categoryIssues.length - 5} more`, 60);
      }

      doc.moveDown(0.8);
    });
  }

  /**
   * Recommendations Page
   */
  addRecommendations(doc, data) {
    doc.addPage();
    this.addSectionHeader(doc, 'Recommendations');
    doc.moveDown(1);

    const recommendations = this.generateRecommendations(data.validationResults);

    recommendations.forEach((rec, index) => {
      if (doc.y > 720) doc.addPage();

      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(this.colors.primary)
        .text(`${index + 1}. ${rec.title}`);

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(this.colors.black)
        .text(rec.description, { indent: 15, lineGap: 3 });

      if (rec.priority) {
        const priorityColor =
          rec.priority === 'High' ? this.colors.error : rec.priority === 'Medium' ? this.colors.warning : this.colors.info;
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(priorityColor)
          .text(`Priority: ${rec.priority}`, { indent: 15 });
      }

      doc.moveDown(0.8);
    });

    // Closing statement
    doc.moveDown(2);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(this.colors.secondary)
      .text(
        'This report was automatically generated by the API Governance validation pipeline. ' +
          'For questions or to request exceptions, contact the API Governance team.',
        { align: 'center', lineGap: 3 }
      );
  }

  /**
   * Changes Since Last Scan Page — incremental diff section
   * Only included when diff data is available (not the first scan)
   */
  addChangesSinceLastScan(doc, data) {
    doc.addPage();
    this.addSectionHeader(doc, 'Changes Since Last Scan');
    doc.moveDown(1);

    const diff = data.diff;

    // Previous scan info
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(this.colors.secondary)
      .text(`Compared against: version ${diff.previousVersion} (scanned ${new Date(diff.previousScannedAt).toLocaleDateString()})`);
    doc.moveDown(1);

    // Score change banner
    const scoreChangeColor = diff.scoreChange > 0 ? this.colors.success
      : diff.scoreChange < 0 ? this.colors.error
      : this.colors.secondary;
    const scoreArrow = diff.scoreChange > 0 ? '▲' : diff.scoreChange < 0 ? '▼' : '—';
    const scoreSign = diff.scoreChange > 0 ? '+' : '';

    // Score comparison boxes
    const boxY = doc.y;
    // Previous score box
    doc.roundedRect(55, boxY, 140, 60, 5).fill(this.colors.lightGray);
    doc
      .font('Helvetica-Bold')
      .fontSize(24)
      .fillColor(this.colors.secondary)
      .text(String(diff.previousScore), 60, boxY + 8, { width: 130, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(this.colors.secondary)
      .text('Previous Score', 60, boxY + 38, { width: 130, align: 'center' });

    // Arrow
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(scoreChangeColor)
      .text('→', 210, boxY + 12, { width: 40, align: 'center' });

    // Current score box
    const currentScoreColor = diff.currentScore >= 80 ? this.colors.success
      : diff.currentScore >= 50 ? this.colors.warning
      : this.colors.error;
    doc.roundedRect(260, boxY, 140, 60, 5).fill(this.colors.lightGray);
    doc
      .font('Helvetica-Bold')
      .fontSize(24)
      .fillColor(currentScoreColor)
      .text(String(diff.currentScore), 265, boxY + 8, { width: 130, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(this.colors.secondary)
      .text('Current Score', 265, boxY + 38, { width: 130, align: 'center' });

    // Delta badge
    doc.roundedRect(420, boxY + 10, 100, 40, 5).fill(scoreChangeColor);
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(this.colors.white)
      .text(`${scoreArrow} ${scoreSign}${diff.scoreChange}`, 425, boxY + 18, { width: 90, align: 'center' });

    doc.y = boxY + 75;

    // Summary deltas
    doc.moveDown(0.5);
    this.addSubHeader(doc, 'Issue Count Changes');
    doc.moveDown(0.3);
    const deltas = diff.summaryDelta;
    const deltaItems = [
      { label: 'Total Issues', value: deltas.totalIssues },
      { label: 'Errors', value: deltas.errors },
      { label: 'Warnings', value: deltas.warnings },
      { label: 'Informational', value: deltas.info },
    ];
    deltaItems.forEach((item) => {
      const sign = item.value > 0 ? '+' : '';
      const color = item.value > 0 ? this.colors.error
        : item.value < 0 ? this.colors.success
        : this.colors.secondary;
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(this.colors.black)
        .text(`${item.label}: `, 60, doc.y, { continued: true })
        .font('Helvetica-Bold')
        .fillColor(color)
        .text(`${sign}${item.value}`);
    });

    // Resolved issues (green — good news)
    if (diff.resolvedIssues.length > 0) {
      doc.moveDown(1);
      this.addSubHeader(doc, `Resolved Issues (${diff.resolvedIssues.length})`);
      doc.moveDown(0.3);

      diff.resolvedIssues.slice(0, 15).forEach((issue) => {
        if (doc.y > 720) doc.addPage();
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(this.colors.success)
          .text('  ✓ ', 60, doc.y, { continued: true })
          .fillColor(this.colors.black)
          .text(`[${issue.severity}] ${issue.message}`, { width: 450 });
        if (issue.path) {
          doc
            .font('Helvetica')
            .fontSize(8)
            .fillColor(this.colors.info)
            .text(`    Path: ${issue.path}`, 60);
        }
      });
      if (diff.resolvedIssues.length > 15) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(this.colors.secondary)
          .text(`  ... and ${diff.resolvedIssues.length - 15} more resolved`, 60);
      }
    }

    // New issues (red — needs attention)
    if (diff.newIssues.length > 0) {
      doc.moveDown(1);
      this.addSubHeader(doc, `New Issues Introduced (${diff.newIssues.length})`);
      doc.moveDown(0.3);

      diff.newIssues.slice(0, 15).forEach((issue) => {
        if (doc.y > 720) doc.addPage();
        const sevColor = this.getSeverityColor(issue.severity);
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(sevColor)
          .text('  ● ', 60, doc.y, { continued: true })
          .fillColor(this.colors.black)
          .text(`[${issue.severity}] ${issue.message}`, { width: 450 });
        if (issue.path) {
          doc
            .font('Helvetica')
            .fontSize(8)
            .fillColor(this.colors.info)
            .text(`    Path: ${issue.path}`, 60);
        }
      });
      if (diff.newIssues.length > 15) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(this.colors.secondary)
          .text(`  ... and ${diff.newIssues.length - 15} more new issues`, 60);
      }
    }

    // Persisting issues count
    if (diff.persistingIssues.length > 0) {
      doc.moveDown(1);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(this.colors.secondary)
        .text(`${diff.persistingIssues.length} issue(s) remain unchanged from the previous scan.`, 60);
    }

    // Net result summary
    doc.moveDown(1.5);
    const netText = diff.scoreChange > 0
      ? `Overall improvement: score increased by ${diff.scoreChange} point(s).`
      : diff.scoreChange < 0
        ? `Quality decreased: score dropped by ${Math.abs(diff.scoreChange)} point(s). Please review new issues above.`
        : 'No change in overall quality score since the last scan.';
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(scoreChangeColor)
      .text(netText, { align: 'center' });
  }

  // ===================== HELPERS =====================

  addSectionHeader(doc, title) {
    doc.rect(0, doc.y - 5, 595, 35).fill(this.colors.primary);
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor(this.colors.white)
      .text(title, 55, doc.y + 2);
    doc.moveDown(0.3);
  }

  addSubHeader(doc, title) {
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(this.colors.primary)
      .text(title);
  }

  addFooter(doc) {
    // Add page numbers to all pages
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(this.colors.secondary)
        .text(`Page ${i + 1} of ${pages.count}`, 50, 780, { align: 'center' });
      // Bottom accent bar
      doc.rect(0, 834, 595, 8).fill(this.colors.primary);
    }
  }

  getSeverityColor(severity) {
    const map = {
      Error: this.colors.error,
      Warning: this.colors.warning,
      Information: this.colors.info,
      Hint: this.colors.hint,
    };
    return map[severity] || this.colors.secondary;
  }

  generateSummaryText(data) {
    const s = data.validationResults.summary;
    const parts = [];

    parts.push(
      `The API specification "${data.apiName}" (version ${data.apiVersion}) was analyzed against ` +
        `OpenAPI compliance rules and API design best practices.`
    );

    if (s.totalIssues === 0) {
      parts.push('The specification passed all validation checks with no issues detected.');
    } else {
      parts.push(
        `A total of ${s.totalIssues} issue(s) were identified: ` +
          `${s.errors} error(s), ${s.warnings} warning(s), and ${s.info} informational finding(s).`
      );
    }

    if (s.passedValidation) {
      parts.push('The API specification PASSED validation with no critical errors.');
    } else {
      parts.push(
        'The API specification FAILED validation due to critical errors that must be resolved ' +
          'before the API can be approved for production use.'
      );
    }

    return parts.join(' ');
  }

  generateRecommendations(validationResults) {
    const recommendations = [];
    const categories = validationResults.summary.categories;

    if (categories['Spec Compliance']?.errors > 0) {
      recommendations.push({
        title: 'Fix OpenAPI Specification Errors',
        description:
          'Your API specification contains schema errors that violate the OpenAPI standard. ' +
          'These must be fixed to ensure compatibility with API tools and gateways. ' +
          'Use the SwaggerHub editor to identify and correct these issues.',
        priority: 'High',
      });
    }

    if (categories['Documentation']) {
      recommendations.push({
        title: 'Improve API Documentation',
        description:
          'Add missing descriptions, contact information, and licensing details. ' +
          'Well-documented APIs are easier for consumers to understand and integrate with.',
        priority: 'Medium',
      });
    }

    if (categories['Naming Conventions']) {
      recommendations.push({
        title: 'Standardize Naming Conventions',
        description:
          'Ensure all URL paths use kebab-case and operation IDs follow a consistent pattern. ' +
          'Consistent naming improves developer experience and API discoverability.',
        priority: 'Medium',
      });
    }

    if (categories['Response Design']) {
      recommendations.push({
        title: 'Define Complete Response Models',
        description:
          'Ensure all operations define success and error responses with appropriate schemas. ' +
          'Include standard error response models (400, 401, 404, 500) for consistency.',
        priority: 'Medium',
      });
    }

    if (categories['Security']) {
      recommendations.push({
        title: 'Address Security Findings',
        description:
          'Review and remediate security-related findings. Ensure proper authentication schemes ' +
          'are defined and no sensitive data is exposed in the specification.',
        priority: 'High',
      });
    }

    if (categories['Best Practice']) {
      recommendations.push({
        title: 'Adopt API Design Best Practices',
        description:
          'Review the best practice findings and align your API design with organizational standards. ' +
          'This includes proper error handling, consistent patterns, and comprehensive schemas.',
        priority: 'Low',
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        title: 'Maintain Quality Standards',
        description:
          'Your API specification meets all validation criteria. Continue following API design ' +
          'best practices and re-validate whenever changes are made.',
        priority: 'Low',
      });
    }

    return recommendations;
  }
}

module.exports = { ReportGenerator };
```

---

## Step 11: Create the S3 Service

Uploads PDF reports to S3 and generates presigned download URLs.

**File: `src/services/s3-service.js`**
```javascript
/**
 * S3 Service - Stores validation reports in AWS S3
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

class S3Service {
  constructor(awsConfig) {
    this.s3 = new S3Client({ region: awsConfig.region });
    this.bucket = awsConfig.s3Bucket;
  }

  /**
   * Upload a PDF report to S3 and return a presigned download URL
   * @param {string} key - S3 object key (path)
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {string} Presigned URL for downloading the report (valid for 7 days)
   */
  async uploadReport(key, pdfBuffer) {
    // Upload the file
    const putCommand = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      Metadata: {
        'generated-by': 'swaggerhub-validation-report',
        'generated-at': new Date().toISOString(),
      },
    });

    await this.s3.send(putCommand);

    // Generate a presigned URL (valid for 7 days)
    const getCommand = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(this.s3, getCommand, {
      expiresIn: 7 * 24 * 60 * 60, // 7 days
    });

    return presignedUrl;
  }
}

module.exports = { S3Service };
```

---

## Step 12: Create the Email Service

Sends branded HTML emails with the PDF report attached using AWS SES.

**File: `src/services/email-service.js`**
```javascript
/**
 * Email Service - Sends validation reports via AWS SES
 *
 * Sends a branded email with:
 * - Inline validation summary
 * - PDF report as an attachment
 * - Link to the report in S3
 */

const { SESClient, SendRawEmailCommand } = require('@aws-sdk/client-ses');

class EmailService {
  constructor(awsConfig) {
    this.ses = new SESClient({ region: awsConfig.region });
    this.fromEmail = awsConfig.sesFromEmail;
  }

  /**
   * Send a validation report email
   * @param {object} params
   * @param {string} params.recipientEmail - Recipient email address
   * @param {string} params.apiName - Name of the API
   * @param {string} params.apiVersion - Version of the API
   * @param {string} params.owner - API owner
   * @param {string} params.reportUrl - S3 presigned URL for the report
   * @param {Buffer} params.pdfBuffer - PDF file buffer to attach
   * @param {object} params.validationSummary - Validation summary object
   */
  async sendReport(params) {
    const {
      recipientEmail,
      apiName,
      apiVersion,
      owner,
      reportUrl,
      pdfBuffer,
      validationSummary,
    } = params;

    const subject = `API Validation Report: ${apiName} v${apiVersion} - ${
      validationSummary.passedValidation ? 'PASSED ✓' : 'FAILED ✗'
    }`;

    const htmlBody = this.buildEmailHtml(params);
    const textBody = this.buildEmailText(params);
    const rawEmail = this.buildRawEmail({
      from: this.fromEmail,
      to: recipientEmail,
      subject,
      htmlBody,
      textBody,
      pdfBuffer,
      attachmentName: `validation-report-${apiName}-${apiVersion}.pdf`,
    });

    const command = new SendRawEmailCommand({
      RawMessage: { Data: Buffer.from(rawEmail) },
    });

    await this.ses.send(command);
    console.log(`Email sent to ${recipientEmail}`);
  }

  /**
   * Build the HTML email body
   */
  buildEmailHtml(params) {
    const { apiName, apiVersion, owner, reportUrl, validationSummary } = params;
    const s = validationSummary;
    const statusColor = s.passedValidation ? '#16a34a' : '#dc2626';
    const statusText = s.passedValidation ? 'PASSED' : 'FAILED';
    const statusIcon = s.passedValidation ? '✓' : '✗';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: #1a56db; padding: 30px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 22px; }
    .header p { color: #bfdbfe; margin: 5px 0 0; font-size: 14px; }
    .status-banner { background: ${statusColor}; padding: 15px; text-align: center; }
    .status-banner h2 { color: white; margin: 0; font-size: 20px; }
    .content { padding: 30px; }
    .api-info { background: #f9fafb; border-radius: 6px; padding: 15px; margin-bottom: 20px; }
    .api-info h3 { margin: 0 0 8px; color: #374151; font-size: 16px; }
    .api-info p { margin: 3px 0; color: #6b7280; font-size: 14px; }
    .stats { display: flex; text-align: center; margin: 20px 0; }
    .stat { flex: 1; padding: 15px; }
    .stat .value { font-size: 28px; font-weight: bold; }
    .stat .label { font-size: 12px; color: #6b7280; margin-top: 4px; }
    .stat.errors .value { color: #dc2626; }
    .stat.warnings .value { color: #f59e0b; }
    .stat.info .value { color: #3b82f6; }
    .stat.score .value { color: #1a56db; }
    .download-btn { display: inline-block; background: #1a56db; color: white; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold; font-size: 14px; }
    .download-btn:hover { background: #1e40af; }
    .footer { background: #f9fafb; padding: 20px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; }
    .score-badge { display: inline-block; background: ${statusColor}; color: white; padding: 8px 16px; border-radius: 20px; font-size: 16px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th { background: #1a56db; color: white; padding: 8px 12px; text-align: left; font-size: 12px; }
    td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
    tr:nth-child(even) td { background: #f9fafb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>API Validation Report</h1>
      <p>Automated SwaggerHub Spec Analysis</p>
    </div>

    <div class="status-banner">
      <h2>${statusIcon} Validation ${statusText}</h2>
    </div>

    <div class="content">
      <div class="api-info">
        <h3>${apiName}</h3>
        <p><strong>Version:</strong> ${apiVersion}</p>
        <p><strong>Owner:</strong> ${owner}</p>
        <p><strong>Analyzed:</strong> ${new Date().toLocaleString()}</p>
      </div>

      <div style="text-align: center; margin: 20px 0;">
        <span class="score-badge">Quality Score: ${s.score}/100</span>
      </div>

      <!-- Stats Grid -->
      <table>
        <tr>
          <th>Metric</th>
          <th style="text-align: center">Count</th>
        </tr>
        <tr>
          <td>Total Issues</td>
          <td style="text-align: center; font-weight: bold">${s.totalIssues}</td>
        </tr>
        <tr>
          <td style="color: #dc2626">● Errors</td>
          <td style="text-align: center; font-weight: bold; color: #dc2626">${s.errors}</td>
        </tr>
        <tr>
          <td style="color: #f59e0b">▲ Warnings</td>
          <td style="text-align: center; font-weight: bold; color: #f59e0b">${s.warnings}</td>
        </tr>
        <tr>
          <td style="color: #3b82f6">○ Informational</td>
          <td style="text-align: center; font-weight: bold; color: #3b82f6">${s.info}</td>
        </tr>
        <tr>
          <td style="color: #6b7280">◇ Hints</td>
          <td style="text-align: center; font-weight: bold; color: #6b7280">${s.hints}</td>
        </tr>
      </table>

      ${
        Object.keys(s.categories).length > 0
          ? `
      <h3 style="color: #374151; font-size: 14px; margin-top: 25px;">Issues by Category</h3>
      <table>
        <tr>
          <th>Category</th>
          <th style="text-align: center">Issues</th>
          <th style="text-align: center">Errors</th>
        </tr>
        ${Object.entries(s.categories)
          .map(
            ([cat, counts]) => `
        <tr>
          <td>${cat}</td>
          <td style="text-align: center">${counts.count}</td>
          <td style="text-align: center; ${
            counts.errors > 0 ? 'color: #dc2626; font-weight: bold' : ''
          }">${counts.errors}</td>
        </tr>`
          )
          .join('')}
      </table>`
          : ''
      }

      <div style="text-align: center; margin: 30px 0 10px;">
        <p style="margin-bottom: 15px; color: #6b7280; font-size: 13px;">
          The full PDF report is attached to this email.
        </p>
        <a href="${reportUrl}" class="download-btn">Download Full Report</a>
      </div>
    </div>

    <div class="footer">
      <p>This report was automatically generated by the API Governance validation pipeline.</p>
      <p>For questions or exceptions, contact the API Governance team.</p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Build plain text email fallback
   */
  buildEmailText(params) {
    const { apiName, apiVersion, owner, reportUrl, validationSummary } = params;
    const s = validationSummary;

    return [
      `API VALIDATION REPORT`,
      `====================`,
      ``,
      `API: ${apiName}`,
      `Version: ${apiVersion}`,
      `Owner: ${owner}`,
      `Status: ${s.passedValidation ? 'PASSED' : 'FAILED'}`,
      `Score: ${s.score}/100`,
      ``,
      `SUMMARY`,
      `-------`,
      `Total Issues: ${s.totalIssues}`,
      `  Errors:   ${s.errors}`,
      `  Warnings: ${s.warnings}`,
      `  Info:     ${s.info}`,
      `  Hints:    ${s.hints}`,
      ``,
      `Download the full PDF report: ${reportUrl}`,
      ``,
      `(The PDF report is also attached to this email.)`,
      ``,
      `---`,
      `Automated API Governance Validation`,
    ].join('\n');
  }

  /**
   * Build a raw MIME email with PDF attachment
   */
  buildRawEmail({ from, to, subject, htmlBody, textBody, pdfBuffer, attachmentName }) {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const mixedBoundary = `----=_Mixed_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const rawEmail = [
      `From: API Governance <${from}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      ``,
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      textBody,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      htmlBody,
      ``,
      `--${boundary}--`,
      ``,
      `--${mixedBoundary}`,
      `Content-Type: application/pdf; name="${attachmentName}"`,
      `Content-Description: ${attachmentName}`,
      `Content-Disposition: attachment; filename="${attachmentName}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      pdfBuffer.toString('base64').replace(/(.{76})/g, '$1\n'),
      ``,
      `--${mixedBoundary}--`,
    ].join('\r\n');

    return rawEmail;
  }
}

module.exports = { EmailService };
```

---

## Step 13: Create the Local Test Script

This lets you test the validation + PDF generation pipeline locally without needing AWS.

**File: `src/local-test.js`**
```javascript
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
```

---

## Step 14: Create the Environment Variable Template

**File: `.env.example`**
```dotenv
# Environment Variables Configuration
# Copy this file to .env and fill in your values

# ============================================
# SwaggerHub Configuration
# ============================================
# Get your API key from: https://app.swaggerhub.com/settings/apiKey
SWAGGERHUB_API_KEY=your-swaggerhub-api-key-here
SWAGGERHUB_BASE_URL=https://api.swaggerhub.com

# ============================================
# AWS Configuration
# ============================================
AWS_REGION=us-east-1
REPORT_S3_BUCKET=swaggerhub-validation-reports

# ============================================
# Email Configuration (AWS SES)
# ============================================
# Must be a verified SES identity (email or domain)
SES_FROM_EMAIL=noreply@yourdomain.com
DEFAULT_NOTIFY_EMAIL=api-governance@yourdomain.com

# ============================================
# Validation Settings
# ============================================
INCLUDE_BEST_PRACTICES=true
VALIDATION_RULESET=oas

# ============================================
# Report Branding
# ============================================
COMPANY_NAME=API Governance Team
REPORT_TITLE=API Validation Report
COMPANY_LOGO_URL=
```

---

## Step 15: Create the CDK Infrastructure Files

These three files define your entire AWS infrastructure as code.

### 15a: CDK Configuration

**File: `infra/cdk.json`**
```json
{
  "app": "node bin/app.js",
  "context": {
    "@aws-cdk/aws-apigateway:usagePlanKeyOrderInsensitiveId": true,
    "@aws-cdk/core:stackRelativeExports": true,
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true
  }
}
```

### 15b: CDK App Entry Point

**File: `infra/bin/app.js`**
```javascript
#!/usr/bin/env node

/**
 * CDK App Entry Point
 * Deploys the SwaggerHub Validation Report infrastructure
 */

const cdk = require('aws-cdk-lib');
const { SwaggerHubValidationStack } = require('../lib/swaggerhub-validation-stack');

const app = new cdk.App();

new SwaggerHubValidationStack(app, 'SwaggerHubValidationReportStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'SwaggerHub API Validation Report - Automated validation pipeline',
});
```

### 15c: CDK Stack Definition

This is where all the AWS resources are defined: S3 bucket, Lambda function, API Gateway, and IAM permissions.

**File: `infra/lib/swaggerhub-validation-stack.js`**
```javascript
/**
 * AWS CDK Stack - SwaggerHub Validation Report Infrastructure
 *
 * Creates:
 * - API Gateway (receives SwaggerHub webhooks)
 * - Lambda function (validates API specs, generates reports)
 * - S3 bucket (stores PDF reports)
 * - SES identity (sends email reports)
 * - IAM roles and policies
 */

const cdk = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const s3 = require('aws-cdk-lib/aws-s3');
const iam = require('aws-cdk-lib/aws-iam');
const logs = require('aws-cdk-lib/aws-logs');
const path = require('path');

class SwaggerHubValidationStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // ==========================================
    // S3 Bucket for storing PDF reports
    // ==========================================
    const reportBucket = new s3.Bucket(this, 'ReportBucket', {
      bucketName: `swaggerhub-validation-reports-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          // Move reports to Glacier after 90 days for cost-effective long-term archive
          id: 'ArchiveOldReports',
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          // Permanently delete after 365 days
          expiration: cdk.Duration.days(365),
        },
      ],
      versioned: false,
    });

    // ==========================================
    // Lambda Function - Validation Processor
    // ==========================================
    const validationLambda = new lambda.Function(this, 'ValidationLambda', {
      functionName: 'swaggerhub-validation-processor',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'src/handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../'), {
        exclude: [
          'infra',
          'node_modules/.cache',
          '.git',
          '*.md',
          'test',
          '.env*',
          'cdk.out',
        ],
      }),
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: {
        SWAGGERHUB_BASE_URL: 'https://api.swaggerhub.com',
        // SWAGGERHUB_API_KEY is set via SSM Parameter Store or Secrets Manager
        SWAGGERHUB_API_KEY: '',
        REPORT_S3_BUCKET: reportBucket.bucketName,
        SES_FROM_EMAIL: 'noreply@yourdomain.com', // Update this
        DEFAULT_NOTIFY_EMAIL: '', // Update this
        INCLUDE_BEST_PRACTICES: 'true',
        COMPANY_NAME: 'API Governance Team',
        REPORT_TITLE: 'API Validation Report',
        NODE_OPTIONS: '--enable-source-maps',
      },
      logRetention: logs.RetentionDays.THREE_MONTHS,
      description: 'Processes SwaggerHub webhooks, validates API specs, generates PDF reports',
    });

    // Grant Lambda permissions to write to S3
    reportBucket.grantReadWrite(validationLambda);

    // Grant Lambda permissions to send emails via SES
    validationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ses:SendRawEmail', 'ses:SendEmail'],
        resources: ['*'], // Scope this to specific identities in production
      })
    );

    // Grant Lambda permissions to publish CloudWatch custom metrics
    validationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'SwaggerHubValidation',
          },
        },
      })
    );

    // ==========================================
    // API Gateway - Webhook Endpoint
    // ==========================================
    const api = new apigateway.RestApi(this, 'WebhookApi', {
      restApiName: 'SwaggerHub Validation Webhook',
      description: 'Receives SwaggerHub webhook events and triggers API validation',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 10,
        throttlingBurstLimit: 5,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
      },
    });

    // POST /webhook - SwaggerHub webhook endpoint
    const webhookResource = api.root.addResource('webhook');
    const lambdaIntegration = new apigateway.LambdaIntegration(validationLambda, {
      requestTemplates: {
        'application/json': '{ "statusCode": "200" }',
      },
    });
    webhookResource.addMethod('POST', lambdaIntegration, {
      methodResponses: [{ statusCode: '200' }, { statusCode: '500' }],
    });

    // POST /validate - Manual validation endpoint (optional)
    const validateResource = api.root.addResource('validate');
    validateResource.addMethod('POST', lambdaIntegration, {
      methodResponses: [{ statusCode: '200' }, { statusCode: '500' }],
    });

    // ==========================================
    // Outputs
    // ==========================================
    new cdk.CfnOutput(this, 'WebhookUrl', {
      value: `${api.url}webhook`,
      description: 'SwaggerHub Webhook URL - Configure this in SwaggerHub settings',
    });

    new cdk.CfnOutput(this, 'ManualValidateUrl', {
      value: `${api.url}validate`,
      description: 'Manual validation endpoint for testing',
    });

    new cdk.CfnOutput(this, 'ReportBucketName', {
      value: reportBucket.bucketName,
      description: 'S3 bucket where PDF reports are stored',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: validationLambda.functionName,
      description: 'Lambda function name',
    });
  }
}

module.exports = { SwaggerHubValidationStack };
```

---

## Step 16: Install Dependencies

Open a terminal in your `SwaggerHubReport` folder and run:

```
npm install
```

This will download all the packages listed in `package.json` into a `node_modules` folder. It takes about 20-30 seconds.

You will see some deprecation warnings (like `inflight@1.0.6`, `eslint@8` being old) — these are safe to ignore. They come from transitive dependencies and do not affect the application.

---

## Step 17: Test Locally

Run the local test to verify everything works:

```
node src/local-test.js
```

**Expected output:**
```
=== SwaggerHub Validation Report - Local Test ===

1. Running validation...

   Score: 42/100
   Passed: true
   Total Issues: 20
   - Errors:   0
   - Warnings: 19
   - Info:     1
   - Hints:    0

   Issues:
   1. [Warning] OpenAPI "servers" must be present and non-empty array.
   2. [Warning] OpenAPI object must have non-empty "tags" array.
   3. [Warning] Info object must have "contact" object.
   ... (17 more issues)

2. Generating PDF report...

   PDF written to: D:\...\SwaggerHubReport\test-output\validation-report.pdf
   File size: 13.9 KB

=== Test Complete ===
```

Open the `test-output/validation-report.pdf` file to see the generated report. It should have:
- A blue-themed cover page with the API name, a quality score circle (red, 42/100), and "PASSED VALIDATION" status
- An Executive Summary page with stat boxes and a category breakdown table
- A Detailed Findings page listing all 20 issues with severity badges
- A Category Analysis page with colored bar charts
- A Recommendations page with prioritized improvement suggestions
- Page numbers on every page

---

## Step 18: Configure AWS SES (Required for Email)

Before the system can send emails, you must verify your sender email address in AWS SES.

### Option A: Verify a single email address
```
aws ses verify-email-identity --email-address noreply@yourdomain.com --region us-east-1
```
AWS will send a confirmation email to that address. Click the verification link.

### Option B: Verify an entire domain (recommended for production)
```
aws ses verify-domain-identity --domain yourdomain.com --region us-east-1
```
This returns DNS records (TXT, CNAME) that you add to your domain's DNS settings.

### Important: SES Sandbox
New AWS accounts start in the SES "sandbox" where you can only send emails to verified email addresses. To send to anyone:

1. Go to AWS Console → SES → Account Dashboard
2. Click "Request Production Access"
3. Fill in the form (explain your use case, estimated volume, etc.)
4. AWS typically approves within 24 hours

---

## Step 19: Update Configuration for Your Environment

Before deploying, update the following values in `infra/lib/swaggerhub-validation-stack.js`, in the Lambda `environment` section:

1. **`SWAGGERHUB_API_KEY`** — Your SwaggerHub API key (get it from https://app.swaggerhub.com/settings/apiKey)
2. **`SES_FROM_EMAIL`** — The verified email address from Step 18
3. **`DEFAULT_NOTIFY_EMAIL`** — Where reports should be sent if no email is in the webhook payload

---

## Step 20: Deploy to AWS

### 20a: Bootstrap CDK (first time only)

If you've never used CDK in this AWS account/region before, run:
```
cd infra
npx cdk bootstrap
cd ..
```

This creates the CDK staging resources in your AWS account (an S3 bucket and some IAM roles).

### 20b: Deploy the stack

```
npm run deploy
```

Or equivalently:
```
cd infra
npx cdk deploy --all
```

CDK will show you a summary of what it's about to create and ask for confirmation. Type `y` and press Enter.

Deployment takes 2-5 minutes. When done, you'll see outputs like:
```
Outputs:
SwaggerHubValidationReportStack.WebhookUrl = https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/webhook
SwaggerHubValidationReportStack.ManualValidateUrl = https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/validate
SwaggerHubValidationReportStack.ReportBucketName = swaggerhub-validation-reports-123456789012
SwaggerHubValidationReportStack.LambdaFunctionName = swaggerhub-validation-processor
```

**Copy the WebhookUrl** — you'll need it for the next step.

---

## Step 21: Configure SwaggerHub Webhook

1. Log in to SwaggerHub: https://app.swaggerhub.com
2. Go to your **organization settings** (or personal settings)
3. Navigate to **Integrations** → **Webhooks** (or **Add New Integration** → **Webhook**)
4. Create a new webhook with these settings:
   - **Name:** `API Validation Report`
   - **URL:** Paste the `WebhookUrl` from Step 20
   - **Events:** Select "API Created", "API Updated", and/or "API Version Published"
   - **Content Type:** `application/json`
5. Click **Save** (or **Create**)

---

## Step 22: Test the Full Pipeline

### Option A: Test manually with curl

```
curl -X POST https://YOUR-API-GATEWAY-URL/prod/validate -H "Content-Type: application/json" -d "{\"owner\": \"your-swaggerhub-org\", \"apiName\": \"your-api-name\", \"version\": \"1.0.0\", \"notifyEmail\": \"your@email.com\"}"
```

Replace:
- `YOUR-API-GATEWAY-URL` with the URL from Step 20
- `your-swaggerhub-org` with your SwaggerHub organization name
- `your-api-name` with the name of an API in your SwaggerHub
- `your@email.com` with your email address

### Option B: Trigger via SwaggerHub

1. Go to SwaggerHub
2. Edit any API in your organization (or create a new one)
3. Save the API
4. The webhook fires automatically
5. Check your email for the validation report within ~30 seconds

### Checking logs if something goes wrong

```
aws logs tail /aws/lambda/swaggerhub-validation-processor --follow --region us-east-1
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `npm install` fails | Make sure you have Node.js 18+ installed: `node --version` |
| Local test crashes with "Function is not defined" | Make sure `validation-engine.js` imports `truthy` and `pattern` from `@stoplight/spectral-functions` and uses them as direct references (not strings) |
| Local test crashes with "switchToPage out of bounds" | Make sure `report-generator.js` has `bufferPages: true` in the PDFDocument options |
| Lambda timeout | Increase `timeout` in the CDK stack (currently 2 minutes) |
| Email not sent | Check SES is out of sandbox mode, sender email is verified, and recipient email is verified (if still in sandbox) |
| SwaggerHub webhook not firing | Check webhook URL is correct, webhook is enabled, and the right events are selected |
| `cdk deploy` fails with permissions | Make sure `aws configure` has credentials with admin access (or at least IAM, Lambda, API Gateway, S3, SES, CloudFormation permissions) |
| S3 presigned URL expired | URLs expire after 7 days by default. The PDF is still in S3; generate a new presigned URL with the AWS CLI |

---

## Final File Checklist

Verify your project has exactly these files:

```
SwaggerHubReport/
├── .env.example
├── .gitignore
├── package.json
├── src/
│   ├── config.js
│   ├── handler.js
│   ├── local-test.js
│   └── services/
│       ├── diff-engine.js
│       ├── email-service.js
│       ├── logger.js
│       ├── metrics-service.js
│       ├── report-generator.js
│       ├── s3-service.js
│       ├── scan-history-service.js
│       ├── swaggerhub-client.js
│       ├── validation-engine.js
│       └── rules/
│           └── best-practices.js
└── infra/
    ├── cdk.json
    ├── bin/
    │   └── app.js
    └── lib/
        └── swaggerhub-validation-stack.js
```

Total: **18 files** you create manually, plus `node_modules/` and `package-lock.json` are generated by `npm install`.
