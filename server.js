const express = require("express");
const crypto = require("crypto");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const PORT = process.env.PORT || 3000;
const BOT_API_BASE = "https://d88c-77-91-96-208.ngrok-free.app";

const orders = [];

function getCredits(packId) {
  const packs = {
    pack_10: 10,
    pack_25: 25,
    pack_60: 60,
    pack_150: 150,
  };
  return packs[packId] || 0;
}

async function addBalanceViaBotApi(userId, amount) {
  const response = await fetch(`${BOT_API_BASE}/api/add-balance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      user_id: Number(userId),
      amount: Number(amount)
    })
  });

  return await response.json();
}

async function getBalanceViaBotApi(userId) {
  const response = await fetch(
    `${BOT_API_BASE}/api/balance?user_id=${encodeURIComponent(userId)}`
  );

  return await response.json();
}

async function notifyUser(userId, credits) {
  if (!BOT_TOKEN || !userId) return;

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: userId,
        text: `✅ Баланс поповнено на ${credits} 🌟`
      })
    });

    const data = await response.json();
    console.log("TELEGRAM RESPONSE:", data);
  } catch (e) {
    console.error("Notify error:", e);
  }
}

app.get("/", (req, res) => {
  res.send("Server is running");
});

app.get("/api/mono-webhook", (req, res) => {
  res.sendStatus(200);
});

app.post("/api/create-order", (req, res) => {
  const base = Number(req.body.amount);
  const userId = req.body.user_id;
  const packId = req.body.pack_id;

  if (!base || !userId || !packId) {
    return res.status(400).json({ error: "amount, user_id, pack_id required" });
  }

  const credits = getCredits(packId);
  if (!credits) {
    return res.status(400).json({ error: "invalid pack_id" });
  }

  const unique = base + Math.floor(Math.random() * 99) / 100;

  const order = {
    id: crypto.randomUUID(),
    amount: Number(unique.toFixed(2)),
    user_id: String(userId),
    credits,
    pack_id: packId,
    status: "pending",
    createdAt: Date.now(),
    applied: false
  };

  orders.push(order);
  console.log("NEW ORDER:", order);

  res.json({
    id: order.id,
    amount: order.amount,
    status: order.status
  });
});

app.get("/api/order-status", (req, res) => {
  const order = orders.find(o => o.id === req.query.id);

  if (!order) {
    return res.json({ status: "not_found" });
  }

  res.json({ status: order.status });
});

async function proxyBotApi(path, payload) {
  const response = await fetch(`${BOT_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`bot_api_invalid_json:${text.slice(0, 200)}`);
  }

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

app.get("/api/balance", async (req, res) => {
  try {
    const userId = req.query.user_id;
    if (!userId) {
      return res.status(400).json({ ok: false, error: "user_id required" });
    }

    const data = await getBalanceViaBotApi(userId);
    res.json(data);
  } catch (e) {
    console.error("BALANCE PROXY ERROR:", e);
    res.status(500).json({ ok: false, balance: 0 });
  }
});

app.post("/api/create-stars-invoice", async (req, res) => {
  try {
    const userId = req.body.user_id;
    const packId = req.body.pack_id;

    if (!userId || !packId) {
      return res.status(400).json({ ok: false, error: "user_id and pack_id required" });
    }

    const result = await proxyBotApi("/api/create-stars-invoice", {
      user_id: Number(userId),
      pack_id: String(packId)
    });

    return res.status(result.status).json(result.data);
  } catch (e) {
    console.error("CREATE STARS INVOICE ERROR:", e);
    return res.status(500).json({ ok: false, error: "stars_invoice_proxy_failed" });
  }
});

app.post("/api/create-crypto-invoice", async (req, res) => {
  try {
    const userId = req.body.user_id;
    const packId = req.body.pack_id;

    if (!userId || !packId) {
      return res.status(400).json({ ok: false, error: "user_id and pack_id required" });
    }

    const result = await proxyBotApi("/api/create-crypto-invoice", {
      user_id: Number(userId),
      pack_id: String(packId)
    });

    return res.status(result.status).json(result.data);
  } catch (e) {
    console.error("CREATE CRYPTO INVOICE ERROR:", e);
    return res.status(500).json({ ok: false, error: "crypto_invoice_proxy_failed" });
  }
});

app.post("/api/mono-webhook", async (req, res) => {
  res.sendStatus(200);

  const tx = req.body?.data?.statementItem;
  if (!tx) return;

  const amount = tx.amount / 100;
  console.log("WEBHOOK TX:", tx);
  console.log("WEBHOOK AMOUNT:", amount);

  const order = orders.find(o =>
    o.status === "pending" &&
    Math.abs(o.amount - amount) < 0.01 &&
    Math.abs(o.createdAt - tx.time * 1000) < 600000
  );

  if (!order) {
    console.log("ORDER NOT FOUND FOR AMOUNT:", amount);
    return;
  }

  if (order.applied) {
    console.log("ORDER ALREADY APPLIED:", order.id);
    return;
  }

  order.status = "paid";
  order.applied = true;

  const result = await addBalanceViaBotApi(order.user_id, order.credits);
  await notifyUser(order.user_id, order.credits);

  console.log("PAID:", order.id);
  console.log("BALANCE API RESULT:", result);
});

app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});
