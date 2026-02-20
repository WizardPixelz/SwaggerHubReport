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
          // Auto-delete reports after 90 days
          expiration: cdk.Duration.days(90),
          id: 'DeleteOldReports',
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
      logRetention: logs.RetentionDays.TWO_WEEKS,
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
