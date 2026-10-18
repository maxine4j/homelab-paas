// Canonical public wire schemas. No server adapters or resolved credentials.
export const schemas = {
  CredentialReference: { type: "string", minLength: 1 },
  ApiError: {
    type: "object",
    additionalProperties: false,
    required: ["code", "diagnostics"],
    properties: {
      code: { type: "string", enum: ["invalid_request", "not_found"] },
      diagnostics: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "code"],
          properties: {
            path: { type: "string" },
            code: { type: "string", enum: ["required"] },
          },
        },
      },
    },
  },
};
