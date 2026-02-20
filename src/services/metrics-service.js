/**
 * Metrics Service - Publishes custom CloudWatch metrics
 *
 * Tracks domain-specific metrics for dashboards and alarms:
 * - ValidationScore: Quality score per API (0-100)
 * - IssuesFound: Total issues per scan (dimensions: severity)
 * - ValidationPassed: 1 if passed, 0 if failed
 * - ScoreChange: Delta from previous scan
 * - ReportGenerationTime: Milliseconds to generate PDF
 * - PipelineDuration: Total end-to-end processing time
 *
 * All metrics are published under the "SwaggerHubValidation" namespace.
 * Use CloudWatch dashboards to visualize trends across APIs.
 */

const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

const NAMESPACE = 'SwaggerHubValidation';

class MetricsService {
  constructor(awsConfig = {}) {
    this.cloudwatch = new CloudWatchClient({ region: awsConfig.region || process.env.AWS_REGION || 'us-east-1' });
    this.enabled = process.env.METRICS_ENABLED !== 'false' && !!process.env.AWS_LAMBDA_FUNCTION_NAME;
    this._buffer = [];
  }

  /**
   * Record a validation run's metrics
   * @param {object} params
   * @param {string} params.owner - API owner
   * @param {string} params.apiName - API name
   * @param {string} params.version - API version
   * @param {object} params.summary - Validation summary (score, errors, warnings, etc.)
   * @param {object} [params.diff] - Diff results (scoreChange, resolvedIssues, newIssues)
   * @param {number} [params.reportGenTimeMs] - PDF generation time in milliseconds
   * @param {number} [params.totalDurationMs] - Total pipeline duration in milliseconds
   */
  async recordValidation(params) {
    if (!this.enabled) {
      return; // Skip metrics when running locally
    }

    const { owner, apiName, version, summary, diff, reportGenTimeMs, totalDurationMs } = params;
    const timestamp = new Date();

    const dimensions = [
      { Name: 'Owner', Value: owner },
      { Name: 'ApiName', Value: apiName },
    ];

    const globalDimensions = [
      { Name: 'Service', Value: 'SwaggerHubValidation' },
    ];

    // Per-API metrics
    this._addMetric('ValidationScore', summary.score, 'None', dimensions, timestamp);
    this._addMetric('TotalIssues', summary.totalIssues, 'Count', dimensions, timestamp);
    this._addMetric('ErrorCount', summary.errors, 'Count', dimensions, timestamp);
    this._addMetric('WarningCount', summary.warnings, 'Count', dimensions, timestamp);
    this._addMetric('InfoCount', summary.info, 'Count', dimensions, timestamp);
    this._addMetric('ValidationPassed', summary.passedValidation ? 1 : 0, 'Count', dimensions, timestamp);

    // Global aggregate metrics (no per-API dimensions — for overall dashboards)
    this._addMetric('ValidationScore', summary.score, 'None', globalDimensions, timestamp);
    this._addMetric('TotalIssues', summary.totalIssues, 'Count', globalDimensions, timestamp);
    this._addMetric('ValidationPassed', summary.passedValidation ? 1 : 0, 'Count', globalDimensions, timestamp);

    // Diff metrics (if available)
    if (diff && !diff.isFirstScan) {
      this._addMetric('ScoreChange', diff.scoreChange, 'None', dimensions, timestamp);
      this._addMetric('ResolvedIssues', diff.resolvedIssues.length, 'Count', dimensions, timestamp);
      this._addMetric('NewIssues', diff.newIssues.length, 'Count', dimensions, timestamp);
    }

    // Performance metrics
    if (reportGenTimeMs != null) {
      this._addMetric('ReportGenerationTime', reportGenTimeMs, 'Milliseconds', globalDimensions, timestamp);
    }
    if (totalDurationMs != null) {
      this._addMetric('PipelineDuration', totalDurationMs, 'Milliseconds', globalDimensions, timestamp);
    }

    // Flush all buffered metrics to CloudWatch
    await this._flush();
  }

  /**
   * Add a metric to the internal buffer
   */
  _addMetric(name, value, unit, dimensions, timestamp) {
    this._buffer.push({
      MetricName: name,
      Value: value,
      Unit: unit,
      Dimensions: dimensions,
      Timestamp: timestamp,
    });
  }

  /**
   * Flush buffered metrics to CloudWatch (max 1000 per PutMetricData call,
   * but we batch up to 25 per call as recommended)
   */
  async _flush() {
    const batches = [];
    for (let i = 0; i < this._buffer.length; i += 25) {
      batches.push(this._buffer.slice(i, i + 25));
    }

    for (const batch of batches) {
      try {
        const command = new PutMetricDataCommand({
          Namespace: NAMESPACE,
          MetricData: batch,
        });
        await this.cloudwatch.send(command);
      } catch (error) {
        // Metrics are non-blocking — log but don't fail the pipeline
        console.warn('Failed to publish CloudWatch metrics:', error.message);
      }
    }

    this._buffer = [];
  }
}

module.exports = { MetricsService };
