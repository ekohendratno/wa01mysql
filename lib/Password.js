const crypto = require("crypto");
const { promisify } = require("util");

const HASH_PREFIX = "scrypt";
const KEY_LENGTH = 64;
const scryptAsync = promisify(crypto.scrypt);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(String(password), salt, KEY_LENGTH);
  return `${HASH_PREFIX}$${salt}$${key.toString("hex")}`;
}

async function hashPasswordAsync(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scryptAsync(String(password), salt, KEY_LENGTH);
  return `${HASH_PREFIX}$${salt}$${key.toString("hex")}`;
}

function isPasswordHash(value) {
  return typeof value === "string" && value.startsWith(`${HASH_PREFIX}$`);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyPassword(password, storedPassword) {
  if (!storedPassword) return false;

  if (!isPasswordHash(storedPassword)) {
    return safeEqual(password, storedPassword);
  }

  const [, salt, storedKey] = storedPassword.split("$");
  if (!salt || !storedKey) return false;

  const key = crypto.scryptSync(String(password), salt, KEY_LENGTH).toString("hex");
  return safeEqual(key, storedKey);
}

async function verifyPasswordAsync(password, storedPassword) {
  if (!storedPassword) return false;

  if (!isPasswordHash(storedPassword)) {
    return safeEqual(password, storedPassword);
  }

  const [, salt, storedKey] = storedPassword.split("$");
  if (!salt || !storedKey) return false;

  const key = (await scryptAsync(String(password), salt, KEY_LENGTH)).toString("hex");
  return safeEqual(key, storedKey);
}

module.exports = {
  hashPassword,
  hashPasswordAsync,
  isPasswordHash,
  verifyPassword,
  verifyPasswordAsync,
};
