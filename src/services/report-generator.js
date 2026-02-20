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
