const version = require('./package.json').version;
const ProjectorAccessory = require('./ProjectorAccessory');
const constants=require("./constants");

module.exports = (homebridge) => {
  homebridge.registerPlatform(constants.platformName,
			      constants.platformPrettyName,
			      EpsonESCVPnetPlatform);
};

const EpsonESCVPnetPlatform = class {
  constructor(log, config, api) {
    this.log = log;
    this.log(`${constants.platformPrettyName} Plugin Loaded - Version ${version}`);
    this.config = config;
    this.api = api;
  }

  accessories(callback) {
    const accessories = [];
    
    this.config.projectors.forEach(projector => {
      projector.version = version;
      accessories.push(new ProjectorAccessory(this.api, this.log, projector));
    });
    callback(accessories);
  }
};
