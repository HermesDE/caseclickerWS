const randomBotName = () => {
  const botNames = [
    "Uwe",
    "Jörg",
    "Rainer",
    "Egon",
    "Ernst",
    "Hermann",
    "Wolfram",
    "Wolfgang",
    "Siegfried",
    "Walter",
    "Ludwig",
    "Gert",
    "Dietmar",
    "Volker",
    "Ingo",
    "Manfred",
  ];
  return botNames[Math.floor(Math.random() * botNames.length)];
};
module.exports = { randomBotName };
