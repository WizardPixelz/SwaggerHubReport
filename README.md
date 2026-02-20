# SwaggerHub API Validation Report Generator

Automated pipeline that validates OpenAPI specifications from SwaggerHub and delivers professional PDF validation reports via email.

## Architecture

```
SwaggerHub Webhook → API Gateway → Lambda → Spectral Validation → PDF Report → S3 + SES Email
```

```
┌──────────────┐     ┌───────────────┐     ┌──────────────────────────────────┐
│  SwaggerHub  │────>│ API Gateway   │────>│         Lambda Function          │
│  (Webhook)   │     │ POST /webhook │     │                                  │
└──────────────┘     └───────────────┘     │  1. Fetch spec from SwaggerHub   │
                                           │  2. Validate with Spectral       │
                                           │  3. Generate PDF report          │
                                           │  4. Upload to S3                 │
                                           │  5. Send email via SES           │
                                           └──────────┬───────────┬───────────┘
                                                      │           │
                                                      ▼           ▼
                                               ┌──────────┐ ┌─────────┐
                                               │  S3      │ │   SES   │
                                               │ (Reports)│ │ (Email) │
                                               └──────────┘ └─────────┘
```

## Features

- **OpenAPI Compliance Validation** — Validates against OAS 2.0/3.x standards using Spectral
- **Best Practice Analysis** — Checks naming conventions, documentation, response design, error handling
- **Professional PDF Reports** — Branded reports with cover page, executive summary, detailed findings, and recommendations
- **Quality Scoring** — 0-100 score based on error severity
- **Email Delivery** — HTML email with summary + PDF attachment via AWS SES
- **S3 Storage** — Reports stored with presigned download URLs (auto-expire after 90 days)
- **Serverless** — Runs on AWS Lambda, auto-scales, pay-per-use

## Project Structure

```
├── src/
│   ├── handler.js                      # Lambda entry point
│   ├── config.js                       # Environment-based configuration
│   ├── local-test.js                   # Local testing script
│   └── services/
│       ├── swaggerhub-client.js        # SwaggerHub API integration
│       ├── validation-engine.js        # Spectral-based linting engine
│       ├── report-generator.js         # PDF report builder (PDFKit)
│       ├── s3-service.js               # S3 upload + presigned URLs
│       ├── email-service.js            # SES email with attachments
│       └── rules/
│           └── best-practices.js       # Custom API design rules
├── infra/
│   ├── cdk.json                        # CDK configuration
│   ├── bin/app.js                      # CDK app entry point
│   └── lib/
│       └── swaggerhub-validation-stack.js  # CDK stack definition
├── .env.example                        # Environment variable template
└── package.json
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Test Locally

Run the validation pipeline against a sample API spec:

```bash
npm run test:local
```

This generates a test PDF at `test-output/validation-report.pdf`.

### 3. Deploy to AWS

#### Prerequisites
- AWS CLI configured with credentials
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- Node.js 18+

#### Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

#### Deploy

```bash
# Bootstrap CDK (first time only)
cd infra && npx cdk bootstrap

# Deploy the stack
npm run deploy
```

After deployment, CDK outputs the webhook URL:

```
Outputs:
SwaggerHubValidationReportStack.WebhookUrl = https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/webhook
```

### 4. Configure SwaggerHub Webhook

1. Go to your SwaggerHub organization settings
2. Navigate to **Integrations** → **Webhooks**
3. Add a new webhook:
   - **Name**: API Validation Report
   - **URL**: *(paste the WebhookUrl from CDK output)*
   - **Events**: API Created, API Updated, API Version Published
   - **Content Type**: `application/json`
4. Save

Now every time an API is created or updated in SwaggerHub, the validation pipeline runs automatically.

### 5. Configure AWS SES

Before the system can send emails, you need to verify your sender identity in SES:

```bash
# Verify an email address
aws ses verify-email-identity --email-address noreply@yourdomain.com

# Or verify an entire domain (recommended for production)
aws ses verify-domain-identity --domain yourdomain.com
```

> **Note**: New AWS accounts start in the SES sandbox. You'll need to request production access to send to unverified recipients. See [Moving out of the SES sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

## Manual Validation

You can also trigger validation manually by calling the `/validate` endpoint:

```bash
curl -X POST https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod/validate \
  -H "Content-Type: application/json" \
  -d '{
    "owner": "my-org",
    "apiName": "my-api",
    "version": "1.0.0",
    "notifyEmail": "developer@example.com"
  }'
```

## Validation Rules

### OpenAPI Compliance (Spectral OAS Ruleset)
| Rule | Description |
|------|-------------|
| `oas3-schema` | Validates against the OpenAPI 3.x JSON Schema |
| `oas3-valid-schema-example` | Examples must match their schemas |
| `operation-operationId` | Operations should have an operationId |
| `operation-description` | Operations should have descriptions |
| `info-contact` | API info must include contact |
| `info-description` | API info must have a description |
| `path-params` | Path parameters must be properly defined |

### Best Practice Rules (Custom)
| Rule | Description | Severity |
|------|-------------|----------|
| `bp-path-casing` | URL paths should use kebab-case | Warning |
| `bp-request-body-required` | POST/PUT/PATCH should have request bodies | Warning |
| `bp-response-descriptions` | All responses need descriptions | Warning |
| `bp-parameter-descriptions` | Parameters should have descriptions | Info |
| `bp-error-response-schema` | Operations should define error responses | Warning |
| `bp-tags-description` | Tags should have descriptions | Info |
| `bp-info-contact-complete` | Contact should have name and email | Info |

## Quality Score

The report includes an API quality score (0-100):

| Finding | Deduction |
|---------|-----------|
| Error | -10 points |
| Warning | -3 points |
| Information | -1 point |
| Hint | 0 points |

- **80-100**: Good — Minor improvements recommended
- **50-79**: Needs Work — Several issues to address
- **0-49**: Critical — Significant problems must be fixed

## Customization

### Add Custom Rules

Edit `src/services/rules/best-practices.js` to add organization-specific rules following the Spectral rule format.

### Modify Report Branding

Update these environment variables:
- `COMPANY_NAME` — Organization name in the report footer
- `REPORT_TITLE` — Title on the cover page
- `COMPANY_LOGO_URL` — URL to your logo image

### Adjust Validation Behavior

- Set `INCLUDE_BEST_PRACTICES=false` to only check OAS compliance
- Modify severity scores in `validation-engine.js` → `calculateScore()`

## Cost Estimate (AWS)

| Service | Free Tier | Est. Cost (1000 validations/month) |
|---------|-----------|-------------------------------------|
| Lambda | 1M requests/month | ~$0.00 |
| API Gateway | 1M calls/month | ~$3.50 |
| S3 | 5GB storage | ~$0.02 |
| SES | 62,000 emails/month | ~$0.10 |
| **Total** | | **~$3.62/month** |

## License

MIT
