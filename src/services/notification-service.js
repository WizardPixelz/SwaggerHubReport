/**
 * Notification Service - Posts validation results to Microsoft Teams
 *
 * Sends an Adaptive Card to a Teams channel via an incoming webhook URL.
 * No Azure AD, no email server — just a webhook URL from Teams.
 *
 * Setup:
 *   1. In Teams, go to the target channel → Manage channel → Connectors
 *   2. Add "Incoming Webhook" → name it → copy the webhook URL
 *   3. Set the URL as TEAMS_WEBHOOK_URL in your environment
 *
 * The card includes:
 * - Pass/fail status with color coding
 * - Quality score
 * - Issue breakdown (errors, warnings, info)
 * - Diff summary (resolved, new, persisting)
 * - Download button linking to the S3 presigned URL
 */

const axios = require('axios');
const { createLogger } = require('./logger');

const log = createLogger({ component: 'notification-service' });

class NotificationService {
  constructor(notificationConfig) {
    this.webhookUrl = notificationConfig.teamsWebhookUrl;
  }

  /**
   * Send a validation report notification to Teams
   * @param {object} params
   * @param {string} params.apiName - Name of the API
   * @param {string} params.apiVersion - Version of the API
   * @param {string} params.owner - API owner
   * @param {string} params.reportUrl - S3 presigned URL for the PDF
   * @param {object} params.validationSummary - Validation summary object
   * @param {object} [params.diff] - Diff against previous scan (optional)
   */
  async sendReport(params) {
    if (!this.webhookUrl) {
      log.warn('notification.skipped', { reason: 'No Teams webhook URL configured' });
      return;
    }

    const card = this.buildAdaptiveCard(params);

    await axios.post(this.webhookUrl, card, {
      headers: { 'Content-Type': 'application/json' },
    });

    log.info('notification.sent', {
      apiName: params.apiName,
      apiVersion: params.apiVersion,
      channel: 'teams',
    });
  }

  /**
   * Build a Teams Adaptive Card with validation results
   */
  buildAdaptiveCard(params) {
    const { apiName, apiVersion, owner, reportUrl, validationSummary, diff } = params;
    const s = validationSummary;
    const passed = s.passedValidation;
    const statusEmoji = passed ? '✅' : '❌';
    const statusText = passed ? 'PASSED' : 'FAILED';

    // Body elements
    const body = [
      // Header
      {
        type: 'TextBlock',
        size: 'Large',
        weight: 'Bolder',
        text: `${statusEmoji} API Validation Report`,
        wrap: true,
      },
      // API info
      {
        type: 'FactSet',
        facts: [
          { title: 'API', value: apiName },
          { title: 'Version', value: apiVersion },
          { title: 'Owner', value: owner },
          { title: 'Status', value: `**${statusText}**` },
          { title: 'Score', value: `**${s.score}/100**` },
        ],
      },
      // Separator
      {
        type: 'TextBlock',
        text: '---',
        spacing: 'Small',
      },
      // Issue summary
      {
        type: 'TextBlock',
        weight: 'Bolder',
        text: 'Issue Summary',
        spacing: 'Medium',
      },
      {
        type: 'ColumnSet',
        columns: [
          this._statColumn('Total', String(s.totalIssues), 'Default'),
          this._statColumn('Errors', String(s.errors), s.errors > 0 ? 'Attention' : 'Good'),
          this._statColumn('Warnings', String(s.warnings), s.warnings > 0 ? 'Warning' : 'Good'),
          this._statColumn('Info', String(s.info), 'Default'),
        ],
      },
    ];

    // Categories breakdown
    if (s.categories && Object.keys(s.categories).length > 0) {
      body.push({
        type: 'TextBlock',
        weight: 'Bolder',
        text: 'By Category',
        spacing: 'Medium',
      });

      const catFacts = Object.entries(s.categories).map(([cat, counts]) => ({
        title: cat,
        value: `${counts.count} issue(s) (${counts.errors} errors, ${counts.warnings} warnings)`,
      }));

      body.push({ type: 'FactSet', facts: catFacts });
    }

    // Diff section
    if (diff && !diff.isFirstScan) {
      const scoreChangeStr =
        diff.scoreChange > 0
          ? `+${diff.scoreChange} 📈`
          : diff.scoreChange < 0
            ? `${diff.scoreChange} 📉`
            : `±0`;

      body.push(
        {
          type: 'TextBlock',
          text: '---',
          spacing: 'Small',
        },
        {
          type: 'TextBlock',
          weight: 'Bolder',
          text: 'Changes Since Last Scan',
          spacing: 'Medium',
        },
        {
          type: 'FactSet',
          facts: [
            { title: 'Score Change', value: `${diff.previousScore} → ${diff.currentScore} (${scoreChangeStr})` },
            { title: 'Resolved', value: `✅ ${diff.resolvedIssues.length} issue(s)` },
            { title: 'New', value: `🆕 ${diff.newIssues.length} issue(s)` },
            { title: 'Persisting', value: `${diff.persistingIssues.length} issue(s)` },
          ],
        }
      );
    }

    // Timestamp
    body.push({
      type: 'TextBlock',
      text: `Generated: ${new Date().toLocaleString()}`,
      size: 'Small',
      isSubtle: true,
      spacing: 'Medium',
    });

    // Build the Adaptive Card envelope
    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            msteams: {
              width: 'Full',
            },
            body,
            actions: [
              {
                type: 'Action.OpenUrl',
                title: '📄 Download PDF Report',
                url: reportUrl,
              },
            ],
          },
        },
      ],
    };
  }

  /**
   * Build a stat column for the ColumnSet
   */
  _statColumn(label, value, color) {
    return {
      type: 'Column',
      width: 'stretch',
      items: [
        {
          type: 'TextBlock',
          text: value,
          size: 'ExtraLarge',
          weight: 'Bolder',
          horizontalAlignment: 'Center',
          color,
        },
        {
          type: 'TextBlock',
          text: label,
          size: 'Small',
          horizontalAlignment: 'Center',
          isSubtle: true,
          spacing: 'None',
        },
      ],
    };
  }
}

module.exports = { NotificationService };
