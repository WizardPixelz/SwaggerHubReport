/**
 * Diff Engine - Compares current validation results against a previous scan
 *
 * Produces a structured diff showing:
 * - New issues introduced since the last scan
 * - Issues resolved since the last scan
 * - Score change (delta)
 * - Summary comparison
 */

class DiffEngine {
  /**
   * Compare current validation results against a previous scan
   * @param {object} currentResults - Current validation results (from ValidationEngine)
   * @param {object} previousScan - Previous scan data (from ScanHistoryService), or null
   * @returns {object} Diff report
   */
  compare(currentResults, previousScan) {
    // If there's no previous scan, this is the first run
    if (!previousScan) {
      return {
        isFirstScan: true,
        previousVersion: null,
        previousScannedAt: null,
        scoreChange: 0,
        previousScore: null,
        currentScore: currentResults.summary.score,
        newIssues: [],
        resolvedIssues: [],
        persistingIssues: [],
        summaryDelta: {
          totalIssues: 0,
          errors: 0,
          warnings: 0,
          info: 0,
        },
      };
    }

    const prevIssues = previousScan.issues || [];
    const currIssues = currentResults.issues || [];
    const prevSummary = previousScan.summary || {};
    const currSummary = currentResults.summary || {};

    // Build fingerprints for matching issues
    // An issue is "the same" if it has the same rule code + path
    const prevFingerprints = new Map();
    prevIssues.forEach((issue) => {
      const fp = this._fingerprint(issue);
      prevFingerprints.set(fp, issue);
    });

    const currFingerprints = new Map();
    currIssues.forEach((issue) => {
      const fp = this._fingerprint(issue);
      currFingerprints.set(fp, issue);
    });

    // New issues: in current but not in previous
    const newIssues = [];
    currIssues.forEach((issue) => {
      const fp = this._fingerprint(issue);
      if (!prevFingerprints.has(fp)) {
        newIssues.push(issue);
      }
    });

    // Resolved issues: in previous but not in current
    const resolvedIssues = [];
    prevIssues.forEach((issue) => {
      const fp = this._fingerprint(issue);
      if (!currFingerprints.has(fp)) {
        resolvedIssues.push(issue);
      }
    });

    // Persisting issues: in both
    const persistingIssues = [];
    currIssues.forEach((issue) => {
      const fp = this._fingerprint(issue);
      if (prevFingerprints.has(fp)) {
        persistingIssues.push(issue);
      }
    });

    const previousScore = prevSummary.score != null ? prevSummary.score : null;
    const currentScore = currSummary.score;
    const scoreChange = previousScore != null ? currentScore - previousScore : 0;

    return {
      isFirstScan: false,
      previousVersion: previousScan.version || 'unknown',
      previousScannedAt: previousScan.scannedAt || null,
      scoreChange,
      previousScore,
      currentScore,
      newIssues,
      resolvedIssues,
      persistingIssues,
      summaryDelta: {
        totalIssues: currSummary.totalIssues - (prevSummary.totalIssues || 0),
        errors: currSummary.errors - (prevSummary.errors || 0),
        warnings: currSummary.warnings - (prevSummary.warnings || 0),
        info: currSummary.info - (prevSummary.info || 0),
      },
    };
  }

  /**
   * Create a fingerprint for an issue to identify it across scans.
   * Uses rule code + path as the identity (message can change slightly).
   */
  _fingerprint(issue) {
    return `${issue.code || ''}::${issue.path || ''}`;
  }
}

module.exports = { DiffEngine };
