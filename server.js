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

  if (typeof db[key].balance !== "number") {
    db[key].balance = Number(db[key].balance || 0);
  }

  if (!Array.isArray(db[key].history)) {
    db[key].history = [];
  }

  db[key].balance += amount;

  db[key].history.push({
    type: "card_topup",
    amount: amount,
    date: new Date().toISOString().slice(0, 19)
  });

  writeDb(db);

  return db[key].balance;

async function addBalanceViaBotApi(userId, amount) {
  const response = await fetch("https://88f8-77-91-96-208.ngrok-free.app/api/add-balance", {
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

app.get("/api/balance", (req, res) => {
  const userId = req.query.user_id;
  res.json({ balance: getBalanceFromDb(userId) });
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
