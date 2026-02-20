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
    // Spectral ruleset to use: 'oas' for standard OpenAPI rules
    ruleset: process.env.VALIDATION_RULESET || 'oas',
    // Include best-practice rules in addition to spec compliance
    includeBestPractices: process.env.INCLUDE_BEST_PRACTICES !== 'false',
  },

  report: {
    companyName: process.env.COMPANY_NAME || 'API Governance Team',
    companyLogo: process.env.COMPANY_LOGO_URL || '',
    reportTitle: process.env.REPORT_TITLE || 'API Validation Report',
  },
};
