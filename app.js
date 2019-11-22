const { FileDatabase } = require('./database');
const { NewRelicRestApi, NewRelicInsightsApi } = require('./new-relic');

const database = new FileDatabase();

// --------------------------
// Bolt App
// --------------------------

const { App } = require('@slack/bolt');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

if (process.env.SLACK_APP_DEBUG) {
  app.use(args => {
    console.log(JSON.stringify(args));
    args.next();
  });
}

// --------------------------
// Common Actions
// --------------------------

app.action('view-in-browser-button', ({ ack }) => {
  ack();
});

// --------------------------
// App Home
// --------------------------

app.event('app_home_opened', async ({ event, context }) => {
  const slackUserId = event.user;
  const settings = await database.find(slackUserId);
  const view = await buildAppHome(
    settings ? settings.accountId : undefined,
    settings ? settings.defaultApplicationId : undefined,
    settings && settings.restApiKey ? new NewRelicRestApi(settings.restApiKey) : undefined
  );
  await viewsPublish(app.client, context, slackUserId, view);
});

app.action('select-app-overlay-menu', async ({ ack, body, context }) => {
  ack();
  const slackUserId = body.user.id;
  const applicationId = body.actions[0].selected_option.value;
  const settings = await database.find(slackUserId);
  settings['defaultApplicationId'] = applicationId;
  await database.save(settings);
  const view = await buildAppHome(
    settings.accountId,
    settings.defaultApplicationId,
    new NewRelicRestApi(settings.restApiKey)
  );
  await viewsPublish(app.client, context, slackUserId, view);
});

// --------------------------
// New Relic Settings
// --------------------------

app.action('settings-button', async ({ ack, body, context }) => {
  const slackUserId = body.user.id;
  const settings = await database.find(slackUserId);
  const view = await buildSettingsModal(settings);
  viewsOpen(app.client, context, body.trigger_id, view);
  ack();
});

app.view('settings-modal', async ({ ack, body, context }) => {
  const slackUserId = body.user.id;
  const values = body.view.state.values;
  const accountId = values['input-account-id']['input'].value
  const restApiKey = values['input-rest-api-key']['input'].value
  const queryApiKey = values['input-query-api-key']['input'].value

  console.log(accountId);
  // server-side validation
  const errors = {};
  if (typeof accountId === 'undefined' || !accountId.match(/^\d+$/) ) {
    errors['input-account-id'] = 'Account Id must be a numeric value';
  }
  if (typeof restApiKey === 'undefined' || !restApiKey.match(/^NRRA-\w{42}$/) ) {
    errors['input-rest-api-key'] = 'REST API Key must be in a valid format';
  }
  if (typeof queryApiKey === 'undefined' || !queryApiKey.match(/^NRIQ-\w{32}$/) ) {
    errors['input-query-api-key'] = 'Query API Key must be in a valid format';
  }
  if (Object.entries(errors).length > 0) {
    ack({
      response_action: 'errors',
      errors: errors
    });
    return;
  }

  var settings = await database.find(slackUserId);
  if (typeof settings === 'undefined') {
    settings = {};
  }
  settings['slackUserId'] = slackUserId;
  settings['accountId'] = accountId;
  settings['restApiKey'] = restApiKey;
  settings['queryApiKey'] = queryApiKey;
  await database.save(settings);
  ack();

  const view = await buildAppHome(
    accountId,
    undefined,
    new NewRelicRestApi(restApiKey)
  );
  await viewsPublish(app.client, context, slackUserId, view);
});

app.action('clear-settings-button', async ({ ack, body, context }) => {
  ack();
  const slackUserId = body.user.id;
  await database.delete(slackUserId);
  const view = await buildAppHome(undefined, undefined, undefined);
  await viewsPublish(app.client, context, slackUserId, view);
});

// --------------------------
// NRQL Query Runner
// --------------------------

app.action('query-button', async ({ ack, body, context }) => {
  const slackUserId = body.user.id;
  const settings = await database.find(slackUserId);
  const view = await buildQueryModal(undefined, settings);
  viewsOpen(app.client, context, body.trigger_id, view);
  ack();
});

app.view('query-modal', async ({ ack, body }) => {
  const slackUserId = body.user.id;
  const query = body.view.state.values['input-query']['input'].value
  const settings = await database.find(slackUserId);
  const view = await buildQueryModal(query, settings);
  console.log(JSON.stringify(view));
  ack({
    response_action: 'update',
    view: view
  });
});

// --------------------------
// Internal Methods
// --------------------------

// --------------
// API Calls

function viewsOpen(client, context, trigggerId, view) {
  return client.views.open({
    token: context.botToken,
    trigger_id: trigggerId,
    view: view
  }).then(res => console.log(`Succeeded - ${JSON.stringify(res)}`))
    .catch(err => console.log(`Failed - ${JSON.stringify(err)}`));
}

