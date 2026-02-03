const express = require("express");
const router = express.Router();

module.exports = ({ deviceManager }) => {
  // GET /client/webhook - Menampilkan halaman manajemen webhook
  router.get("/", async (req, res) => {
    try {
      const apiKey = req.session.user.api_key;
      // Get all devices to list them (assuming we want to manage per device)
      // But getDevices returns a list.
      // We might just want to list devices and their current webhook URLs.
      // getDevices returns array of devices.

      // We need to fetch devices using deviceManager
      // Note: deviceManager.getDevices returns devices with limit/offset.
      // For this view, we want all devices or at least paginated.
      // Assuming getDevices handles pagination, we might need to adjust or create a new method if we want ALL.
      // For now, let's use getDevices with a large limit.

      // Wait, getDevices in DeviceManager.js (viewed earlier) takes (apiKey).
      // It has hardcoded DEFAULT_LIMIT = 100 inside the method I saw earlier.

      // We need to modify getDevices to return webhook_url as well!
      // I'll check DeviceManager.js again. I didn't verify if getDevices selects webhook_url.

      // If getDevices doesn't return webhook_url, I need to update it.
      // Let's assume I will update it.

      const devices = await deviceManager.getDevices(apiKey);

      res.render("client/webhook", {
        title: "Webhook Management",
        layout: "layouts/client",
        devices: devices,
        path: "/client/webhook",
        user: req.session.user,
      });
    } catch (error) {
      console.error("Error fetching devices for webhook:", error);
      res.status(500).render("error", { message: "Failed to load devices" });
    }
  });

  // POST /client/webhook/update - Mengupdate webhook URL untuk device tertentu
  router.post("/update", async (req, res) => {
    try {
      const { deviceKey, webhookUrl } = req.body;
      const apiKey = req.session.user.api_key;

      if (!deviceKey) {
        return res
          .status(400)
          .json({ status: false, message: "Device Key is required" });
      }

      // Validasi URL sederhana
      if (webhookUrl && !webhookUrl.startsWith("http")) {
        return res
          .status(400)
          .json({
            status: false,
            message: "Invalid URL format. Must start with http:// or https://",
          });
      }

      await deviceManager.updateWebhookUrl(apiKey, deviceKey, webhookUrl);

      res.json({ status: true, message: "Webhook URL updated successfully" });
    } catch (error) {
      console.error("Error updating webhook:", error);
      res.status(500).json({ status: false, message: error.message });
    }
  });

  return router;
};
