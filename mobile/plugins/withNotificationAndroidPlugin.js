const { withAndroidManifest, withAndroidColors, withDangerousMod, AndroidConfig } = require("expo/config-plugins");
const path = require("path");
const fs = require("fs");

const withNotificationAndroidPlugin = (config) => {
  // Update AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (!manifest.$["xmlns:tools"]) {
      manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    }

    const application = manifest.application[0];
    if (!application["meta-data"]) {
      application["meta-data"] = [];
    }
    const metaData = application["meta-data"];

    const existingAndroidEntry = (name) =>
      metaData.find((item) => item.$["android:name"] === name);

    // Set default channel
    if (!existingAndroidEntry("com.google.firebase.messaging.default_notification_channel_id")) {
      metaData.push({
        $: {
          "android:name": "com.google.firebase.messaging.default_notification_channel_id",
          "android:value": "messages",
          "tools:replace": "android:value",
        },
      });
    }

    // Set default color
    if (!existingAndroidEntry("com.google.firebase.messaging.default_notification_color")) {
      metaData.push({
        $: {
          "android:name": "com.google.firebase.messaging.default_notification_color",
          "android:resource": "@color/notification_icon_color",
          "tools:replace": "android:resource",
        },
      });
    }

    // Set default icon
    if (!existingAndroidEntry("com.google.firebase.messaging.default_notification_icon")) {
      metaData.push({
        $: {
          "android:name": "com.google.firebase.messaging.default_notification_icon",
          "android:resource": "@drawable/notification_icon",
          "tools:replace": "android:resource",
        },
      });
    }

    // Ensure Notifee components are present (redundancy for reliability)
    if (!application.receiver) application.receiver = [];
    if (!application.service) application.service = [];

    const hasReceiver = (name) => application.receiver.find((r) => r.$["android:name"] === name);
    const hasService = (name) => application.service.find((s) => s.$["android:name"] === name);

    if (!hasReceiver("app.notifee.core.ReceiverService")) {
      application.receiver.push({ $: { "android:name": "app.notifee.core.ReceiverService", "android:exported": "false" } });
    }
    if (!hasService("app.notifee.core.ForegroundService")) {
      application.service.push({ $: { "android:name": "app.notifee.core.ForegroundService", "android:exported": "false" } });
    }

    return config;
  });

  // Add the notification_icon_color to colors.xml
  config = withAndroidColors(config, (config) => {
    config.modResults = AndroidConfig.Colors.assignColorValue(config.modResults, {
      name: "notification_icon_color",
      value: "#023c69",
    });
    return config;
  });

  // Copy the notification_icon drawable
  config = withDangerousMod(config, [
    "android",
    async (config) => {
      const { projectRoot } = config.modRequest;
      const resPath = path.join(projectRoot, "android/app/src/main/res");
      const drawablePath = path.join(resPath, "drawable");
      const targetIconPath = path.join(drawablePath, "notification_icon.png");

      if (!fs.existsSync(drawablePath)) {
        fs.mkdirSync(drawablePath, { recursive: true });
      }

      // Use the logo_white if it exists
      const sourceIconPath = path.join(projectRoot, "assets/logo_white 192.png");
      if (fs.existsSync(sourceIconPath)) {
        fs.copyFileSync(sourceIconPath, targetIconPath);
      } else {
        // Fallback: use logo.png if logo_white is not found
        const fallbackPath = path.join(projectRoot, "assets/logo.png");
        if (fs.existsSync(fallbackPath)) {
          fs.copyFileSync(fallbackPath, targetIconPath);
        }
      }
      return config;
    },
  ]);

  return config;
};

module.exports = withNotificationAndroidPlugin;
