const { Boom } = require("@hapi/boom");
console.log("Type of Boom class:", typeof Boom);
console.log("Boom class keys:", Object.keys(Boom));
try {
  console.log("Boom.badRequest exists:", typeof Boom.badRequest);
} catch (e) {
  console.log("Error checking Boom.badRequest:", e.message);
}
