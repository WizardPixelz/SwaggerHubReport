/**
 * SwaggerHub API Client
 *
 * Interacts with the SwaggerHub Registry API to fetch API specifications.
 * See: https://app.swaggerhub.com/apis/swagger-hub/registry-api/
 */

const axios = require('axios');
const { createLogger } = require('./logger');

class SwaggerHubClient {
  constructor(config) {
    this.baseUrl = config.baseUrl || 'https://api.swaggerhub.com';
    this.apiKey = config.apiKey;
    this.log = createLogger({ component: 'swaggerhub-client' });

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        Accept: 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
    });
  }

  /**
   * Fetch an API specification from SwaggerHub
   * @param {string} owner - API owner (organization or user)
   * @param {string} apiName - Name of the API
   * @param {string} version - API version (or 'latest')
   * @returns {object} The parsed OpenAPI specification
   */
  async fetchApiSpec(owner, apiName, version = 'latest') {
    try {
      let url;
      if (version && version !== 'latest') {
        url = `/apis/${owner}/${apiName}/${version}`;
      } else {
        url = `/apis/${owner}/${apiName}`;
      }

      this.log.info('spec.fetching', { url });

      const response = await this.http.get(url, {
        headers: { Accept: 'application/json' },
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const message = error.response.data?.message || error.message;

        switch (status) {
          case 401:
            throw new Error(`SwaggerHub authentication failed. Check your API key. (${message})`);
          case 403:
            throw new Error(`Access denied to ${owner}/${apiName}. Check permissions. (${message})`);
          case 404:
            throw new Error(`API not found: ${owner}/${apiName}@${version}. (${message})`);
          default:
            throw new Error(`SwaggerHub API error (${status}): ${message}`);
        }
      }
      throw new Error(`Failed to connect to SwaggerHub: ${error.message}`);
    }
  }

  /**
   * Fetch API metadata (without the full spec)
   * @param {string} owner - API owner
   * @param {string} apiName - API name
   * @returns {object} API metadata
   */
  async fetchApiMetadata(owner, apiName) {
    try {
      const response = await this.http.get(`/apis/${owner}/${apiName}/settings/default`);
      return response.data;
    } catch (error) {
      this.log.warn('metadata.fetch-failed', { owner, apiName, errorMessage: error.message });
      return null;
    }
  }

  /**
   * List all versions of an API
   * @param {string} owner - API owner
   * @param {string} apiName - API name
   * @returns {Array} List of version strings
   */
  async listVersions(owner, apiName) {
    try {
      const response = await this.http.get(`/apis/${owner}/${apiName}`);
      return response.data?.apis?.map((a) => a.properties?.find((p) => p.type === 'X-Version')?.value) || [];
    } catch (error) {
      this.log.warn('versions.list-failed', { owner, apiName, errorMessage: error.message });
      return [];
    }
  }
}

module.exports = { SwaggerHubClient };
