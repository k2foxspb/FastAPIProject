const { withAndroidManifest } = require("expo/config-plugins");

const withNotificationAndroidPlugin = (config) => {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0];
    // make sure it's not undefined
    if (!application["meta-data"]) {
      application["meta-data"] = [];
    }
    const metaData = application["meta-data"];

    // Check if the entry already exists to prevent duplicating it
    const existingAndroidEntry = (name) =>
      metaData.find((item) => item.$["android:name"] === name);

    if (
      !existingAndroidEntry(
        "com.google.firebase.messaging.default_notification_channel_id",
      )
    ) {
      metaData.push({
        $: {
          "android:name":
            "com.google.firebase.messaging.default_notification_channel_id",
          "android:value": "messages",
          "tools:replace": "android:value",
        },
      });
    }

    if (
      !existingAndroidEntry(
        "com.google.firebase.messaging.default_notification_color",
      )
    ) {
      metaData.push({
        $: {
          "android:name":
            "com.google.firebase.messaging.default_notification_color",
          "android:resource": "@color/notification_icon_color",
          "tools:replace": "android:resource",
        },
      });
    }

    if (
      !existingAndroidEntry(
        "com.google.firebase.messaging.default_notification_icon",
      )
    ) {
      metaData.push({
        $: {
          "android:name":
            "com.google.firebase.messaging.default_notification_icon",
          "android:resource": "@drawable/notification_icon",
          "tools:replace": "android:resource",
        },
      });
    }

    return config;
  });
};

module.exports = withNotificationAndroidPlugin;
