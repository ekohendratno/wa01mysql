const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ pool }) => {
  router.get("/", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const [templates] = await pool.query(
        "SELECT * FROM message_templates WHERE uid = ? ORDER BY updated_at DESC, id DESC",
        [uid],
      );

      res.render("client/templates", {
        title: "Template Pesan - w@pi",
        layout: "layouts/client",
        templates,
      });
    } catch (error) {
      console.error("Template view error:", error);
      res.status(500).send("Internal Server Error");
    }
  });

  router.post("/save", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const id = parseInt(req.body.id || "0", 10);
      const name = String(req.body.name || "").trim();
      const category = String(req.body.category || "").trim() || null;
      const content = String(req.body.content || "").trim();

      if (!name || !content) {
        return res
          .status(400)
          .json({ status: false, message: "Nama dan isi template wajib diisi." });
      }

      if (id > 0) {
        const [result] = await pool.query(
          "UPDATE message_templates SET name = ?, category = ?, content = ?, updated_at = NOW() WHERE id = ? AND uid = ?",
          [name, category, content, id, uid],
        );
        if (result.affectedRows === 0) {
          return res
            .status(404)
            .json({ status: false, message: "Template tidak ditemukan." });
        }
      } else {
        await pool.query(
          "INSERT INTO message_templates (uid, name, category, content) VALUES (?, ?, ?, ?)",
          [uid, name, category, content],
        );
      }

      res.json({ status: true, message: "Template berhasil disimpan." });
    } catch (error) {
      console.error("Template save error:", error);
      res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  });

  router.delete("/delete/:id", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const id = parseInt(req.params.id || "0", 10);
      await pool.query("DELETE FROM message_templates WHERE id = ? AND uid = ?", [
        id,
        uid,
      ]);
      res.json({ status: true, message: "Template berhasil dihapus." });
    } catch (error) {
      console.error("Template delete error:", error);
      res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  });

  return router;
};
