/**
 * S3 Service - Stores validation reports in AWS S3
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

class S3Service {
  constructor(awsConfig) {
    this.s3 = new S3Client({ region: awsConfig.region });
    this.bucket = awsConfig.s3Bucket;
  }

  /**
   * Upload a PDF report to S3 and return a presigned download URL
   * @param {string} key - S3 object key (path)
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {string} Presigned URL for downloading the report (valid for 7 days)
   */
  async uploadReport(key, pdfBuffer) {
    // Upload the file
    const putCommand = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      Metadata: {
        'generated-by': 'swaggerhub-validation-report',
        'generated-at': new Date().toISOString(),
      },
    });

    await this.s3.send(putCommand);

    // Generate a presigned URL (valid for 7 days)
    const getCommand = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(this.s3, getCommand, {
      expiresIn: 7 * 24 * 60 * 60, // 7 days
    });

    return presignedUrl;
  }
}

module.exports = { S3Service };
