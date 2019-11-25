const axios = require('axios').default;

// https://docs.newrelic.com/docs/apis/get-started/intro-apis/introduction-new-relic-apis
// https://rpm.newrelic.com/api/explore
class NewRelicRestApi {
    constructor(restApiKey, logger, debugMode) {
        this.restApiKey = restApiKey;
        this.axiosInstance = axios.create({
            baseURL: 'https://api.newrelic.com/v2',
            timeout: 3000,
            headers: { 'X-Api-Key': this.restApiKey }
        });
        this.logger = logger;
        this.debugMode = debugMode;
    }

    applicationsList() {
        const uri = '/applications.json';
        return this.axiosInstance.get(uri)
            .then(res => {
                if (this.debugMode && res.data) {
                    this.logger.debug(`Response data from New Relic REST API ${uri}\n\n${JSON.stringify(res.data)}\n`);
                }
                return res;
            })
            .catch(err => {
                this.logger.error(`Got an error while calling New Relic REST API ${uri} - ${err}`)
            });
    }

    applicationHostsList(applicationId) {
        const uri = `/applications/${applicationId}/hosts.json`;
        return this.axiosInstance.get(uri)
            .then(res => {
                if (this.debugMode && res.data) {
                    this.logger.debug(`Response data from New Relic REST API ${uri}\n\n${JSON.stringify(res.data)}\n`);
                }
                return res;
            })
            .catch(err => {
                this.logger.error(`Got an error while calling New Relic REST API ${uri} - ${err}`)
            });
    }

    alertsViolationsList(applicationId) {
        const uri = `/alerts_violations.json`;
        return this.axiosInstance.get(uri)
            .then(res => {
                if (res.data) {
                    if (this.debugMode) {
                        this.logger.debug(`Response data from New Relic REST API ${uri}\n\n${JSON.stringify(res.data)}\n`);
                    }
                    const filtered = res.data.violations.filter((v) => {
                        return v.entity.type === 'Application' && v.entity.id === applicationId;
                    }).slice(0, 10);
                    res.data.violations = filtered;
                }
                return res;
            })
            .catch(err => {
                this.logger.error(`Got an error while calling New Relic REST API ${uri} - ${err}`)
            });
    }
}

// https://docs.newrelic.com/docs/insights/insights-api
class NewRelicInsightsApi {
    constructor(accountId, queryApiKey, logger, debugMode) {
        this.queryApiKey = queryApiKey;
        this.axiosInstance = axios.create({
            baseURL: `https://insights-api.newrelic.com/v1/accounts/${accountId}`,
            timeout: 3000,
            headers: { 'X-Query-Key': this.queryApiKey }
        });
        this.logger = logger;
        this.debugMode = debugMode;
    }

    run(query) {
        const uri = `/query?nrql=${encodeURIComponent(query)}`;
        return this.axiosInstance.get(uri)
            .then(res => {
                if (this.debugMode && res.data) {
                    this.logger.debug(`Response data from New Relic Insights API ${uri}\n\n${JSON.stringify(res.data)}\n`);
                }
                return res;
            })
            .catch(err => {
                this.logger.error(`Got an error while calling New Relic Insights API ${uri} - ${err}`)
            });
    }
}

exports.NewRelicRestApi = NewRelicRestApi;
exports.NewRelicInsightsApi = NewRelicInsightsApi;