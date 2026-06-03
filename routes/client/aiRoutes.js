const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ aiManager }) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const overview = await aiManager.getOverview(uid);
      res.render("client/ai", {
        title: "AI Integration - w@pi",
        layout: "layouts/client",
        ...overview,
      });
    } catch (error) {
      console.error("AI Integration page error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.post("/settings", authMiddleware, async (req, res) => {
    try {
      await aiManager.saveSettings(req.session.user.uid, req.body);
      res.json({ status: true, message: "Konfigurasi AI berhasil disimpan." });
    } catch (error) {
      console.error("AI settings save error:", error);
      const statusCode = error.output?.statusCode || 500;
      res.status(statusCode).json({ status: false, message: error.message });
    }
  });

  router.post("/knowledge", authMiddleware, async (req, res) => {
    try {
      await aiManager.saveKnowledge(req.session.user.uid, req.body);
      res.json({ status: true, message: "Knowledge berhasil disimpan." });
    } catch (error) {
      console.error("AI knowledge save error:", error);
      const statusCode = error.output?.statusCode || 500;
      res.status(statusCode).json({ status: false, message: error.message });
    }
  });

  router.delete("/knowledge/:id", authMiddleware, async (req, res) => {
    try {
      await aiManager.deleteKnowledge(req.session.user.uid, req.params.id);
      res.json({ status: true, message: "Knowledge berhasil dihapus." });
    } catch (error) {
      console.error("AI knowledge delete error:", error);
      res.status(500).json({ status: false, message: error.message });
    }
  });

  router.post("/knowledge/sync-links", authMiddleware, async (req, res) => {
    try {
      const result = await aiManager.syncKnowledgeLinks(req.session.user.uid);
      res.json({
        status: true,
        message: `Sinkronisasi selesai. ${result.updated}/${result.total} link diperbarui.`,
        data: result,
      });
    } catch (error) {
      console.error("AI knowledge link sync error:", error);
      res.status(500).json({ status: false, message: error.message });
    }
  });

  router.post("/test", authMiddleware, async (req, res) => {
    try {
      const result = await aiManager.testPrompt(req.session.user.uid, req.body.prompt);
      res.json({ status: true, message: "AI berhasil menjawab.", data: result });
    } catch (error) {
      console.error("AI test error:", error);
      const statusCode = error.output?.statusCode || 500;
      res.status(statusCode).json({ status: false, message: error.message });
    }
  });

  return router;
};
