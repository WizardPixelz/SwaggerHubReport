/**
 * Scan History Service - Stores and retrieves previous validation results
 *
 * Uses S3 to persist the last scan result for each API so the diff engine
 * can compare current vs previous runs and show what changed.
 *
 * Storage path: scan-history/{owner}/{apiName}/latest.json
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

class ScanHistoryService {
  constructor(awsConfig) {
    this.s3 = new S3Client({ region: awsConfig.region });
    this.bucket = awsConfig.s3Bucket;
  }

  /**
   * Get the S3 key for an API's scan history
   */
  _historyKey(owner, apiName) {
    return `scan-history/${owner}/${apiName}/latest.json`;
  }

  /**
   * Retrieve the previous scan results for an API
   * @param {string} owner - API owner
   * @param {string} apiName - API name
   * @returns {object|null} Previous scan data, or null if no history exists
   */
  async getPreviousScan(owner, apiName) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: this._historyKey(owner, apiName),
      });

      const response = await this.s3.send(command);
      const bodyString = await response.Body.transformToString('utf-8');
      return JSON.parse(bodyString);
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        console.log(`No previous scan found for ${owner}/${apiName} (first scan)`);
        return null;
      }
      console.warn(`Error retrieving scan history for ${owner}/${apiName}:`, error.message);
      return null;
    }
  }

  /**
   * Save the current scan results as the latest for future comparison
   * @param {string} owner - API owner
   * @param {string} apiName - API name
   * @param {string} version - API version
   * @param {object} validationResults - The full validation results object
   */
  async saveCurrentScan(owner, apiName, version, validationResults) {
    const scanData = {
      owner,
      apiName,
      version,
      scannedAt: new Date().toISOString(),
      summary: validationResults.summary,
      issues: validationResults.issues,
    };

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this._historyKey(owner, apiName),
      Body: JSON.stringify(scanData, null, 2),
      ContentType: 'application/json',
      Metadata: {
        'generated-by': 'swaggerhub-validation-report',
        'scan-version': version,
        'scanned-at': scanData.scannedAt,
      },
    });

    await this.s3.send(command);
    console.log(`Scan history saved for ${owner}/${apiName}@${version}`);
  }
}

module.exports = { ScanHistoryService };
