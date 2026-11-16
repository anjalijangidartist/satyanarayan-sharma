"use strict";

const {
  sendJson,
  methodNotAllowed,
  clearSessionCookie,
  assertSameOrigin,
  hashIp,
  audit,
} = require("../http");
const { handleError } = require("./utils");

module.exports = async function logout(request, response) {
  if (request.method !== "POST") {
    methodNotAllowed(response, ["POST"]);
    return;
  }

  try {
    assertSameOrigin(request);
    clearSessionCookie(request, response);
    audit("portal_logout", { ip: hashIp(request) });
    sendJson(response, 200, { ok: true });
  } catch (error) {
    handleError(response, error, "portal_logout_error");
  }
};