function viewsPublish(client, context, slackUserId, view) {
  return client.views.publish({
    token: context.botToken,
    user_id: slackUserId,
    view: view
  }).then(res => console.log(`Succeeded - ${JSON.stringify(res)}`))
    .catch(err => console.log(`Failed - ${JSON.stringify(err)}`));
}

// --------------
// Building App Home

function healthStatusEmoji(healthStatus) {
  var healthStatus;
  switch (healthStatus) {
    case 'red':
      healthStatus = 'red_circle';
      break;
    case 'gray':
      healthStatus = 'black_circle';
      break;
    default:
      healthStatus = 'large_blue_circle'
  }
  return healthStatus;
}

async function buildAppHome(accountId, applicationId, newRelic) {
  const blocks = [];
  if (typeof newRelic === 'undefined') {
    // need to set up
    blocks.push(
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*:loud_sound: Unlock your personalized :new-relic: dashboard!*"
        }
      },
      {
        "type": "actions",
        "elements": [
          {
            "type": "button",
            "action_id": "settings-button",
            "style": "primary",
            "text": {
              "type": "plain_text",
              "text": "Enable Now",
            }
          }
        ]
      }
    );
    return {
      "type": "home",
      "blocks": blocks
    };
  }

  blocks.push(
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*:new-relic: New Relic Dashboard :new-relic:*"
      },
      "accessory": {
        "type": "button",
        "action_id": "clear-settings-button",
        "style": "danger",
        "text": {
          "type": "plain_text",
          "text": "Clear Settings"
        },
        "confirm": {
          "title": {
            "type": "plain_text",
            "text": "Clear Settings"
          },
          "text": {
            "type": "plain_text",
            "text": "Are you sure?"
          }
        }
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": ":pencil: Query Runner"
          },
          "action_id": "query-button"
        }
      ]
    },
    {
      "type": "divider"
    },
  );

  var applications = [];
  try {
    const appsResponse = await newRelic.applicationsList();
    applications = appsResponse.data.applications;
  } catch (e) {
    console.error(`Failed to call New Relic API - ${e}`)
  }
  if (applications.length == 0) {
    return {
      "type": "home",
      "blocks": blocks
    };
  }

  blocks.push(
    {
      "type": "section",
      "text": {
        "type": "plain_text",
        "text": "Select Application :arrow_right:"
      },
      "accessory": {
        "type": "overflow",
        "action_id": "select-app-overlay-menu",
        "options": applications.map((app) => {
          return {
            "text": {
              "type": "plain_text",
              "text": app.name
            },
            "value": `${app.id}`
          };
        })
      }
    }
  );

  let app = applications[0];
  if (applicationId) {
    const matched = applications.filter((a) => { return a.id.toString() === applicationId });
    if (matched.length > 0) {
      app = matched[0];
    }
  }

  blocks.push(
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*:mag: Application*"
      }
    },
    {
      "type": "divider"
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `Name: *${app.name}*\nLanguage: *:${app.language}:*\nHealth Status: *:${healthStatusEmoji(app.health_status)}:*\nLast Reported: *${app.last_reported_at ? app.last_reported_at : '-'}*`
      },
      "accessory": {
        "type": "button",
        "text": {
          "type": "plain_text",
          "text": "View in browser"
        },
        "action_id": "view-in-browser-button",
        "url": "https://rpm.newrelic.com/accounts/368722/applications/392481444"
      }
    }
  );

  const hostsResponse = await newRelic.applicationHostsList(app.id);
  const hosts = hostsResponse.data.applicationHosts;
  if (hosts && hosts.length > 0) {
    blocks.push(
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*:electric_plug: Hosts*"
        }
      },
      {
        "type": "divider"
      },
      {
        "type": "section",
        "fields": hosts.map((host) => {
          return {
            "type": "mrkdwn",
            "text": `Host: *${host.host}*\nHealth Status: *:${healthStatusEmoji(host.health_status)}:*`
          }
        }),
      }
    );
  }

  const violationsResponse = await newRelic.alertsViolationsList(app.id);
  const violations = violationsResponse.data.violations;
  if (violations && violations.length > 0) {
    blocks.push(
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": "*:warning: Alert Violations*"
        },
        "accessory": {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "View in browser"
          },
          "action_id": "view-in-browser-button",
          "url": `https://rpm.newrelic.com/accounts/${accountId}/applications/${app.id}/violations`
        }
      },
      {
        "type": "divider"
      },
      {
        "type": "section",
        "fields": violations.map((v) => {
          return {
            "type": "mrkdwn",
            "text": `Priority: *${v.priority}*\nViolation: *${v.label}*\nOpened: *${v.opened_at}*`
          };
        }),
      }
    );
  }

  return {
    "type": "home",
    "blocks": blocks
  };
}

