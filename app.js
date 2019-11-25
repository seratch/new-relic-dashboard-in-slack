// ---------------------------------------------------
// Personalized New Relic Dashboard in Slack
//
// The MIT License
// Copyright 2019 Kazuhiro Sera @seratch
// ---------------------------------------------------

const { FileDatabase } = require('./database');
const { NewRelicRestApi, NewRelicInsightsApi } = require('./new-relic-api');

// Database to store New Relic crednetials and NRQL queries
const database = new FileDatabase();

// Enable New Relic Agent for this app (optional)
const newRelicAgentEnabled = process.env.SLACK_APP_NEW_RELIC_AGENT_ENABLED === '1';
if (newRelicAgentEnabled) {
  // Also need to configure the following env variables:
  // - SLACK_APP_NEW_RELIC_APP_NAME
  // - SLACK_APP_NEW_RELIC_LICENSE_KEY
  require('newrelic');
}

// --------------------------
// Bolt App
// --------------------------

const { App } = require('@slack/bolt');
const { ConsoleLogger, LogLevel } = require('@slack/logger');

// ConsoleLogger is the default logger. You can go with your own implementation of 
// https://github.com/slackapi/node-slack-sdk/blob/%40slack/logger%402.0.0/packages/logger/src/index.ts#L14-L63
const logger = new ConsoleLogger();

const debugMode = process.env.SLACK_APP_DEBUG === '1';
const logLevel = debugMode ? LogLevel.DEBUG : LogLevel.INFO;

