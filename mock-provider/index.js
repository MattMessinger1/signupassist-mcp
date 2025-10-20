// mock-provider/index.js
const express = require("express");
const bodyParser = require("body-parser");
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Simple in-memory "accounts"
const accounts = {
  "parent@example.com": { password: "password123", twofactor: true, code: "654321" }
};

// Login page
app.get("/user/login", (req, res) => {
  res.send(`
    <h2>Mock SkiClubPro Login</h2>
    <form method="POST" action="/user/login">
      <label>Email: <input name="email" /></label><br/>
      <label>Password: <input type="password" name="password" /></label><br/>
      <button type="submit">Login</button>
    </form>
  `);
});

// Handle login post
app.post("/user/login", (req, res) => {
  const { email, password } = req.body;
  const acct = accounts[email];
  if (!acct || acct.password !== password) {
    return res.send(`<p>Invalid credentials. <a href="/user/login">Try again</a></p>`);
  }
  // If 2FA enabled, send to /twofactor
  if (acct.twofactor) {
    // In real site you'd send SMS/email; here we just show page
    return res.redirect(`/twofactor?email=${encodeURIComponent(email)}`);
  }
  // Otherwise redirect to dashboard
  res.redirect("/dashboard");
});

// Two-factor page
app.get("/twofactor", (req, res) => {
  const { email } = req.query;
  res.send(`
    <h2>Two-Factor Challenge</h2>
    <p>A mock code has been sent to ${email}. Use code: 654321</p>
    <form method="POST" action="/twofactor">
      <input type="hidden" name="email" value="${email}" />
      <label>Code: <input name="code" /></label>
      <button type="submit">Verify</button>
    </form>
  `);
});

app.post("/twofactor", (req, res) => {
  const { email, code } = req.body;
  const acct = accounts[email];
  if (acct && code === acct.code) {
    return res.redirect("/dashboard");
  }
  res.send(`<p>Invalid code. <a href="/twofactor?email=${encodeURIComponent(email)}">Try again</a></p>`);
});

// Dashboard
app.get("/dashboard", (req, res) => {
  res.send(`<h1>Login Successful ✅</h1><p>Welcome to Mock SkiClubPro</p>`);
});

app.listen(4321, () => console.log("Mock provider running on http://localhost:4321"));
