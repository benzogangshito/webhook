const express = require("express");
const crypto = require("crypto");
const fetch = require("node-fetch");
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
const users = {};

function getCredits(packId) {
  const packs = {
    pack_10: 10,
    pack_25: 25,
    pack_60: 60,
    pack_150: 150,
  };
  return packs[packId] || 0;
}

function addBalance(userId, amount) {
  if (!userId) return;
  if (!users[userId]) users[userId] = 0;
  users[userId] += amount;
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

  const unique = base + Math.floor(Math.random() * 99) / 100;

  const order = {
    id: crypto.randomUUID(),
    amount: Number(unique.toFixed(2)),
    user_id: userId,
    credits: getCredits(packId),
    pack_id: packId,
    status: "pending",
    createdAt: Date.now()
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
  res.json({ status: order?.status || "not_found" });
});

app.get("/api/balance", (req, res) => {
  const userId = req.query.user_id;
  res.json({ balance: users[userId] || 0 });
});

app.post("/api/mono-webhook", (req, res) => {
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

  order.status = "paid";
  addBalance(order.user_id, order.credits);
  notifyUser(order.user_id, order.credits);

  console.log("PAID:", order.id);
  console.log("BALANCE:", users);
});

app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});