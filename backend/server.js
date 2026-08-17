const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5050;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    name: "PDFDesk API",
    version: "1.2.0",
    message: "Server is running"
  });
});

app.use("/api/merge", require("./routes/merge"));
app.use("/api/split", require("./routes/split"));
app.use("/api/rotate", require("./routes/routes_rotate"));
app.use("/api/compress", require("./routes/routes_compress"));
app.use("/api/edit", require("./routes/edit"));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`PDFDesk API running at http://localhost:${PORT}`);
});