# Personalized New Relic Dashboard App in Slack

This tiny Bolt ⚡️ app demonstrates how to build Slack apps utilizing Slack's new features and New Relic APIs. This app displays the list of New Relic applications and Slack users can choose one to check from the list. Also, users can run NRQL (New Relic Query Language) queries in modals (=without leaving Slack).

<img src="https://github.com/seratch/new-relic-dashboard-in-slack/raw/master/images/new-relic-dashboard.gif" width=600 />

## App Home

Slack apps can leverage any of [Block Kit](https://api.slack.com/block-kit), [a collection of powerful built-in UI components](https://api.slack.com/tools/block-kit-builder?mode=appHome), to make
[Home Tab](https://api.slack.com/surfaces/tabs) not only informative, furthermore interactive. This app illustrates how to build a kind of dashboard UI and also place buttons and drop-down menus in a user-friendly manner.

<img src="https://github.com/seratch/new-relic-dashboard-in-slack/raw/master/images/home.png" width=600 />

## Modals

Modals are dynamic and interactive space for collecting data from Slack users and displaying information. Needless to say, we can use [Block Kit](https://api.slack.com/tools/block-kit-builder?mode=modal) in modals. In addition, [Input blocks](https://api.slack.com/reference/block-kit/blocks#input) are available only in modals.

<img src="https://github.com/seratch/new-relic-dashboard-in-slack/raw/master/images/query-modal.png" width=600 />

# Local Development

```bash
export SLACK_BOT_TOKEN=xoxb-xxx-yyy
export SLACK_SIGNING_SECRET=abc
npm i
npm run local
```

```bash
docker build -t new-relic-app
docker run  -e SLACK_BOT_TOKEN=xoxb-xxx-yyy -e SLACK_SIGNING_SECRET=abc -it new-relic-app
```

# Deployment

If you prefer using a real database, feel free to fork this repository 👍

* Create and deploy a Docker container
* [![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/seratch/new-relic-dashboard-in-slack/tree/master)

# Resources

* [Slack - Home Tab](https://api.slack.com/surfaces/tabs)
* [Slack - Modals](https://api.slack.com/block-kit/surfaces/modals)
* [New Relic REST API](https://docs.newrelic.com/docs/apis/rest-api-v2)
* [New Relic Insights API](https://docs.newrelic.com/docs/insights/insights-api)

# License

The MIT License
