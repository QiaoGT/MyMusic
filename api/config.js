module.exports = (req, res) => {
  const pass = process.env.APP_PASSWORD || "";
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ passwordRequired: !!pass });
};
