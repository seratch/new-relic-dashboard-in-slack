const { promisify } = require('util');
const fs = require('fs');

class FileDatabase {
  constructor(baseDir = 'tmp') {
    this.baseDir = baseDir;
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir);
    }
    if (!fs.existsSync(`${baseDir}/settings`)) {
      fs.mkdirSync(`${baseDir}/settings`);
    }
    if (!fs.existsSync(`${baseDir}/queries`)) {
      fs.mkdirSync(`${baseDir}/queries`);
    }
    this.readFileAsync = promisify(fs.readFile)
    this.deleteFileAsync = promisify(fs.unlink)
    this.writeFileAsync = promisify(fs.writeFile)
  }

  settingsFilepath(slackUserId) {
    return `${this.baseDir}/settings/${slackUserId}.json`
  }
  queriesFilepath(slackUserId) {
    return `${this.baseDir}/queries/${slackUserId}.json`
  }

  async saveSettings(settings) {
    const path = this.settingsFilepath(settings.slackUserId);
    return await this.writeFileAsync(path, JSON.stringify(settings));
  }

  async deleteAll(slackUserId) {
    const settingsPath = this.settingsFilepath(slackUserId);
    const queriesPath = this.queriesFilepath(slackUserId);
    await this.deleteFileAsync(settingsPath);
    await this.deleteFileAsync(queriesPath);
  }

  async findSettings(slackUserId) {
    const path = this.settingsFilepath(slackUserId);
    if (fs.existsSync(path)) {
      const res = await this.readFileAsync(path, 'utf-8');
      return JSON.parse(res);
    } else {
      return undefined;
    }
  }

  // returns an array
  async findQueries(slackUserId) {
    const path = this.queriesFilepath(slackUserId);
    if (fs.existsSync(path)) {
      const res = await this.readFileAsync(path, 'utf-8');
      const queries = JSON.parse(res);
      // An array of option objects. Maximum number of options is 100. If option_groups is specified, this field should not be.
      return queries ? queries.slice(0, 100) : [];
    } else {
      return [];
    }
  }

  async saveQuery(slackUserId, query) {
    const queries = await this.findQueries(slackUserId);
    queries.unshift(query);
    const uniqueQueries = queries.filter((value, idx, self) => {
      return self.indexOf(value) === idx;
    });
    const path = this.queriesFilepath(slackUserId);
    return await this.writeFileAsync(path, JSON.stringify(uniqueQueries));
  }
}

exports.FileDatabase = FileDatabase;