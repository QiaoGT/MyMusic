module.exports = (req, res) => {
  const expected = process.env.APP_PASSWORD || "";
  if (!expected) {
    res.status(200).json({ ok: true, bypass: true });
    return;
  }

  const body = typeof req.body === "object" && req.body ? req.body : {};
  const password = String(body.password || "");
  const ok = password === expected;
  res.status(ok ? 200 : 401).json({ ok });
};
