const Boom = require("@hapi/boom");
console.log("Type of Boom:", typeof Boom);
console.log("Boom keys:", Object.keys(Boom));
try {
  console.log("Boom.badRequest:", Boom.badRequest("test"));
} catch (e) {
  console.log("Boom.badRequest error:", e.message);
}

const { Boom: BoomClass } = require("@hapi/boom");
console.log("Type of BoomClass:", typeof BoomClass);
try {
  console.log("BoomClass.badRequest:", BoomClass.badRequest("test"));
} catch (e) {
  console.log("BoomClass.badRequest error:", e.message);
}
