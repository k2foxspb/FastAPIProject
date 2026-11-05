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

    // Точные будильники для напоминаний журнала. USE_EXACT_ALARM выдаётся без запроса
    // (APK распространяется не через Google Play); SCHEDULE_EXACT_ALARM, RECEIVE_BOOT_COMPLETED
    // и ресиверы восстановления триггеров после перезагрузки (RebootBroadcastReceiver,
    // NotificationAlarmReceiver, AlarmPermissionBroadcastReceiver) объявляет AAR ядра Notifee.
    if (!manifest["uses-permission"]) manifest["uses-permission"] = [];
    const hasPermission = (name) => manifest["uses-permission"].find((p) => p.$["android:name"] === name);
    if (!hasPermission("android.permission.USE_EXACT_ALARM")) {
      manifest["uses-permission"].push({ $: { "android:name": "android.permission.USE_EXACT_ALARM" } });
    }

    if (!application.receiver) application.receiver = [];
    if (!application.service) application.service = [];

    const hasService = (name) => application.service.find((s) => s.$["android:name"] === name);

    // Удаляем ошибочные записи прошлых версий плагина: ReceiverService - это service, а не
    // receiver (его объявляет Notifee), RebootService и NotifeeEventReceiver не существуют
    // (BOOT_COMPLETED на несуществующий класс даёт ClassNotFoundException при загрузке).
    const brokenReceivers = ["app.notifee.core.ReceiverService", "io.invertase.notifee.NotifeeEventReceiver"];
    application.receiver = application.receiver.filter((r) => !brokenReceivers.includes(r.$["android:name"]));
    application.service = application.service.filter((s) => s.$["android:name"] !== "app.notifee.core.RebootService");

    // Add ReactNativeFirebaseMessagingService for reliable background handling
    if (!hasService("io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService")) {
      application.service.push({
        $: {
          "android:name": "io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService",
          "android:exported": "false",
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name": "com.google.firebase.MESSAGING_EVENT",
                },
              },
            ],
          },
        ],
      });
    }

    if (!application.receiver.length) delete application.receiver;

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

      // Use the white logo if it exists
      const sourceIconPath = path.join(projectRoot, "assets/black.png");
      if (fs.existsSync(sourceIconPath)) {
        fs.copyFileSync(sourceIconPath, targetIconPath);
      } else {
        // Fallback: use black logo if white is not found
        const fallbackPath = path.join(projectRoot, "assets/black.png");
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
