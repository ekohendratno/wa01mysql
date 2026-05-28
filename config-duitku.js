require("dotenv").config();

const duitkuConfig = {
  merchantCode: process.env.DUITKU_MERCHANT_CODE || "",
  merchantKey: process.env.DUITKU_MERCHANT_KEY || "",
  callbackUrl: process.env.DUITKU_CALLBACK_URL || "",
  returnUrl: process.env.DUITKU_RETURN_URL || "",
  environment: process.env.DUITKU_ENVIRONMENT || "sandbox",
};

module.exports = duitkuConfig;
