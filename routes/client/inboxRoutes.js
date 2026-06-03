const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../../lib/Utils.js");

module.exports = ({ pool }) => {
  router.get("/", authMiddleware, async (req, res) => {
    res.render("client/inbox", {
      title: "Inbox - w@pi",
      layout: "layouts/client",
    });
  });

  router.get("/data", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const limit = Math.min(
        Math.max(parseInt(req.query.limit || "30", 10), 10),
        100,
      );
      const offset = (page - 1) * limit;
      const search = String(req.query.search || "").trim();

      const params = [uid];
      let where = "uid = ?";
      if (search) {
        where += " AND (remote_jid LIKE ? OR push_name LIKE ? OR message LIKE ?)";
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      const [messages] = await pool.query(
        `
          SELECT *
          FROM inbox_messages
          WHERE ${where}
          ORDER BY received_at DESC
          LIMIT ? OFFSET ?
        `,
        [...params, limit, offset],
      );
      const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total FROM inbox_messages WHERE ${where}`,
        params,
      );

      res.json({
        status: true,
        messages,
        pagination: {
          page,
          limit,
          total: countRow.total,
          totalPages: Math.ceil(countRow.total / limit),
        },
      });
    } catch (error) {
      console.error("Inbox data error:", error);
      res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  });

  router.post("/remove/:id", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ status: false, message: "ID tidak valid" });
      }

      const [result] = await pool.query(
        "DELETE FROM inbox_messages WHERE uid = ? AND id = ?",
        [uid, id],
      );

      res.json({
        status: result.affectedRows > 0,
        message: result.affectedRows > 0 ? "Pesan inbox dihapus" : "Pesan tidak ditemukan",
      });
    } catch (error) {
      console.error("Inbox remove error:", error);
      res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  });

  router.post("/clear", authMiddleware, async (req, res) => {
    try {
      const uid = req.session.user.uid;
      const [result] = await pool.query(
        "DELETE FROM inbox_messages WHERE uid = ?",
        [uid],
      );

      res.json({
        status: true,
        deleted: result.affectedRows || 0,
        message: `${result.affectedRows || 0} pesan inbox dihapus`,
      });
    } catch (error) {
      console.error("Inbox clear error:", error);
      res.status(500).json({ status: false, message: "Internal Server Error" });
    }
  });

  return router;
};
