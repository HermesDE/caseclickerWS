function checkBet(bet, tokens) {
  return new Promise((resolve, reject) => {
    if (isNaN(bet)) return reject("bet isNAN");
    if (bet <= 0) return reject("bet is not a valid number");
    if (tokens < bet) return reject("not enough tokens");
    resolve();
  });
}

module.exports = {
  checkBet,
};
