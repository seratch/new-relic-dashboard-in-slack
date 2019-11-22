const axios = require('axios').default;

class NewRelicRestApi {
    constructor(restApiKey) {
        this.restApiKey = restApiKey;
        this.axiosInstance = axios.create({
            baseURL: 'https://api.newrelic.com/v2',
            timeout: 3000,
            headers: { 'X-Api-Key': this.restApiKey }
        });
    }

    applicationsList() {
        return this.axiosInstance.get('/applications.json')
            .catch(err => {
                console.log(`Got an error while calling New Relic REST API /applications.json - ${err}`)
            });
    }

    applicationHostsList(applicationId) {
        return this.axiosInstance.get(`/applications/${applicationId}/hosts.json`)
            .catch(err => {
                console.log(`Got an error while calling New Relic REST API /applications/{id}/hosts.json - ${err}`)
            });
    }

    alertsViolationsList(applicationId) {
        return this.axiosInstance.get(`/alerts_violations.json`)
            .then(res => {
                if (res.data) {
                    const filtered = res.data.violations.filter((v) => {
                        return v.entity.type === 'Application' && v.entity.id === applicationId;
                    }).slice(0, 10);
                    res.data.violations = filtered;
                }
                return res;
            })
            .catch(err => {
                console.log(`Got an error while calling New Relic REST API /alerts_violations.json - ${err}`)
            });
    }
}

class NewRelicInsightsApi {
    constructor(accountId, queryApiKey) {
        this.queryApiKey = queryApiKey;
        this.axiosInstance = axios.create({
            baseURL: `https://insights-api.newrelic.com/v1/accounts/${accountId}`,
            timeout: 3000,
            headers: { 'X-Query-Key': this.queryApiKey }
        });
    }

    run(query) {
        return this.axiosInstance.get(`/query?nrql=${encodeURI(query)}`)
            .catch(err => {
                console.log(`Got an error while calling New Relic Insights API /query - ${err}`)
            });
    }

}

exports.NewRelicRestApi = NewRelicRestApi;
exports.NewRelicInsightsApi = NewRelicInsightsApi;