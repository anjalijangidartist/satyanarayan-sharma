"use strict";

const { sendError } = require("../http");

function handleError(response, error, event) {
  if (!error) return;
  if (error.status && error.status < 500) {
    if (error.status === 413) response.setHeader("Connection", "close");
    if (error.status === 401) {
      sendError(response, 401, "Please sign in again.");
      return;
    }
    sendError(response, error.status, error.message || "Request rejected.");
    return;
  }

  if (error.githubStatus) {
    if (error.githubStatus === 401 || error.githubStatus === 403 || error.githubStatus === 429) {
      console.error(JSON.stringify({
        event,
        githubStatus: error.githubStatus,
        message: error.message,
        operation: error.operation,
        auth: error.auth,
      }));
      sendError(response, 503, "GitHub is temporarily unavailable. Please try again in a few minutes.");
      return;
    }
    if (error.githubStatus === 404) {
      console.error(JSON.stringify({
        event,
        githubStatus: 404,
        message: error.message,
        operation: error.operation,
        auth: error.auth,
      }));
      sendError(response, 503, "The photo library is not available right now.");
      return;
    }
    if (error.githubStatus === 422) {
      sendError(response, 409, "The photo library changed. Please try again.");
      return;
    }
  }

  console.error(JSON.stringify({
    event,
    message: error && error.message ? error.message : "unknown error",
    operation: error && error.operation,
    auth: error && error.auth,
  }));
  sendError(response, 500, "Something went wrong. Please try again.");
}

module.exports = { handleError };
