const BoomModule = require("@hapi/boom");
const Boom = BoomModule.Boom;

// Copy static methods
Object.assign(Boom, BoomModule);

console.log("Boom.badRequest exists:", typeof Boom.badRequest);
try {
  console.log("Boom.badRequest call:", Boom.badRequest("test"));
} catch (e) {
  console.log(e.message);
}

try {
  const err = new Boom("test error");
  console.log("new Boom works:", err.message);
} catch (e) {
  console.log("new Boom error:", e.message);
}
