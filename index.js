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
const { tokenMiddleware } = require("./middleware");
const { sleep } = require("./lib/sleep");

const { db } = require("./lib/database/mongodb");
const { checkBet } = require("./lib/checkBet");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const { randomBotName } = require("./lib/randomBotName");
const { createGame, getGames } = require("./lib/casebattle/games");

const rateLimiter = new RateLimiterMemory({
  points: 15,
  duration: 1,
});

let games = [];

//init middleware
io.use(tokenMiddleware);
io.of("/coinflip").use(tokenMiddleware);
io.of("/casebattle").use(tokenMiddleware);

io.on("connection", (socket) => {
  const token = socket.handshake.auth;
  socket.on("click", async () => {
    try {
      await rateLimiter.consume(socket.handshake.address);

      const userStats = await db
        .collection("userstats")
        .findOne({ userId: token.id });
      const newUserStats = await db.collection("userstats").findOneAndUpdate(
        { userId: token.userId },

        {
          $inc: {
            money: +userStats.moneyPerClick,
            moneyEarned: +userStats.moneyPerClick,
            clicks: +1,
            xp: 0.1,
          },
        },
        { returnDocument: "after" }
      );
      io.to(socket.id).emit("click", newUserStats.value);
    } catch (ex) {
      io.to(socket.id).emit("blocked", ex.msBeforeNext);
    }
  });
});

//Create coinflip namespace
const coinflip = io.of("/coinflip");

coinflip.on("connection", async (socket) => {
  const token = socket.handshake.auth;

  coinflip.emit("usercount", coinflip.sockets.size);
  socket.on("disconnect", (reason) => {
    coinflip.emit("usercount", coinflip.sockets.size);
  });

  socket.on("games", () => {
    coinflip.to(socket.id).emit("games", games);
  });
  socket.on("createGame", async (msg) => {
    //if user has 3 open games already dont create a new one
    if (games.filter((game) => game.host.id === token.userId).length >= 3) {
      return;
    }
    const { bet } = msg;

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
    const updatedUserStats = await db
      .collection("userstats")
      .findOneAndUpdate(
        { userId: token.userId },
        { $inc: { tokens: -bet } },
        { returnDocument: "after" }
      );
    const gameObj = {
      id: uuidv4(),
      host: {
        type: "player",
        id: token.userId,
        name: token.name,
        image: token.picture,
      },
      bet: bet,
      guest: null,
      status: "waiting",
      winner: null,
      created: new Date(),
    };
    games.push(gameObj);
    coinflip.emit("newGame", gameObj);
    coinflip.to(socket.id).emit("userstats", updatedUserStats.value);
  });
  socket.on("deleteGame", async (id, userId) => {
    const game = games.find(
      (game) => game.id === id && game.host.id === userId
    );
    if (!game) return;
    const index = games.indexOf(game);
    games.splice(index, 1);
    //give user tokens back
    const updatedUserStats = await db
      .collection("userstats")
      .findOneAndUpdate(
        { userId: userId },
        { $inc: { tokens: parseFloat(game.bet) } },
        { returnDocument: "after" }
      );
    coinflip.emit("deleteGame", game);
    coinflip.to(socket.id).emit("userstats", updatedUserStats.value);
  });
  socket.on("joinGame", async (id, bot) => {
    const game = games.find((game) => game.id === id);

    //prevent joining if game is full
    if (game.guest) return;

    let index;
    if (bot) {
      index = games.findIndex((game) => game.id === id);

      games[index].guest = {
        type: "bot",
        name: `Bot ${randomBotName()}`,
        image:
          "https://case-clicker.com/pictures/casino/coinflip/botProfilePicture.png",
      };
    } else {
      //prevent joining own game
      if (game.host.id === token.userId) return;
      const userstats = await db
        .collection("userstats")
        .findOne({ userId: token.userId });

      if (userstats.tokens < game.bet) return;
      const updatedUserStats = await db
        .collection("userstats")
        .findOneAndUpdate(
          { userId: token.userId },
          { $inc: { tokens: -game.bet } },
          { returnDocument: "after" }
        );

      coinflip.to(socket.id).emit("userstats", updatedUserStats.value);

      index = games.findIndex((game) => game.id === id);
      games[index].guest = {
        type: "player",
        id: token.userId,
        name: token.name,
        image: token.picture,
      };
    }
    games[index].status = "full";

    //gamble result and pay user out
    const random = Math.random();
    if (random < 0.5) {
      games[index].winner = "host";
      await db.collection("userstats").findOneAndUpdate(
        { userId: game.host.id },
        {
          $inc: {
            tokens: parseInt(game.bet) * 2,
            coinflips: +1,
            coinflipsWon: +1,
            tokensWon: parseInt(game.bet),
          },
        }
      );
    } else {
      games[index].winner = "guest";
      if (!bot) {
        await db.collection("userstats").findOneAndUpdate(
          { userId: game.guest.id },
          {
            $inc: {
              tokens: parseInt(game.bet) * 2,
              coinflips: +1,
              coinflipsWon: +1,
              tokensWon: parseInt(game.bet),
            },
          }
        );
      }
    }

    const looserId = game.winner === "host" ? game.guest.id : game.host.id;
    if (looserId) {
      await db
        .collection("userstats")
        .findOneAndUpdate(
          { userId: looserId },
          { $inc: { coinflips: +1, tokensLost: parseInt(game.bet) } }
        );
    }

    coinflip.emit("joinedGame", games[index]);

    games = games.filter((g) => g.id !== game.id);
    await sleep(8000);
    coinflip.emit("deleteGame", game);
  });
  socket.on("userstats", async (id) => {
    const userstats = await db.collection("userstats").findOne({ userId: id });
    coinflip.to(socket.id).emit("userstats", userstats);
  });
});

//Create casebattle namespace
const casebattle = io.of("/casebattle");
casebattle.on("connection", (socket) => {
  const token = socket.handshake.auth;

  casebattle.emit("usercount", casebattle.sockets.size);
  socket.on("disconnect", (reason) => {
    casebattle.emit("usercount", casebattle.sockets.size);
  });

  socket.on("games", () => {
    const games = getGames();
    casebattle.to(socket.id).emit("games", games);
  });
  socket.on("createGame", (data) => {
    const newGame = createGame(data, token);

    //emit new game to creator
    casebattle.to(socket.id).emit("gameCreated", newGame.id);
    //emit new game to all players in lobby
    if (!newGame.isPrivate) {
      casebattle.emit("newGame", newGame);
    }
  });
});
