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