// --------------
// Building Modals

async function buildQueryModal(givenQuery, settings) {
  const fullQuery = "SELECT name, host, duration, timestamp FROM Transaction SINCE 30 MINUTES AGO";
  const defaultQuery = (settings && settings.defaultApplicationId) ? `${fullQuery} WHERE appId = ${settings.defaultApplicationId}` : fullQuery;
  const query = givenQuery ? givenQuery : defaultQuery;

  const blocks = [
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "NRQL: New Relic Query Language"
          },
          "action_id": "view-in-browser-button",
          "url": "https://docs.newrelic.com/docs/query-data/nrql-new-relic-query-language/getting-started/nrql-syntax-components-functions"
        }
      ]
    },
    {
      "type": "input",
      "block_id": "input-query",
      "label": {
        "type": "plain_text",
        "text": "Query (NRQL)"
      },
      "element": {
        "type": "plain_text_input",
        "action_id": "input",
        "placeholder": {
          "type": "plain_text",
          "text": "Write an NRQL query here"
        },
        "initial_value": query,
        "multiline": true
      },
      "optional": false
    },
  ];

  let queryResponse;
  if (settings.queryApiKey) {
    const api = new NewRelicInsightsApi(settings.accountId, settings.queryApiKey);
    queryResponse = await api.run(query);
  }
  if (queryResponse && queryResponse.data) {
    const results = queryResponse.data.results;
    if (results.length == 1 && results[0].events) {
      const events = results[0].events;
      if (events.length == 0) {
        blocks.push(
          {
            "type": "divider"
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "No data found."
            }
          },
        );
      } else {
        for (const e of events.slice(0, 20)) {
          const keys = Object.keys(e).slice(0, 10);
          blocks.push(
            {
              "type": "divider"
            },
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": keys.map((key) => { return `${key}: *${e[key]}*` }).join('\n')
              }
            },
          );
        }
      }
    } else {
      const e = results[0];
      for (const key in e) {
        blocks.push(
          {
            "type": "divider"
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": `${key}: *${e[key]}*`
            }
          },
        );
      }
    }
  }

  blocks.push(
    {
      "type": "divider"
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "View in browser"
          },
          "action_id": "view-in-browser-button",
          "url": `https://insights.newrelic.com/accounts/${settings.accountId}/query?query=${encodeURIComponent(query)}`
        }
      ]
    }
  );

  return {
    "type": "modal",
    "title": {
      "type": "plain_text",
      "text": "Insights Query Runner",
      "emoji": false
    },
    "submit": {
      "type": "plain_text",
      "text": "Run",
      "emoji": false
    },
    "close": {
      "type": "plain_text",
      "text": "Close",
      "emoji": false
    },
    "blocks": blocks,
    "callback_id": "query-modal"
  };
}

async function buildSettingsModal(settings) {
  return {
    "type": "modal",
    "title": {
      "type": "plain_text",
      "text": "New Relic Settings",
      "emoji": false
    },
    "submit": {
      "type": "plain_text",
      "text": "Save",
      "emoji": false
    },
    "close": {
      "type": "plain_text",
      "text": "Close",
      "emoji": false
    },
    "blocks": [
      {
        "type": "input",
        "block_id": "input-account-id",
        "label": {
          "type": "plain_text",
          "text": "Account Id"
        },
        "element": {
          "type": "plain_text_input",
          "action_id": "input",
          "placeholder": {
            "type": "plain_text",
            "text": "Check rpm.newrelic.com/accounts/"
          },
          "multiline": false,
          "initial_value": settings ? settings.accountId : undefined
        },
        "optional": false
      },
      {
        "type": "input",
        "block_id": "input-rest-api-key",
        "label": {
          "type": "plain_text",
          "text": "REST API Key"
        },
        "element": {
          "type": "plain_text_input",
          "action_id": "input",
          "placeholder": {
            "type": "plain_text",
            "text": "Check rpm.newrelic.com/accounts/{id}/integrations?page=api_keys"
          },
          "initial_value": settings && settings.restApiKey ? settings.restApiKey : "NRRA-",
          "multiline": false
        },
        "optional": false
      },
      {
        "type": "input",
        "block_id": "input-query-api-key",
        "label": {
          "type": "plain_text",
          "text": "Insights Query API Key"
        },
        "element": {
          "type": "plain_text_input",
          "action_id": "input",
          "placeholder": {
            "type": "plain_text",
            "text": "Check insights.newrelic.com/accounts/{id}}/manage/api_keys"
          },
          "initial_value": settings && settings.queryApiKey ? settings.queryApiKey : "NRIQ-",
          "multiline": false
        },
        "optional": false
      }
    ],
    "callback_id": "settings-modal"
  };
}

// --------------------------
// Start the app ⚡️
// --------------------------

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();
