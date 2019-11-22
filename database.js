const { promisify } = require('util');
const fs = require('fs');

class FileDatabase {
  constructor(baseDir = 'tmp') {
    this.baseDir = baseDir;
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir);
    }
    this.readFileAsync = promisify(fs.readFile)
    this.deleteFileAsync = promisify(fs.unlink)
    this.writeFileAsync = promisify(fs.writeFile)
  }

  filepath(slackUserId) {
    return `${this.baseDir}/${slackUserId}.json`
  }

  async save(settings) {
    const path = this.filepath(settings.slackUserId);
    return await this.writeFileAsync(path, JSON.stringify(settings));
  }
  async delete(slackUserId) {
    const path = this.filepath(slackUserId);
    return await this.deleteFileAsync(path);
  }
  async find(slackUserId) {
    const path = this.filepath(slackUserId);
    if (fs.existsSync(path)) {
      const res = await this.readFileAsync(path, 'utf-8');
      return JSON.parse(res);
    } else {
      return undefined;
    }
  }
}

exports.FileDatabase = FileDatabase;