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
const config = require('./config');

/**
 * Main Lambda handler - entry point for API Gateway webhook
 */
exports.handler = async (event) => {
  console.log('Received webhook event:', JSON.stringify(event, null, 2));

  try {
    // 1. Parse the SwaggerHub webhook payload
    const webhookPayload = parseWebhookEvent(event);
    console.log('Parsed webhook payload:', JSON.stringify(webhookPayload, null, 2));

    // 2. Fetch the full API spec from SwaggerHub
    const swaggerHubClient = new SwaggerHubClient(config.swaggerHub);
    const apiSpec = await swaggerHubClient.fetchApiSpec(
      webhookPayload.owner,
      webhookPayload.apiName,
      webhookPayload.version
    );
    console.log(`Fetched API spec: ${webhookPayload.owner}/${webhookPayload.apiName}@${webhookPayload.version}`);

    // 3. Validate the API spec
    const validationEngine = new ValidationEngine();
    const validationResults = await validationEngine.validate(apiSpec);
    console.log(`Validation complete: ${validationResults.summary.totalIssues} issues found`);

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
      console.log(`Diff: ${diff.resolvedIssues.length} resolved, ${diff.newIssues.length} new, score ${diff.scoreChange > 0 ? '+' : ''}${diff.scoreChange}`);
    } catch (error) {
      console.warn('Could not compute diff (continuing without it):', error.message);
    }

    // 3c. Save current scan for future comparisons
    try {
      await scanHistoryService.saveCurrentScan(
        webhookPayload.owner,
        webhookPayload.apiName,
        webhookPayload.version,
        validationResults
      );
    } catch (error) {
      console.warn('Could not save scan history (non-blocking):', error.message);
    }

    // 4. Generate PDF report (with diff if available)
    const reportGenerator = new ReportGenerator();
    const pdfBuffer = await reportGenerator.generate({
      apiName: webhookPayload.apiName,
      apiVersion: webhookPayload.version,
      owner: webhookPayload.owner,
      validationResults,
      diff,
      generatedAt: new Date().toISOString(),
    });
    console.log('PDF report generated');

    // 5. Upload report to S3
    const reportKey = `reports/${webhookPayload.owner}/${webhookPayload.apiName}/${webhookPayload.version}/validation-report-${Date.now()}.pdf`;
    const reportUrl = await s3Service.uploadReport(reportKey, pdfBuffer);
    console.log(`Report uploaded to S3: ${reportUrl}`);

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
    console.log('Email sent successfully');

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Validation report generated and delivered',
        reportUrl,
        summary: validationResults.summary,
      }),
    };
  } catch (error) {
    console.error('Error processing webhook:', error);
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
