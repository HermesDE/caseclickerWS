const { v4: uuidv4 } = require("uuid");
const games = [];

function getGames() {
  return games.filter((game) => !game.isPrivate);
}

function createGame(data, token) {
  let obj = {
    id: uuidv4(),
    teams: parseInt(data.teams),
    playerCount: parseInt(data.playerCount),
    isPrivate: data.isPrivate,
    battlePrice: data.battlePrice,
    rounds: data.cases.length,
    status: "waiting",
    cases: data.cases,
    players: [{ userId: token.userId, name: token.name, image: token.picture }],
    openedSkins: [],
  };
  games.push(obj);
  return obj;
}

module.exports = { createGame, getGames };
