const jwt = require("jsonwebtoken");

async function tokenMiddleware(socket, next) {
  const token = socket.handshake.auth;

  jwt.verify(token.token, process.env.NEXTAUTH_SECRET, (err, decoded) => {
    if (err) return next(new Error("invalid token"));

    decoded.userId = decoded.id;
    socket.handshake.auth = decoded;
    decoded.id ? next() : next(new Error("not authorized"));
  });
}

module.exports = { tokenMiddleware };