const app = new App({
  logger: logger,
  logLevel: logLevel,
  // Setting a token here means this app runs in a specific single workspace.
  // https://api.slack.com/apps/{app id}/install-on-team
  token: process.env.SLACK_BOT_TOKEN,
  // You can find this value at https://api.slack.com/apps/{app id}/general.
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

if (debugMode) {
  // Request body dumper - a simple Bolt middleware example
  app.use(args => {
    logger.debug(`Dumping request body for debugging...\n\n${JSON.stringify(args)}\n`);
    args.next();
  });
}

// --------------------------
// Common Actions
// --------------------------

// Receives requests sent by clicking "View in browser" buttons
app.action('view-in-browser-button', ({ ack }) => {
  ack();
});

// --------------------------
// App Home
// --------------------------

// Handles events triggered when a user has entered the App Home.
// App Home: https://api.slack.com/surfaces/tabs/using
// Event: https://api.slack.com/events/app_home_opened
app.event('app_home_opened', async ({ event, context }) => {
  const slackUserId = event.user;
  const settings = await database.findSettings(slackUserId);

  // Build a Home tab - https://api.slack.com/surfaces/tabs/using
  const view = await buildAppHome(
    settings ? settings.accountId : undefined,
    settings ? settings.defaultApplicationId : undefined,
    settings && settings.restApiKey ? new NewRelicRestApi(settings.restApiKey, logger, debugMode) : undefined
  );

  // Send the Home tab via views.publish - https://api.slack.com/methods/views.publish
  await callViewsApi(app.client, 'publish', {
    token: context.botToken,
    user_id: slackUserId,
    view: view
  });
});

// Handles requests sent by selecting a New Relic Application from the overlay menu in the middle of Home tab
// https://api.slack.com/reference/block-kit/block-elements#overflow
app.action('select-app-overlay-menu', async ({ ack, body, context }) => {
  ack();
  const slackUserId = body.user.id;
  const applicationId = body.actions[0].selected_option.value;

  const settings = await database.findSettings(slackUserId);
  settings['defaultApplicationId'] = applicationId;
  await database.saveSettings(settings); // update defaultApplicationId

  const view = await buildAppHome(
    settings.accountId,
    settings.defaultApplicationId,
    new NewRelicRestApi(settings.restApiKey, logger, debugMode)
  );

  await callViewsApi(app.client, 'publish', {
    token: context.botToken,
    user_id: slackUserId,
    view: view
  });
});

// --------------------------
// New Relic Settings
// --------------------------

// Handles requests sent by clicking "Enable Now" button
app.action('settings-button', async ({ ack, body, context }) => {
  const slackUserId = body.user.id;
  const settings = await database.findSettings(slackUserId);

  // Build a Home tab - https://api.slack.com/block-kit/surfaces/modals
  const view = await buildSettingsModal(settings);

  // Open a new modal - https://api.slack.com/methods/views.open
  callViewsApi(app.client, 'open', {
    token: context.botToken,
    trigger_id: body.trigger_id,
    view: view
  });
  ack();
});

// Handles data submission requests from the settings modal
app.view('settings-modal', async ({ ack, body, context }) => {
  const slackUserId = body.user.id;

  // User inputs in a view
  // https://api.slack.com/reference/interaction-payloads/views#view_submission_fields
  const values = body.view.state.values;
  const accountId = values['input-account-id']['input'].value
  const restApiKey = values['input-rest-api-key']['input'].value
  const queryApiKey = values['input-query-api-key']['input'].value

  // Server-side validation
  const errors = {};
  if (typeof accountId === 'undefined' || !accountId.match(/^\d+$/)) {
    errors['input-account-id'] = 'Account Id must be a numeric value';
  }
  if (typeof restApiKey === 'undefined' || !restApiKey.match(/^NRRA-\w{42}$/)) {
    errors['input-rest-api-key'] = 'REST API Key must be in a valid format';
  } else if ((await verifyRestApiKey(restApiKey, logger)) == false) {
    errors['input-rest-api-key'] = 'REST API Key seems to be invalid';
  }
  if (typeof queryApiKey === 'undefined' || !queryApiKey.match(/^NRIQ-\w{32}$/)) {
    errors['input-query-api-key'] = 'Query API Key must be in a valid format';
  } else if ((await verifyQueryApiKey(accountId, queryApiKey, logger)) == false) {
    errors['input-query-api-key'] = 'Query API Key (or Account Id) seems to be invalid';
  }

  if (Object.entries(errors).length > 0) {
    ack({
      response_action: 'errors',
      errors: errors
    });
    return;
  }

  var settings = await database.findSettings(slackUserId);
  if (typeof settings === 'undefined') {
    settings = {};
  }
  settings['slackUserId'] = slackUserId;
  settings['accountId'] = accountId;
  settings['restApiKey'] = restApiKey;
  settings['queryApiKey'] = queryApiKey;
  await database.saveSettings(settings);

  ack();

  // Update Home Tab using the given credentials
  const view = await buildAppHome(
    accountId,
    undefined,
    new NewRelicRestApi(restApiKey, logger, debugMode)
  );
  await callViewsApi(app.client, 'publish', {
    token: context.botToken,
    user_id: slackUserId,
    view: view
  });
});

// Handles requests sent by clicking "Clear Settings" button
app.action('clear-settings-button', async ({ ack, body, context }) => {
  const slackUserId = body.user.id;
  await database.deleteAll(slackUserId);

  ack();

  // Update Home Tab
  const view = await buildAppHome(undefined, undefined, undefined);
  await callViewsApi(app.client, 'publish', {
    token: context.botToken,
    user_id: slackUserId,
    view: view
  });
});

// --------------------------
// NRQL Query Runner
// --------------------------

// Handles requests sent by clicking "Query Runner" button in the Home tab
app.action('query-button', async ({ ack, body, context }) => {
  const slackUserId = body.user.id;

  // Setup the query to display in the modal
  const settings = await database.findSettings(slackUserId);
  const queries = await database.findQueries(slackUserId);
  const query = buildQuery(queries.length > 0 ? queries[0] : undefined, settings);
  await database.saveQuery(slackUserId, query);

  // Open a modal to run queries
  const view = await buildQueryModal(query, settings);
  await callViewsApi(app.client, 'open', {
    token: context.botToken,
    trigger_id: body.trigger_id,
    view: view
  });

  ack();
});

// Handles requests sent by clicking "Run" button in the query modal
app.view('query-modal', async ({ ack, body }) => {
  const slackUserId = body.user.id;

  const query = body.view.state.values['input-query']['input'].value
  await database.saveQuery(slackUserId, query);

  const settings = await database.findSettings(slackUserId);
  const view = await buildQueryModal(query, settings);

  // Update the existing Home tab with new one
  ack({
    response_action: 'update',
    view: view
  });
});

// Handles requests sent by clicking "Query History" button in the query modal
app.action('query-history-button', async ({ ack, body, context }) => {
  const slackUserId = body.user.id;

  const queries = await database.findQueries(slackUserId);
  const view = await buildQueryHistoryModal(queries);

  // Update the existing Home tab with new one
  await callViewsApi(app.client, 'update', {
    token: context.botToken,
    view_id: body.view.id,
    view: view
  });

  ack();
});

// Handles requests sent by selecting one from the radio button in the query modal
app.action('query-radio-button', async ({ ack, body, context }) => {
  const slackUserId = body.user.id;

  // Find the selected query
  const idx = body.actions[0].selected_option.value;
  const queries = await database.findQueries(slackUserId);
  const query = queries[parseInt(idx)];
  await database.saveQuery(slackUserId, query);

  const settings = await database.findSettings(slackUserId);
  const view = await buildQueryModal(query, settings);

  // Update the existing Home tab with new one
  await callViewsApi(app.client, 'update', {
    token: context.botToken,
    view_id: body.view.id,
    view: view
  });

  ack();
});

// --------------------------
// Internal Methods
// --------------------------

// --------------
// API Calls

// method: open / update / publish
async function callViewsApi(client, method, options) {
  if (debugMode) {
    logger.debug(`Going to send this view to views.${method} API\n\n${JSON.stringify(options.view)}\n`)
  }
  return client.apiCall(`views.${method}`, options).then(res => {
    if (debugMode) {
      logger.debug(`Succeeded to ${method} a view\n\n${JSON.stringify(res)}\n`)
    }
  }).catch(err => logger.error(`Failed ${method} a view - api response: ${JSON.stringify(err)}`));
}

// Returns true if the given api key is valid, false otherwise
async function verifyRestApiKey(restApiKey) {
  const api = new NewRelicRestApi(restApiKey, logger, debugMode);
  const result = await api.applicationsList();
  return typeof result !== 'undefined';
}

// Returns true if the given api key is valid, false otherwise
async function verifyQueryApiKey(accountId, queryApiKey, logger) {
  const insights = new NewRelicInsightsApi(accountId, queryApiKey, logger, debugMode);
  const result = await insights.run("select max(duration) from Transaction since 3 days ago");
  // true if valid
  return typeof result !== 'undefined';
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
    logger.error(`Failed to call New Relic API - ${e}`)
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
        "url": `https://rpm.newrelic.com/accounts/${accountId}/applications/${app.id}`
      }
    }
  );

  const hostsResponse = await newRelic.applicationHostsList(app.id);
  const hosts = hostsResponse.data.application_hosts;
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
          const date = new Date(v.opened_at);
          return {
            "type": "mrkdwn",
            "text": `Priority: *${v.priority}*\nViolation: *${v.label}*\nOpened: *${date.toISOString()}*`
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

function buildQuery(givenQuery, settings) {
  const fullQuery = "SELECT name, host, duration, timestamp FROM Transaction SINCE 30 MINUTES AGO";
  const defaultQuery = settings && settings.defaultApplicationId ? `${fullQuery} WHERE appId = ${settings.defaultApplicationId}` : fullQuery;
  const query = givenQuery ? givenQuery : defaultQuery;
  return query;
}

async function buildQueryModal(query, settings) {
  const blocks = [
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "What's NRQL?"
          },
          "action_id": "view-in-browser-button",
          "url": "https://docs.newrelic.com/docs/query-data/nrql-new-relic-query-language/getting-started/nrql-syntax-components-functions"
        },
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "Query History"
          },
          "action_id": "query-history-button"
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
    const api = new NewRelicInsightsApi(settings.accountId, settings.queryApiKey, logger, debugMode);
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

async function buildQueryHistoryModal(queries) {
  const options = []
  for (let idx = 0; idx < queries.length; idx++) {
    const query = queries[idx];
    const elements = query.split(' ');
    let text = '';
    let description = '';
    for (const elem of elements) {
      if (description.length == 0 && (text + elem).length <= 70) {
        text = text + ' ' + elem;
      } else {
        description = description + ' ' + elem;
      }
    }
    description = description.slice(0, 70) + '...';

    options.push({
      "text": {
        "type": "plain_text",
        "text": text
      },
      "description": {
        "type": "plain_text",
        "text": description
      },
      "value": idx.toString()
    });
  }
  const blocks = [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Here is the list of the queries you recently ran. Select a query you'd like to run again."
      },
      "accessory": {
        "type": "radio_buttons",
        "action_id": "query-radio-button",
        "options": options
      }
    }
  ];
  return {
    "type": "modal",
    "title": {
      "type": "plain_text",
      "text": "Insights Query History",
      "emoji": false
    },
    "close": {
      "type": "plain_text",
      "text": "Close",
      "emoji": false
    },
    "blocks": blocks,
    "callback_id": "query-history-modal"
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
  logger.info('⚡️ Bolt app is running!');
})();
