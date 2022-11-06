require("dotenv").config();
const io = require("socket.io")(3001, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://case-clicker.com",
      "http://case-clicker.com",
      "http://ws.case-clicker.com",
      "https://ws.case-clicker.com",
    ],
  },
});
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");

const { db } = require("./lib/database/mongodb");
const { checkBet } = require("./lib/checkBet");
const { RateLimiterMemory } = require("rate-limiter-flexible");

const rateLimiter = new RateLimiterMemory({
  points: 15,
  duration: 1,
});

let games = [];

io.use((socket, next) => {
  const token = socket.handshake.auth;

  jwt.verify(token.token, process.env.NEXTAUTH_SECRET, (err, decoded) => {
    if (err) return next(new Error("invalid token"));

    decoded.userId = decoded.id;
    socket.handshake.auth = decoded;
    decoded.id ? next() : next(new Error("not authorized"));
  });
});

io.on("connection", (socket) => {
  const token = socket.handshake.auth;

  socket.on("click", async () => {
    try {
      await rateLimiter.consume(socket.handshake.address);
      const userstats = await db
        .collection("userstats")
        .findOne({ userId: token.userId });
      const newUserStats = await db
        .collection("userstats")
        .findOneAndUpdate(
          { userId: token.userId },
          { $inc: { money: userstats.moneyPerClick } }
        );
      io.to(socket.id).emit("click", newUserStats.value);
    } catch (ex) {
      socket.emit("blocked", ex.msBeforeNext);
    }
  });

  socket.on("games", () => {
    io.to(socket.id).emit("games", games);
  });
  socket.on("createGame", async (msg) => {
    const { bet } = msg;
    //console.log(msg, token);
    const userstats = await db
      .collection("userstats")
      .findOne({ userId: token.userId });
    try {
      //check if bet is valid
      await checkBet(bet, userstats.tokens);
    } catch (ex) {
      //send error to user
      return;
    }
    //subtract bet from userstats
    await db
      .collection("userstats")
      .findOneAndUpdate({ userId: token.userId }, { $inc: { tokens: -bet } });
    const gameObj = {
      id: uuidv4(),
      host: {
        id: token.userId,
        name: token.name,
        image: token.image,
      },
      bet: bet,
      guest: null,
      status: "waiting",
      winner: null,
      created: new Date(),
    };

    games.push(gameObj);
    io.emit("newGame", gameObj);
  });
  socket.on("deleteGame", async (id, userId) => {
    const game = games.find(
      (game) => game.id === id && game.host.id === userId
    );
    if (!game) return;
    const index = games.indexOf(game);
    games.splice(index, 1);
    //give user tokens back
    await db
      .collection("userstats")
      .findOneAndUpdate(
        { userId: userId },
        { $inc: { tokens: parseFloat(game.bet) } }
      );
    io.emit("deleteGame", game);
  });
});
