const withNotificationAndroidPlugin = require("./withNotificationAndroidPlugin");

const withPlugin = (config) => {
  return withNotificationAndroidPlugin(config);
};

module.exports = withPlugin;
