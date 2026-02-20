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
