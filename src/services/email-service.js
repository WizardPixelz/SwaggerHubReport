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
